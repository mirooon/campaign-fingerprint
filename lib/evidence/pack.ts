/**
 * Evidence pack export for one campaign, following section 5 of the legal report
 * ("Proponowany format paczki dowodów"): header, impersonated person (no biometric
 * templates), ads / domains / accounts with IDs, URLs and UTC timestamps, SHA-256 of the
 * archived HTML, fixtures and creatives, facts separated from model outputs, requested
 * actions per recipient, a domain list for the CERT warning list and a DSA Art. 16 notice
 * template. The tool proposes; a human verifies and decides whether to report.
 */
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readAdRecordTraces } from "../graph/adLibraryTraces";
import { DEFAULT_LINK_CONFIG, type LinkConfig } from "../graph/config";
import type { Campaign, CampaignsFile, EvidenceGraph, ItemLink } from "../graph/model";
import { Discounter } from "../graph/weights";
import { defangHost, defangText } from "../osint/redact";
import { formatUtc } from "./format";
import { normalizeUrl, registrableDomain } from "../osint/urls";
import type { CampaignSummary } from "../pipeline/summary";
import type { EnrichedDataset, Item, PageInfo } from "../pipeline/types";
import { buildCustodyLog, timestampFields } from "./custody";
import { companyIdsOfMaterial } from "../text/companyIds";
import { adLibraryFacts, pageUrl } from "./adRecords";
import type { CampaignFacts } from "./facts";
import { recipientFiles } from "./recipients";
import { retentionPolicy } from "./retention";
import { methodsWithPremises, sharedInfrastructureNote, traceTypeName, whyInCampaign } from "./readable";
import { harToWarc } from "./warc";
import { buildStixBundle } from "./stix";
import { continuationAfterNotice, pendingReports, REPORT_WAIT_DAYS, type ReportEntry } from "./reports";
import { renderKnfNotice, renderPreservationRequest, renderProsecutorNotice } from "./views";
import { renderDsaIndex, renderDsaNotices, type DsaInput } from "./dsa";
import { caseFilesOf, REDACTORS, SOURCE_FILE_DIR, SOURCE_FILE_LABEL, type PackProvenance } from "./sourceFiles";
import { sharedTraces } from "./traces";
import { planCertDomains, renderCertReasons } from "./certDomains";
import { certStatus, type CertListSnapshot } from "./certList";
import { renderShopSignals, shopFacts } from "./shopFacts";
import { DEFAULT_NARRATIVE_CONFIG, topicQuote, type MaterialNarrative } from "../text/narrative";
import { defangUrl } from "../viewer/defang";
import { TECHNIQUE_LABEL } from "../viewer/plain";

export const GOOD_FAITH_STATEMENT =
  "Oświadczam, że w dobrej wierze uważam, iż informacje i zarzuty zawarte w zgłoszeniu są prawidłowe i kompletne.";

const TODO = (what: string) => `[UZUPEŁNIJ: ${what}]`;

export interface Submitter {
  name: string | null;
  email: string | null;
  address: string | null;
  role: string | null;
}

export interface EvidenceOptions {
  campaignId: string;
  graph: EvidenceGraph;
  campaigns: CampaignsFile;
  enriched: EnrichedDataset;
  summaries?: Record<string, CampaignSummary>;
  config?: LinkConfig;
  outDir: string;
  submitter?: Partial<Submitter>;
  tlp?: string;
  toolVersion?: { name: string; version: string; gitCommit: string | null };
  /** Deterministic ids/time for tests. */
  packageId?: string;
  now?: () => Date;
  /** Project root against which relative archive paths and dataset baseDir are resolved. */
  root?: string;
  /** Local copy of the CERT Warning List (status without online queries); null/absent = not checked. */
  certList?: CertListSnapshot | null;
  /** Why there is no copy of the list (shown in the pack instead of a status). */
  certListNote?: string;
  /** provenance.json of the import: SHA-256 of the input files of each case, copied into the pack where it is safe to. */
  provenance?: PackProvenance | null;
  /** Register of earlier reports (`--prior`): the ones of this campaign (or with no campaign named) go into the pack. */
  priorReports?: ReportEntry[];
}

export interface ManifestEntry {
  file: string;
  sha256: string;
  size: number;
  mime: string;
  acquired_utc: string | null;
  source: string;
  /** Set for a redacted copy: SHA-256 of the original the copy was made from. */
  derived_from_sha256?: string;
  /** What was removed from the copy (set together with derived_from_sha256). */
  redaction?: string;
}

export interface EvidenceResult {
  outDir: string;
  record: Record<string, unknown>;
  files: string[];
  certDomains: string[];
}

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".json": "application/json",
  ".md": "text/markdown",
  ".txt": "text/plain",
};

function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function mimeOf(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

function utc(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const RECIPIENTS = {
  D: "platforma (art. 16 DSA)",
  C: "CSIRT NASK — Lista Ostrzeżeń CERT",
  K: "KNF",
  U: "UODO (skarga osoby, której wizerunek użyto)",
  P: "prokuratura / Policja",
  S: "Prezes UKE (skarga, art. 22zh)",
  E: "zabezpieczenie danych (art. 218a k.p.k. / e-evidence)",
} as const;

function requestedActions(hasFinancialOffer: boolean): Array<{ recipient: keyof typeof RECIPIENTS; name: string; action: string; status: "propozycja" }> {
  return [
    { recipient: "D", name: RECIPIENTS.D, action: "usunięcie reklam i rozważenie blokady konta reklamodawcy; zachowanie danych reklam i płatnika", status: "propozycja" },
    { recipient: "C", name: RECIPIENTS.C, action: "wpis domen z pliku cert-domains.txt na Listę Ostrzeżeń (do 50 domen na zgłoszenie)", status: "propozycja" },
    {
      recipient: "K",
      name: RECIPIENTS.K,
      action: hasFinancialOffer
        ? "informacja o podmiocie oferującym usługi inwestycyjne bez zezwolenia — rozważenie zawiadomienia i wpisu na listę ostrzeżeń publicznych"
        : "informacja (jeśli oferta dotyczy usług finansowych)",
      status: "propozycja",
    },
    { recipient: "U", name: RECIPIENTS.U, action: "załącznik do skargi osoby, której wizerunek użyto (żądanie zakazu przetwarzania; sugestia środka z art. 66 RODO)", status: "propozycja" },
    { recipient: "P", name: RECIPIENTS.P, action: "zawiadomienie o możliwości popełnienia przestępstwa z pełną paczką dowodów", status: "propozycja" },
    { recipient: "S", name: RECIPIENTS.S, action: "skarga, jeśli platforma nie zareagowała na zgłoszenie (dołącz prior_reports)", status: "propozycja" },
    { recipient: "E", name: RECIPIENTS.E, action: "zabezpieczenie danych u platformy (konto reklamowe, płatnik, logi) i u rejestratora domen", status: "propozycja" },
  ];
}

/** Builds and writes the evidence pack for one campaign. */
export function exportEvidencePack(opts: EvidenceOptions): EvidenceResult {
  const root = opts.root ?? process.cwd();
  const now = opts.now?.() ?? new Date();
  const toolVersion = opts.toolVersion ?? { name: "hacknation-osint-starter", version: "0.1.0", gitCommit: null };
  const config = opts.config ?? DEFAULT_LINK_CONFIG;
  const discounter = new Discounter(config);
  const campaign = opts.campaigns.campaigns.find((c) => c.id === opts.campaignId);
  if (!campaign) throw new Error(`Nie ma kampanii ${opts.campaignId} w campaigns.json`);
  const outDir = opts.outDir;
  mkdirSync(path.join(outDir, "files"), { recursive: true });

  const nodeById = new Map(opts.graph.nodes.map((n) => [n.id, n]));
  const itemsById = new Map(opts.enriched.items.map((it) => [it.id, it]));
  const members: Item[] = campaign.members.map((id) => itemsById.get(id)).filter((x): x is Item => !!x);
  const missing = campaign.members.filter((id) => !itemsById.has(id));
  if (missing.length) throw new Error(`enriched.json nie zawiera reklam: ${missing.join(", ")} (uruchom enrich na tym samym zbiorze)`);

  const certList = opts.certList ?? null;
  const certListNote = opts.certListNote ?? null;
  /** Status of one domain on the CERT list from the local copy, as written to the pack (a plain "not checked" without a copy). */
  const certStatusRecord = (domain: string) => {
    if (!certList) return { checked: false, status: "unchecked", note: `niesprawdzone: ${certListNote ?? "brak lokalnej kopii listy"}; sprawdź https://hole.cert.pl/domains/v2/domains.json i zapisz RegisterPositionId oraz InsertDate` };
    const st = certStatus(certList, domain, now);
    return {
      checked: true,
      status: st.status,
      register_position_id: st.registerPositionId,
      insert_date: st.insertDate,
      delete_date: st.deleteDate,
      matched_entry: st.matched,
      list_copy_utc: st.copyUtc,
      source: "lokalna kopia listy, bez zapytań online",
    };
  };

  const manifest: ManifestEntry[] = [];
  const copied = new Map<string, string>();
  const usedDest = new Set<string>();
  /** Copies a file into the pack (optionally through a redactor), records it in the manifest and returns its path in the pack; null when the file does not exist. The same source is copied once; equal names get a number. */
  const addFile = (source: string, dest: string, acquired: string | null, sourceLabel: string, redact?: (text: string) => string): string | null => {
    const abs = path.isAbsolute(source) ? source : path.join(root, source);
    if (!existsSync(abs)) return null;
    if (copied.has(abs)) return copied.get(abs)!;
    // two different files of one name (screenshots of two cases) must not overwrite each other
    let target = dest;
    for (let n = 2; usedDest.has(target); n++) target = dest.replace(/(\.[^./]*)?$/, `-${n}$1`);
    usedDest.add(target);
    const destAbs = path.join(outDir, target);
    mkdirSync(path.dirname(destAbs), { recursive: true });
    const derived: Pick<ManifestEntry, "derived_from_sha256" | "redaction"> = {};
    if (redact) {
      // the redacted text is the pack's file; the original stays with the analyst and is identified by its hash
      writeFileSync(destAbs, redact(readFileSync(abs, "utf8")));
      derived.derived_from_sha256 = sha256File(abs);
      derived.redaction = "zredagowana kopia: bez ciasteczek, nagłówków i danych odwiedzającego analityka oraz z zamaskowanymi tokenami";
    } else copyFileSync(abs, destAbs);
    manifest.push({ file: target, sha256: sha256File(destAbs), size: statSync(destAbs).size, mime: mimeOf(destAbs), acquired_utc: acquired, source: sourceLabel, ...derived });
    copied.set(abs, target);
    return target;
  };
  /** WARC files made of the redacted HARs, by the pack path of the HAR; and the WARC of each target host. */
  const warcOfHar = new Map<string, string>();
  const warcOfHost = new Map<string, string>();
  const addWarc = (harInPack: string, originalSha: string | null): void => {
    if (warcOfHar.has(harInPack)) return;
    const harAbs = path.join(outDir, harInPack);
    const warc = harToWarc(readFileSync(harAbs, "utf8"), { now, tool: `${toolVersion.name} ${toolVersion.version}` });
    const dest = `files/warc/${path.basename(harInPack).replace(/\.har$/i, "")}.warc.gz`;
    const destAbs = path.join(outDir, dest);
    mkdirSync(path.dirname(destAbs), { recursive: true });
    writeFileSync(destAbs, warc.data);
    manifest.push({
      file: dest,
      sha256: sha256File(destAbs),
      size: statSync(destAbs).size,
      mime: "application/warc",
      acquired_utc: now.toISOString(),
      source: `WARC (ISO 28500) z zredagowanego HAR ${harInPack}: ${warc.records} rekordów`,
      ...(originalSha ? { derived_from_sha256: originalSha, redaction: "zredagowana kopia HAR przeniesiona do WARC" } : {}),
    });
    warcOfHar.set(harInPack, dest);
    for (const t of warc.targets) {
      const host = normalizeUrl(t)?.registrableDomain;
      if (host && !warcOfHost.has(host)) warcOfHost.set(host, dest);
    }
  };
  // path.resolve: import ze spraw zapisuje ścieżki bezwzględne, których path.join skleiłby z katalogiem zbioru
  const datasetDir = path.resolve(root, opts.enriched.baseDir);

  // ---------------------------------------------------------------- ads (facts)
  /** Page record the ad leads to, or null. */
  const pagesOf = (item: Item): PageInfo | null => {
    const enr = opts.enriched.perItem[item.id];
    return enr?.pageKey ? (opts.enriched.pages[enr.pageKey] ?? null) : null;
  };
  const ads = members.map((item) => {
    const enr = opts.enriched.perItem[item.id];
    const page = pagesOf(item);
    const data = nodeById.get(`item:${item.id}`)?.data ?? {};
    const shown = data.displayedDomainMismatch as { displayed: string; landing: string; source: string; confidence: string } | undefined;
    const creatives: Array<{ file: string; sha256: string | null; source: string }> = [];
    if (item.imagePath) {
      const dest = addFile(path.resolve(datasetDir, item.imagePath), `files/creatives/${path.basename(item.imagePath)}`, null, `plik kreacji reklamy ${item.id}`);
      if (dest) creatives.push({ file: dest, sha256: manifest.find((m) => m.file === dest)?.sha256 ?? null, source: item.imagePath });
    } else if (item.imageUrl) {
      creatives.push({ file: item.imageUrl, sha256: null, source: "URL obrazu (plik nie został zachowany przez starter)" });
    }
    if (item.videoPath) {
      const dest = addFile(path.resolve(datasetDir, item.videoPath), `files/media/${path.basename(item.videoPath)}`, null, `nagranie reklamy ${item.id}`);
      if (dest) creatives.push({ file: dest, sha256: manifest.find((m) => m.file === dest)?.sha256 ?? null, source: item.videoPath });
    }
    const adUrlColumns = Object.entries(item.extra).filter(([k]) => /url|link|permalink|snapshot/i.test(k));
    const library = adLibraryFacts(item, enr);
    const companyFacts = companyIdsOfMaterial(page?.extract, [enr?.ocrText, enr?.extraOcrText].filter(Boolean).join("\n"));
    const inputs = caseFilesOf(opts.provenance, item.id);
    // input files of the case with the checksums taken at import; the copy in the pack is checked against them
    const sourceFiles = inputs.files.map((f) => {
      const dir = SOURCE_FILE_DIR[f.role];
      let inPack: string | null = null;
      let copyError: string | null = null;
      try {
        inPack = dir && f.sha256 ? addFile(f.path, `${dir}/${path.basename(f.path)}`, f.modifiedUtc, `plik wejściowy sprawy: ${SOURCE_FILE_LABEL[f.role]}`, REDACTORS[f.role]) : null;
      } catch (e) {
        // a file that cannot be redacted (e.g. a HAR that is not JSON) must not be copied as it is
        copyError = (e as Error).message;
      }
      if (inPack && f.role === "har" && !copyError) {
        try {
          addWarc(inPack, f.sha256);
        } catch (e) {
          copyError = `HAR skopiowany zredagowany, ale bez WARC: ${(e as Error).message}`;
        }
      }
      const entry = inPack ? manifest.find((m) => m.file === inPack) : undefined;
      const packSha = entry ? (entry.derived_from_sha256 ?? entry.sha256) : null;
      return {
        role: f.role,
        role_label: SOURCE_FILE_LABEL[f.role],
        file_name: path.basename(f.path),
        sha256: f.sha256,
        size: f.size,
        acquired_utc: f.modifiedUtc,
        imported_utc: inputs.importedAt,
        in_pack: inPack,
        note: f.error
          ? `plik nieczytelny przy imporcie: ${f.error}`
          : copyError
            ? `plik nie został skopiowany, bo nie dało się go zredagować: ${copyError}`
            : !inPack
              ? "plik nie został znaleziony przy eksporcie paczki"
              : packSha !== f.sha256
                ? "suma pliku w paczce różni się od sumy z importu: plik zmieniono po imporcie"
                : entry?.derived_from_sha256
                  ? "w paczce zredagowana kopia (bez danych analityka); sha256 dotyczy oryginału"
                  : null,
      };
    });
    return {
      item_id: item.id,
      platform: item.platform,
      service: item.platform ? `reklama w serwisie ${item.platform}` : null,
      ad_urls: [...new Set([...adUrlColumns.map(([, v]) => v), ...library.urls])],
      ad_ids: { ad_id: item.id, ...Object.fromEntries(Object.entries(item.extra).filter(([k]) => /(^|_)id$|_id_/i.test(k))), ...(library.ids.length ? { ad_library_id: library.ids[0] } : {}) },
      advertiser_displayed: item.advertiser,
      advertiser_note: nodeById.get(`item:${item.id}`)?.data.advertiserMismatch === true ? "konto reklamowe prawdopodobnie przejęte (nazwa nie pasuje do treści)" : null,
      payer_displayed: library.payer ?? item.extra.ad_payers ?? null,
      beneficiary_displayed: library.beneficiary,
      // a hint from the look of the declared names, not a fact about who paid: the advertiser types them in and the platform does not verify them
      payer_kinds: library.payerKinds,
      payer_equals_beneficiary: library.payerEqualsBeneficiary,
      payer_suspicious: library.payerSuspicious,
      payer_notes: library.payerNotes,
      company_identifiers: companyFacts.companyIds.map((c) => ({ kind: c.kind, value: c.value, checksum_valid: c.valid, check: c.check, source: c.source, quote: c.quote })),
      legal_entities: companyFacts.legalEntities,
      shop_signals: shopFacts(page?.extract, item.firstSeen),
      repository_record: library.records,
      first_seen_utc: utc(item.firstSeen),
      last_seen_utc: utc(item.lastSeen ?? item.firstSeen),
      ad_text: item.text,
      landing_url: item.landingUrl,
      landing_chain: page
        ? [...page.fetch.redirectChain.map((h) => ({ url: h.url, status: h.status, kind: h.kind })), { url: page.fetch.finalUrl, status: page.fetch.status, kind: "final" }]
        : [],
      landing_fetched_utc: page ? utc(page.fetch.fetchedAt) : null,
      landing_user_agent: page?.fetch.userAgent ?? null,
      campaign_params: [...(enr?.campaignParams ?? []), ...(page?.kit?.pageParams ?? [])].map((p) => ({ name: p.name, value: p.value, source_url: p.sourceUrl, cyrillic: p.cyrillic, origin: p.origin ?? "url" })),
      // the key itself is never written: preview (first and last characters) and SHA-256 only
      crm_keys: (page?.kit?.crmKeys ?? []).map((k) => ({ preview: k.preview, sha256: k.sha256, field: k.name, via: k.via })),
      // affiliate-network accounts of the page's forms and links (B-330); an api_key appears as its SHA-256 only
      affiliate_accounts: (page?.kit?.affiliateIds ?? []).map((a) => ({ kind: a.kind, network_host: a.host, value: a.value, via: a.via, ...(a.attrs ? { attrs: a.attrs } : {}) })),
      // techniques of the landing page (attributes of the scheme, not links) with where they were read
      page_techniques: ((data.techniques as string[] | undefined) ?? []).map((t) => ({
        technique: t,
        label: TECHNIQUE_LABEL[t] ?? t,
        source: page ? `kod strony docelowej ${defangUrl(page.fetch.finalUrl)}, pobrany ${utc(page.fetch.fetchedAt)}` : "kod strony docelowej",
      })),
      // ClickFix: kind and SHA-256 of the copied command only; the command is a malware payload and is never written
      clickfix_command: (data.clickfix as { kind: string; sha256: string } | undefined) ?? null,
      // the domain shown in the ad against the page it leads to, defanged like the other addresses of the report
      displayed_domain_mismatch: shown
        ? { displayed: defangUrl(shown.displayed), landing: defangUrl(shown.landing), source: shown.source, confidence: shown.confidence, brand_domain: data.displayedBrandDomain === true }
        : null,
      look_alike_host: data.idnConfusable
        ? { kind: (data.idnConfusable as { kind: string }).kind, looks_like: defangUrl((data.idnConfusable as { looksLike: string }).looksLike), char: (data.idnConfusable as { char: string }).char }
        : null,
      ad_start_weekday: data.adStartWeekday ?? null,
      discord_id_created: ((data.discordSnowflakes as Array<{ id: string; kind: string; createdAt: string }> | undefined) ?? []).map((d) => ({ id: d.id, kind: d.kind, created_utc: d.createdAt })),
      phone_lines: (data.phoneLines as Array<{ phone: string; lineType: string; country: string | null }> | undefined)?.map((l) => ({ phone: l.phone, line_type: l.lineType, country: l.country })) ?? [],
      phone_flags: { country_mismatch: data.phoneCountryMismatch === true, toll_free_on_alert: data.tollFreeOnAlert === true },
      creative_files: creatives,
      source_files: sourceFiles,
    };
  });

  // ---------------------------------------------------------------- domains (facts)
  const domainHosts = new Map<string, Set<string>>();
  const domainPages = new Map<string, PageInfo[]>();
  // Financial service: a conclusion from the narrative of the ad (a financial topic in its copy or page),
  // quoted, never a keyword match alone (a bare "platforma" is no investment offer)
  const domainOffer = new Map<string, string>();
  for (const item of members) {
    const page = pagesOf(item);
    const narrative = nodeById.get(`item:${item.id}`)?.data.narrative as MaterialNarrative | undefined;
    const topic = narrative?.topics.find((t) => DEFAULT_NARRATIVE_CONFIG.financialTopics.includes(t.id));
    const offerDomain = registrableDomain(page?.fetch.finalUrl ?? item.landingUrl ?? "");
    if (topic && offerDomain && !domainOffer.has(offerDomain)) {
      const text = [item.text, page?.extract?.title, page?.extract?.description, page?.extract?.visibleText].filter(Boolean).join("\n");
      domainOffer.set(offerDomain, `„${topicQuote(text, topic.id) ?? topic.terms.join(", ")}” (wniosek z narracji materiału: ${topic.id})`);
    }
    const urls = page ? [...page.fetch.redirectChain.map((h) => h.url), page.fetch.finalUrl] : item.landingUrl ? [item.landingUrl] : [];
    for (const u of urls) {
      const n = normalizeUrl(u);
      if (!n?.registrableDomain) continue;
      if (!domainHosts.has(n.registrableDomain)) domainHosts.set(n.registrableDomain, new Set());
      domainHosts.get(n.registrableDomain)!.add(n.host);
    }
    if (page) {
      const d = registrableDomain(page.fetch.finalUrl);
      if (d) {
        const list = domainPages.get(d) ?? [];
        if (!list.includes(page)) list.push(page);
        domainPages.set(d, list);
      }
    }
  }
  const excluded: Array<{ domain: string; reason: string }> = [];
  const domains = [...domainHosts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, hosts]) => {
      const platform = discounter.domainDiscount(domain);
      if (platform) excluded.push({ domain, reason: platform.reason });
      const di = opts.enriched.domains[domain];
      const hostInfos = [...hosts].map((h) => opts.enriched.hosts[h]).filter(Boolean);
      const ips = [...new Set(hostInfos.flatMap((h) => h.ips))].map((ip) => {
        const a = opts.enriched.ips[ip];
        return { ip, asn: a?.asn ?? null, as_name: a?.asName ?? null, prefix: a?.prefix ?? null };
      });
      const pages = (domainPages.get(domain) ?? []).map((p) => {
        const archived = p.archiveFile ? addFile(p.archiveFile, `files/html/${path.basename(p.archiveFile)}`, utc(p.fetch.fetchedAt), `zdekodowany HTML strony ${p.fetch.finalUrl} (pobrano ${formatUtc(utc(p.fetch.fetchedAt))})`) : null;
        return {
          url: p.fetch.finalUrl,
          requested_url: p.requestedUrl,
          fetched_utc: utc(p.fetch.fetchedAt),
          status: p.fetch.status,
          user_agent: p.fetch.userAgent,
          content_source: p.cloaking?.suspected
            ? `pobranie narzędzia z User-Agent „${p.fetch.userAgent}”; podejrzenie cloakingu (${p.cloaking.reasons.join("; ")}): treść widziana przez ofiarę może się różnić`
            : `pobranie narzędzia z User-Agent „${p.fetch.userAgent}”`,
          body_sha256_raw: p.fetch.bodySha256,
          archive_file: archived,
          title: p.extract?.title ?? null,
          cloaking_check: p.cloaking
            ? { suspected: p.cloaking.suspected, reasons: p.cloaking.reasons, crawler_final_url: p.cloaking.crawler.finalUrl, mobile_final_url: p.cloaking.mobile.finalUrl }
            : null,
        };
      });
      const kitPages = domainPages.get(domain) ?? [];
      return {
        domain_fqdn: domain,
        hosts: [...hosts].sort(),
        excluded_from_cert_list: platform ? platform.reason : null,
        primary_purpose_evidence: {
          note: "fakty z kodu i treści strony; ocena „podstawowego celu” należy do człowieka",
          form_backends: [...new Set(kitPages.flatMap((p) => p.kit?.endpoints.map((e) => (e.sameOrigin ? `${new URL(p.fetch.finalUrl).host}${e.pathTemplate}` : `${e.host}${e.pathTemplate}`)) ?? []))],
          hidden_fields: [...new Set(kitPages.flatMap((p) => p.kit?.hiddenFields ?? []))],
          contact_points: [...new Set(kitPages.flatMap((p) => [...(p.extract?.emails ?? []), ...(p.extract?.phones ?? []), ...(p.extract?.telegram ?? []), ...(p.extract?.whatsapp ?? [])]))],
          trackers: [...new Set(kitPages.flatMap((p) => p.extract?.trackers.map((t) => `${t.kind}:${t.id}`) ?? []))],
        },
        pages,
        warc_file: warcOfHost.get(domain) ?? null,
        screenshots: [] as string[],
        registration_data: {
          registrar: di?.rdap?.registrar ?? null,
          registrar_iana_id: di?.rdap?.registrarIanaId ?? null,
          abuse_email: di?.rdap?.abuseEmail ?? null,
          rdap_source: di?.rdap?.source ?? null,
          rdap_query_note: di?.rdap ? "czas zapytania RDAP nie jest zapisywany przez enrich; odpowiedź pochodzi z cache do tygodnia (CACHE_TTL.rdap)" : "brak odpowiedzi RDAP",
          created_utc: utc(di?.rdap?.created),
          expires_utc: utc(di?.rdap?.expires),
          status: di?.rdap?.status ?? [],
          nameservers: di?.ns ?? [],
          mx: di?.mx ?? [],
          ips,
          cname_chains: Object.fromEntries(hostInfos.filter((h) => h.cnameChain.length).map((h) => [h.host, h.cnameChain])),
          certificates: (di?.ct?.certs ?? []).slice(0, 10).map((c) => ({ issuer: c.issuer, not_before: c.notBefore, not_after: c.notAfter, san_count: c.sanDomains.length, crtsh_id: c.id })),
        },
        cert_warning_list_status: certStatusRecord(domain),
        financial_service_offered: domainOffer.get(domain) ?? null,
        payment_identifiers: [...new Set(kitPages.flatMap((p) => p.extract?.wallets.map((w) => `${w.kind}:${w.address}`) ?? []))],
      };
    });
  const adHostsOf = (a: (typeof ads)[number]): Set<string> => new Set([a.landing_url, ...a.landing_chain.map((h) => h.url)].map((u) => (u ? registrableDomain(u) : null)).filter((d): d is string => !!d));
  // screenshots of the landing page that the case supplied, attached to the domains the ads lead to
  for (const d of domains) {
    d.screenshots = [...new Set(ads.filter((a) => adHostsOf(a).has(d.domain_fqdn)).flatMap((a) => a.source_files.filter((f) => f.role === "page_screenshot" && f.in_pack).map((f) => f.in_pack!)))];
  }
  const certPlan = planCertDomains(
    domains.map((d) => ({
      domain: d.domain_fqdn,
      hosts: d.hosts,
      excludedReason: d.excluded_from_cert_list,
      ads: ads.filter((a) => adHostsOf(a).has(d.domain_fqdn)).length,
      landing: d.pages.length > 0,
    })),
    certList,
    now,
    certListNote,
  );
  const certDomains = certPlan.report.map((l) => l.name);

  // ---------------------------------------------------------------- persona (no biometric templates)
  const personaMap = new Map<string, { name: string; role: string | null; bases: Set<string>; items: Set<string> }>();
  for (const item of members) {
    for (const p of opts.enriched.perItem[item.id]?.personas ?? []) {
      const cur = personaMap.get(p.id) ?? { name: p.name, role: p.role, bases: new Set<string>(), items: new Set<string>() };
      cur.bases.add(
        p.source === "ingest"
          ? "wskazanie w danych wejściowych (kolumna persona, np. DROZD)"
          : p.source === "ner"
            ? "NER modelu językowego (wynik modelu — wskazówka)"
            : p.fuzzy
              ? "nazwisko w tekście z OCR/ASR (dopasowanie przybliżone — wskazówka)"
              : "nazwisko w tekście reklamy lub strony (lista obserwowanych osób)",
      );
      cur.items.add(item.id);
      personaMap.set(p.id, cur);
    }
  }
  const deepfakeScores = members.filter((m) => m.deepfakeScore !== null).map((m) => ({ item_id: m.id, score: m.deepfakeScore }));
  const impersonated = [...personaMap.entries()].map(([id, p]) => ({
    persona_id: id,
    impersonated_person: p.name,
    public_role: p.role,
    consent_status: "nieustalone — oświadczenie o braku zgody dołącza osoba lub pełnomocnik, nie narzędzie",
    match_basis: [...p.bases],
    ads: [...p.items].sort(),
    biometric_data: "brak — paczka nie zawiera wzorców biometrycznych twarzy ani głosu",
    synthetic_media_assessment: deepfakeScores.length
      ? { kind: "wynik modelu (wskazówka, nie dowód)", source: "kolumna wyniku deepfake w danych wejściowych (np. DROZD)", scores: deepfakeScores.filter((s) => p.items.has(s.item_id)) }
      : null,
  }));

  // ---------------------------------------------------------------- accounts (facts)
  const libraryPages = (m: Item) => (opts.enriched.perItem[m.id]?.adLibrary ?? []).filter((r) => !r.error && r.pageId);
  const accountName = (m: Item): string | null => m.advertiser ?? opts.enriched.perItem[m.id]?.advertiserOcr ?? libraryPages(m)[0]?.pageName ?? null;
  const accounts = [...new Set(members.map(accountName).filter((a): a is string => !!a))].sort().map((name) => {
    const own = members.filter((m) => accountName(m) === name);
    const pageIds = [...new Set(own.flatMap((m) => libraryPages(m).map((r) => r.pageId!)))].sort();
    return {
      advertiser_displayed: name,
      platforms: [...new Set(own.map((m) => m.platform).filter(Boolean))],
      ads: own.map((m) => m.id),
      page_ids: pageIds,
      page_urls: pageIds.map(pageUrl),
      library_account: libraryAccount(own),
    };
  });

  // ---------------------------------------------------------------- observations vs analysis
  const memberSet = new Set(campaign.members);
  const internal: ItemLink[] = opts.graph.links.filter((l) => memberSet.has(l.a) && memberSet.has(l.b));
  const { identifiers: sharedIdentifiers, context: sharedContext } = sharedTraces(internal, nodeById);
  const whyByAd = new Map(ads.map((a) => [a.item_id, whyInCampaign(a.item_id, sharedIdentifiers)]));
  const edgeTypes = [...new Set(internal.flatMap((l) => l.evidence.filter((e) => e.kind === "similarity" && e.edgeType).map((e) => e.edgeType as string)))];
  const firstSeen = campaign.firstSeen ? campaign.firstSeen.slice(0, 10) : "?";
  const lastSeen = campaign.lastSeen ? campaign.lastSeen.slice(0, 10) : "?";
  const platforms = [...new Set(members.map((m) => m.platform).filter(Boolean))].join(", ") || "brak danych";
  const personaNames = impersonated.map((p) => p.impersonated_person).join(", ") || "brak wskazań";
  const priorReports = (opts.priorReports ?? []).filter((r) => !r.campaign_id || r.campaign_id === campaign.id);
  const summaryFacts =
    `W okresie ${firstSeen} – ${lastSeen} zarejestrowano ${members.length} reklam (platformy: ${platforms}) ` +
    `kierujących do ${domains.length} domen (${domains.map((d) => d.domain_fqdn).join(", ") || "brak"}). ` +
    `W treści reklam lub danych wejściowych wskazano osoby: ${personaNames}. ` +
    `Reklamy łączą wspólne identyfikatory: ${sharedIdentifiers.slice(0, 5).map((s) => `${traceTypeName(s.type).toLowerCase()} ${s.value}`).join("; ") || "brak"}.`;
  const hasFinancialOffer = domainOffer.size > 0;

  const summary = opts.summaries?.[campaign.id];
  const analysis = {
    note: "wyniki modeli i heurystyk — wskazówki do oceny przez człowieka, nie dowód tożsamości ani rozstrzygnięcie",
    campaign_assignment: {
      campaign_id: campaign.id,
      method: opts.campaigns.method,
      cohesion: campaign.cohesion,
      strong_components: campaign.strongComponents,
    },
    link_scores: internal.slice(0, 200).map((l) => ({ a: l.a, b: l.b, score: l.score, strong: l.strong, evidence: l.evidence.slice(0, 4).map((e) => e.evidence) })),
    similarity_methods: methodsWithPremises(
      {
        image: `dHash 64 bit, próg Hamminga ${config.similarity.imageHamming}`,
        text: `${opts.graph.textMethod}, próg ${opts.graph.textMethod === "embedding" ? config.similarity.text.embeddingThreshold : config.similarity.text.tfidfThreshold}`,
        dom: `simhash struktury DOM, próg ${config.similarity.dom.hamming}`,
        audio: `Chromaprint, próg ${config.similarity.audio.minSimilarity}`,
      },
      edgeTypes,
    ),
    persona_ner: [...personaMap.values()].some((p) => [...p.bases].some((b) => b.startsWith("NER"))) ? "użyto NER modelu językowego (patrz match_basis)" : "nie użyto",
    deepfake_scores: deepfakeScores,
    llm_summary: summary ? { model: summary.model, generated_utc: summary.generatedAt, persona: summary.persona, narrative: summary.narrative, infrastructure: summary.infrastructure } : null,
  };

  const record: Record<string, unknown> = {
    package_id: opts.packageId ?? randomUUID(),
    version: "starter-evidence/1.0 (wg sekcji 5 raportu „Prawo i dowody”)",
    created_utc: now.toISOString(),
    tool_version: { ...toolVersion, link_config: { strongThreshold: config.strongThreshold, minLinkScore: config.minLinkScore, louvain: config.louvain } },
    submitter: {
      name: opts.submitter?.name ?? TODO("imię i nazwisko / nazwa zgłaszającego"),
      email: opts.submitter?.email ?? TODO("e-mail zgłaszającego"),
      address: opts.submitter?.address ?? TODO("adres (wymagany m.in. w skardze do UODO)"),
      role: opts.submitter?.role ?? TODO("rola: operator narzędzia / pełnomocnik / osoba, której dane dotyczą"),
    },
    good_faith_statement: GOOD_FAITH_STATEMENT,
    tlp: opts.tlp ?? "TLP:AMBER",
    pap: "PAP:AMBER",
    summary_facts: summaryFacts,
    legal_assessment: {
      note: "(wniosek) propozycje podstaw do weryfikacji przez prawnika — narzędzie nie rozstrzyga o nielegalności ani o winie",
      candidates: [
        "art. 286 k.k. (oszustwo)",
        "art. 190a § 2 k.k. (podszywanie się pod inną osobę)",
        "art. 81 ustawy o prawie autorskim i prawach pokrewnych (rozpowszechnianie wizerunku bez zgody)",
        "art. 23–24 k.c. (dobra osobiste)",
        "art. 7 pkt 4 ustawy o przeciwdziałaniu nieuczciwym praktykom rynkowym",
        ...(hasFinancialOffer ? ["art. 178 ustawy o obrocie instrumentami finansowymi / art. 171 prawa bankowego (działalność bez zezwolenia) — jeśli oferta dotyczy usług finansowych"] : []),
        ...(deepfakeScores.length ? ["art. 50 ust. 4 AI Act (oznaczanie treści deepfake) — jeśli materiał jest syntetyczny"] : []),
      ],
    },
    requested_action: requestedActions(hasFinancialOffer),
    prior_reports: priorReports,
    reports_register: {
      note: "dziennik zgłoszeń (--prior): odbiorca, data, kategoria, wynik; lista „czeka na reakcję” dla ponowienia zgłoszenia",
      wait_days: REPORT_WAIT_DAYS,
      waiting: pendingReports(priorReports, now).map((p) => ({ recipient: p.entry.recipient, reported_utc: p.entry.reported_utc, days_waiting: p.days })),
    },
    harm_and_victims: {
      note: "szkoda i pokrzywdzeni: dane od osób i instytucji, nie z narzędzia",
      victims_reported: TODO("liczba zgłoszeń od pokrzywdzonych i ich źródło"),
      harm_to_impersonated: TODO("szkoda osoby, której wizerunek użyto"),
      continuation_after_notice: continuationAfterNotice(priorReports, ads),
    },
    impersonated_person: impersonated,
    observations: {
      note: "fakty: co zarejestrowano, gdzie i kiedy (UTC)",
      shared_identifiers: sharedIdentifiers,
      shared_context_not_linking: { note: "ślady wspólne dla wielu niezależnych stron (np. serwery nazw i adresy IP Cloudflare, duży rejestrator): wagi je obniżyły, nie łączą reklam w kampanię", traces: sharedContext },
      ads_to_listed_domains: certPlan.adsToListed,
      ads: ads.map((a) => ({ ...a, why_in_campaign: whyByAd.get(a.item_id) ?? null })),
      domains,
      accounts,
    },
    analysis,
    integrity: {} as Record<string, unknown>,
  };

  // ---------------------------------------------------------------- outputs
  const retention = retentionPolicy();
  const fetchTimes = members.map((m) => utc(pagesOf(m)?.fetch.fetchedAt)).filter((t): t is string => !!t).sort();
  const files: string[] = [];
  /** Writes a generated text file of the pack (creating its folder) and remembers it for the manifest. */
  const write = (rel: string, content: string) => {
    mkdirSync(path.dirname(path.join(outDir, rel)), { recursive: true });
    writeFileSync(path.join(outDir, rel), content, "utf8");
    files.push(rel);
  };
  const certChunks: string[][] = [];
  for (let i = 0; i < certDomains.length; i += 50) certChunks.push(certDomains.slice(i, i + 50));
  write("cert-domains.txt", `${certDomains.join("\n")}${certDomains.length ? "\n" : ""}`);
  if (certChunks.length > 1) certChunks.forEach((chunk, i) => write(`cert-domains-${i + 1}.txt`, `${chunk.join("\n")}\n`));
  write("cert-domains-uzasadnienie.md", renderCertReasons(certPlan, campaign.id));
  const dsaInput: DsaInput = {
    campaignId: campaign.id,
    packageId: String(record.package_id),
    createdUtc: String(record.created_utc),
    ads,
    submitter: record.submitter as Submitter,
    legalCandidates: (record.legal_assessment as { candidates: string[] }).candidates,
    personas: impersonated.map((p) => p.impersonated_person),
    financialOffer: hasFinancialOffer,
    deepfake: deepfakeScores.length > 0,
    domains: domains.map((d) => ({ domain: d.domain_fqdn, created_utc: d.registration_data.created_utc, cert_status: d.cert_warning_list_status.status as "active" | "removed" | "absent" | "unchecked", cert_insert_date: d.cert_warning_list_status.insert_date ?? null })),
    goodFaith: GOOD_FAITH_STATEMENT,
  };
  const dsaNotices = renderDsaNotices(dsaInput);
  for (const n of dsaNotices) write(n.file, n.content);
  write("dsa-art16-notice.md", renderDsaIndex(dsaInput, dsaNotices));
  const facts: CampaignFacts = {
    campaignId: campaign.id,
    packageId: String(record.package_id),
    createdUtc: String(record.created_utc),
    firstSeenUtc: utc(campaign.firstSeen),
    lastSeenUtc: utc(campaign.lastSeen),
    ads: ads.map((a) => ({ item_id: a.item_id, platform: a.platform, ad_ids: a.ad_ids, ad_urls: a.ad_urls, first_seen_utc: a.first_seen_utc, last_seen_utc: a.last_seen_utc })),
    domains: domains.map((d) => ({
      domain: d.domain_fqdn,
      created_utc: d.registration_data.created_utc,
      registrar: d.registration_data.registrar,
      registrar_iana_id: d.registration_data.registrar_iana_id,
      abuse_email: d.registration_data.abuse_email,
      nameservers: d.registration_data.nameservers,
      ips: d.registration_data.ips.map((i) => ({ ip: i.ip, asn: i.asn, as_name: i.as_name })),
      cert_status: d.cert_warning_list_status.status as "active" | "removed" | "absent" | "unchecked",
      cert_insert_date: d.cert_warning_list_status.insert_date ?? null,
      ads: ads.filter((a) => adHostsOf(a).has(d.domain_fqdn)).length,
      payment_identifiers: d.payment_identifiers,
      contact_points: d.primary_purpose_evidence.contact_points,
      shared_infrastructure: d.excluded_from_cert_list !== null,
    })),
    personas: dsaInput.personas,
    financialOffer: hasFinancialOffer,
    deepfake: deepfakeScores.length > 0,
    priorReports: (record.prior_reports as unknown[]).length,
  };
  write("preservation-request.md", renderPreservationRequest(facts));
  const knf = renderKnfNotice(facts);
  if (knf) write("knf-notification.md", knf);
  write("prosecutor-notification.md", renderProsecutorNotice(facts));
  for (const r of recipientFiles(facts)) write(r.file, r.content);
  const stix = buildStixBundle(facts, {
    tlp: String(record.tlp),
    urls: ads.flatMap((a) => [a.landing_url, ...a.landing_chain.filter((h) => h.kind === "final").map((h) => h.url)]).filter((u): u is string => !!u),
    imageHashes: members.map((m) => opts.enriched.perItem[m.id]?.image?.dhash).filter((h): h is string => !!h),
    modelNotes: deepfakeScores.map((s) => `reklama ${s.item_id}: wynik deepfake ${s.score} (wynik modelu, wskazówka)`),
    certRegisterIds: Object.fromEntries(domains.filter((d) => d.cert_warning_list_status.status === "active" && d.cert_warning_list_status.register_position_id != null).map((d) => [d.domain_fqdn, String(d.cert_warning_list_status.register_position_id)])),
  });
  write("stix-bundle.json", `${JSON.stringify(stix, null, 2)}\n`);
  for (const f of [...files]) {
    const abs = path.join(outDir, f);
    manifest.push({ file: f, sha256: sha256File(abs), size: statSync(abs).size, mime: mimeOf(abs), acquired_utc: now.toISOString(), source: "wygenerowane przez starter" });
  }
  manifest.sort((a, b) => a.file.localeCompare(b.file));
  const manifestText = manifest.map((m) => `${m.sha256}  ${m.file}`).join("\n") + "\n";
  writeFileSync(path.join(outDir, "manifest.sha256"), manifestText, "utf8");
  const manifestSha = createHash("sha256").update(manifestText).digest("hex");
  record.integrity = {
    manifest,
    manifest_file: "manifest.sha256",
    manifest_sha256: manifestSha,
    verify_command: "shasum -a 256 -c manifest.sha256",
    ...timestampFields(null, null),
    seal: null,
    custody_log: buildCustodyLog({
      campaignId: campaign.id,
      exportUtc: now.toISOString(),
      tool: `${toolVersion.name} ${toolVersion.version}${toolVersion.gitCommit ? ` (${toolVersion.gitCommit})` : ""}`,
      manifestSha256: manifestSha,
      imports: members.flatMap((m) => {
        const c = opts.provenance?.cases.find((x) => x.id === m.id);
        return c ? [{ id: c.id, importedUtc: c.importedAt ?? null, files: (c.files ?? []).map((f) => ({ role: f.role, name: path.basename(f.path), sha256: f.sha256 })) }] : [];
      }),
      enrich: {
        generatedUtc: opts.enriched.generatedAt,
        mode: opts.enriched.mode,
        fetchedFirstUtc: fetchTimes[0] ?? null,
        fetchedLastUtc: fetchTimes.at(-1) ?? null,
        userAgents: [...new Set(members.map((m) => pagesOf(m)?.fetch.userAgent).filter((u): u is string => !!u))],
      },
    }),
    personal_data_inventory: [
      { category: "imię i nazwisko osoby publicznej, której wizerunek użyto", basis: "art. 6 ust. 1 lit. f RODO (wniosek)", retention: retention.caseMaterial },
      { category: "nazwy kont reklamodawców", basis: "art. 6 ust. 1 lit. f RODO (wniosek)", retention: retention.caseMaterial },
      { category: "dane kontaktowe i portfele widoczne w reklamach i na stronach", basis: "art. 6 ust. 1 lit. f RODO (wniosek)", retention: retention.caseMaterial },
      { category: "dane rejestracyjne domen (publiczny RDAP)", basis: "art. 6 ust. 1 lit. f RODO (wniosek)", retention: `${retention.caseMaterial}; ${retention.network}` },
      { category: "osoby z komentarzy pod reklamą, transkrypcje i tekst z OCR, jeśli są w materiale", basis: "art. 6 ust. 1 lit. f RODO (wniosek)", retention: retention.caseMaterial },
      { category: "zapis ruchu przeglądarki (HAR) i zapisane strony: tylko zredagowane kopie, bez ciasteczek i danych odwiedzającego", basis: "art. 6 ust. 1 lit. f RODO (wniosek)", retention: retention.caseMaterial },
      { category: "wektory głosu i obrazu (nie trafiają do paczki)", basis: "poza paczką", retention: retention.models },
    ],
    excluded_from_cert_list: excluded,
    limitations: [
      "archiwum stron to zdekodowany HTML (UTF-8) i SHA-256 surowej odpowiedzi; WARC (ISO 28500) powstaje tylko z HAR dostarczonego przez sprawę (files/warc, po redakcji danych analityka), bez własnej archiwizacji stron; zrzuty ekranu tylko te, które dostarczyła sprawa (files/screenshots)",
      ads.some((a) => a.repository_record)
        ? "rekordy z biblioteki reklam (art. 39 DSA) są tylko dla reklam z identyfikatorem biblioteki i pobraniem --ad-library; dla pozostałych pobierz je przed zgłoszeniem"
        : "rekordy z biblioteki reklam (art. 39 DSA) nie zostały pobrane: uruchom enrich z --ad-library (potrzebny identyfikator biblioteki ze zrzutu) przed zgłoszeniem",
      certList ? `status na Liście Ostrzeżeń CERT z lokalnej kopii z ${certList.copyUtc ?? "nieznanej daty"} (bez zapytań online): może być nieaktualny` : `status na Liście Ostrzeżeń CERT niesprawdzony: ${certListNote ?? "brak lokalnej kopii listy"}`,
    ],
  };
  writeFileSync(path.join(outDir, "evidence.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  writeFileSync(path.join(outDir, "evidence.md"), renderMarkdown(record, campaign), "utf8");
  return { outDir, record, files: ["evidence.json", "evidence.md", "manifest.sha256", ...files, ...manifest.filter((m) => m.file.startsWith("files/")).map((m) => m.file)], certDomains };
}

/** Advertiser account named by an ad library (stable ID, legal name, country, verification), as written in the pack. */
interface LibraryAccount {
  platform: string;
  advertiser_id: string;
  legal_name: string | null;
  location: string | null;
  verified: boolean | null;
}

/**
 * The library account of the ads under one displayed advertiser name: the first ad with an account ID
 * decides (ads of one displayed name that name different accounts are rare, and the ads list keeps each ID).
 * Null when none of the ads comes from an ad-library record.
 */
function libraryAccount(ads: Item[]): LibraryAccount | null {
  for (const ad of ads) {
    const t = readAdRecordTraces(ad.extra);
    if (t?.advertiserId) return { platform: t.platform, advertiser_id: t.advertiserId, legal_name: t.legalName, location: t.location, verified: t.verified };
  }
  return null;
}

/**
 * One line of the report for the attributes of an ad (techniques of the page, the domain shown in the ad,
 * phone line types, kind and hash of a ClickFix command), or null when the ad has none. Addresses come
 * defanged from the record; the command itself is never part of it.
 */
function signalsLine(ad: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const techniques = ad.page_techniques as Array<{ label: string }>;
  if (techniques.length) parts.push(`techniki strony: ${techniques.map((t) => t.label).join(", ")}`);
  const click = ad.clickfix_command as { kind: string; sha256: string } | null;
  if (click) parts.push(`polecenie ClickFix: rodzaj ${click.kind}, SHA-256 ${click.sha256}`);
  const shown = ad.displayed_domain_mismatch as { displayed: string; landing: string; brand_domain: boolean } | null;
  if (shown) parts.push(`w reklamie pokazano domenę ${shown.displayed}${shown.brand_domain ? " (znana marka)" : ""}, a link prowadzi do ${shown.landing}`);
  const lookAlike = ad.look_alike_host as { looks_like: string; char: string } | null;
  if (lookAlike) parts.push(`adres udaje inny (znak ${lookAlike.char}): wygląda jak ${lookAlike.looks_like}`);
  const lines = ad.phone_lines as Array<{ phone: string; line_type: string; country: string | null }>;
  if (lines.length) parts.push(`numery: ${lines.map((l) => `${l.phone} (${l.line_type}${l.country ? `, ${l.country}` : ""})`).join(", ")}`);
  const flags = ad.phone_flags as { country_mismatch: boolean; toll_free_on_alert: boolean };
  if (flags.country_mismatch) parts.push("kraj numeru różni się od rynku reklamy");
  if (flags.toll_free_on_alert) parts.push("numer bezpłatny na stronie z fałszywym alarmem");
  return parts.length ? `- reklama ${ad.item_id}: ${parts.join("; ")}` : null;
}

/** Names of the kinds of declared payer, for the reader of evidence.md. */
const PAYER_KIND_NAME_PL: Record<string, string> = {
  placeholder: "zaślepka",
  gibberish: "bełkot z klawiatury",
  person_foreign_script: "imię i nazwisko w obcym alfabecie",
  person: "osoba prywatna",
  generic_corp: "ogólna nazwa firmowa",
  matches_page: "równy nazwie strony reklamodawcy",
  registered_form: "nazwa z formą prawną",
  other: "inny",
};

/**
 * The part of evidence.md on who the ad says pays and which company data the page gives: kinds of the
 * declared payer (a self-declaration under the DSA, which the platform does not verify: a hint, not proof of who paid)
 * and the company identifiers and accounts of the page with the result of their checksum. Empty when no ad has any.
 */
function renderAdIdentity(ads: Array<Record<string, unknown>>): string {
  const lines: string[] = [];
  for (const a of ads) {
    const kinds = a.payer_kinds as string[] | null;
    if (kinds?.length) {
      const notes = (a.payer_notes as string[] | undefined) ?? [];
      lines.push(`- ${a.item_id}: płatnik zadeklarowany w repozytorium reklam: ${kinds.map((k) => PAYER_KIND_NAME_PL[k] ?? k).join(", ")}; ${a.payer_equals_beneficiary ? "płatnik równy beneficjentowi" : "beneficjent inny niż płatnik albo niepodany"}${a.payer_suspicious ? "; nazwa wygląda na wymyśloną" : ""}. To deklaracja reklamodawcy, nie dowód, kto płacił.${notes.length ? ` ${notes.join(" ")}` : ""}`);
    }
    const ids = (a.company_identifiers as Array<{ kind: string; value: string; checksum_valid: boolean; check: string; source: string }> | undefined) ?? [];
    for (const c of ids) {
      lines.push(`- ${a.item_id}: ${c.kind.toUpperCase()} ${c.value} (źródło: ${c.source}; ${c.check === "checksum" ? `suma kontrolna ${c.checksum_valid ? "poprawna" : "błędna: numer zmyślony albo przepisany z błędem"}` : `format ${c.checksum_valid ? "poprawny" : "błędny"}, bez sumy kontrolnej`})`);
    }
  }
  return lines.length ? `#### Płatnik i dane firmy (wskazówki)\n\n${lines.join("\n")}\n\nIdentyfikatory firm i rachunki tylko wspierają powiązanie: dane firmy da się skopiować z cudzej strony.\n\n` : "";
}

/** evidence.md: the record in tables for a reader, in plain Polish names, with dates as `YYYY-MM-DD HH:MM UTC` and addresses defanged (raw only in evidence.json and the DSA notices). */
function renderMarkdown(record: Record<string, unknown>, campaign: Campaign): string {
  const obs = record.observations as {
    shared_identifiers: Array<{ type: string; value: string; ads_with_identifier: number }>;
    shared_context_not_linking: { note: string; traces: Array<{ type: string; value: string; ads_with_identifier: number; discount_reasons: string[] }> };
    ads: Array<Record<string, unknown>>;
    domains: Array<Record<string, unknown>>;
    accounts: Array<{ advertiser_displayed: string; ads: string[]; library_account: LibraryAccount | null }>;
  };
  const integrity = record.integrity as {
    manifest: ManifestEntry[];
    manifest_sha256: string;
    limitations: string[];
    excluded_from_cert_list: Array<{ domain: string; reason: string }>;
    personal_data_inventory: Array<{ category: string; basis: string; retention: string }>;
    custody_log: Array<{ utc: string; actor: string; action: string }>;
  };
  const personas = record.impersonated_person as Array<{ impersonated_person: string; public_role: string | null; match_basis: string[]; consent_status: string; biometric_data: string }>;
  const analysis = record.analysis as { campaign_assignment: { cohesion: number; strong_components: number }; deepfake_scores: Array<{ item_id: string; score: number | null }>; llm_summary: { model: string; narrative: string; infrastructure?: string | null } | null; similarity_methods: Record<string, string> };
  const actions = record.requested_action as Array<{ recipient: string; name: string; action: string }>;
  const submitter = record.submitter as Submitter;
  const cell = (v: unknown) => String(v ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const md = `# Paczka dowodów — kampania ${campaign.id}

| Pole | Wartość |
|---|---|
| package_id | \`${String(record.package_id)}\` |
| utworzono (UTC) | ${formatUtc(String(record.created_utc))} |
| narzędzie | ${cell((record.tool_version as { name: string; version: string }).name)} ${cell((record.tool_version as { version: string }).version)} |
| zgłaszający | ${cell(submitter.name)}, ${cell(submitter.email)} |
| TLP / PAP | ${cell(record.tlp)} / ${cell(record.pap)} |
| sha256 manifestu | \`${integrity.manifest_sha256}\` |

> Fakty (obserwacje) są oddzielone od wyników modeli (analiza). Narzędzie proponuje działania; decyzję o zgłoszeniu podejmuje człowiek.

## Streszczenie faktów

${String(record.summary_facts)}

## Osoba, której wizerunek użyto

Paczka nie zawiera wzorców biometrycznych.

${personas.map((p) => `- **${p.impersonated_person}**${p.public_role ? ` (${p.public_role})` : ""} — podstawa: ${p.match_basis.join("; ")}. Zgoda: ${p.consent_status}.`).join("\n") || "- brak wskazań"}

## Obserwacje (fakty)

### Wspólne identyfikatory

| Rodzaj śladu | Wartość | Reklamy |
|---|---|---|
${obs.shared_identifiers.map((s) => `| ${cell(traceTypeName(s.type))} | ${cell(s.value)} | ${s.ads_with_identifier} |`).join("\n")}

#### Ślady wspólne dla wielu niezależnych stron (nie łączą reklam)

${obs.shared_context_not_linking.traces.map((t) => `- ${traceTypeName(t.type)}: ${t.value} (${t.ads_with_identifier} reklam; ${t.discount_reasons.join(", ") || "wspólne dla wielu niezależnych stron"})`).join("\n") || "- brak"}

### Reklamy

| ID | Platforma | Reklamodawca | Pierwsza / ostatnia obserwacja (UTC) | Link docelowy | Dlaczego w kampanii |
|---|---|---|---|---|---|
${obs.ads.map((a) => `| ${cell(a.item_id)} | ${cell(a.platform)} | ${cell(a.advertiser_displayed)} | ${cell(formatUtc(a.first_seen_utc as string | null))} / ${cell(formatUtc(a.last_seen_utc as string | null))} | ${cell(a.landing_url)} | ${cell(a.why_in_campaign)} |`).join("\n")}

#### Tekst reklam

${obs.ads.map((a) => `- ${a.item_id}: ${a.ad_text ? `„${cell(String(a.ad_text).slice(0, 300))}”` : "brak tekstu"}`).join("\n")}

${renderAdIdentity(obs.ads)}${renderShopSignals(obs.ads)}### Sygnały materiałów (atrybuty, nie dowody powiązania)

${obs.ads.map((a) => signalsLine(a)).filter((l) => l !== null).join("\n") || "- brak"}

### Domeny

| Domena | Rejestrator | Utworzona (UTC) | NS | IP (ASN) |
|---|---|---|---|---|
${obs.domains
  .map((d) => {
    const reg = d.registration_data as { registrar: string | null; created_utc: string | null; nameservers: string[]; ips: Array<{ ip: string; asn: number | null; as_name: string | null }> };
    const mark = (name: string) => {
      const note = sharedInfrastructureNote(name);
      return note ? ` *(${note})*` : "";
    };
    return `| ${cell(defangHost(String(d.domain_fqdn)))}${d.excluded_from_cert_list ? " *(poza listą CERT)*" : ""} | ${cell(reg.registrar)} | ${cell(formatUtc(reg.created_utc))} | ${cell(reg.nameservers.map((n) => `${n}${mark(n)}`).join(", "))} | ${cell(reg.ips.map((i) => `${i.ip}${i.asn ? ` (AS${i.asn})` : ""}${mark(i.as_name ?? "")}`).join(", "))} |`;
  })
  .join("\n")}

### Konta reklamodawców

${obs.accounts.map((a) => `- „${a.advertiser_displayed}”: ${a.ads.join(", ")}${a.library_account ? `; konto w bibliotece reklam (${a.library_account.platform}): ${a.library_account.advertiser_id}${a.library_account.legal_name ? `, nazwa prawna „${a.library_account.legal_name}”` : ""}${a.library_account.location ? `, kraj ${a.library_account.location}` : ""}${a.library_account.verified === null ? "" : a.library_account.verified ? ", zweryfikowany" : ", niezweryfikowany"}` : ""}`).join("\n") || "- brak"}

## Analiza (wyniki modeli i heurystyk — wskazówki)

- przypisanie do kampanii: union-find + Louvain; spójność ${analysis.campaign_assignment.cohesion}, składowe silnych dowodów: ${analysis.campaign_assignment.strong_components}
- metody podobieństwa, które dały przesłanki: ${Object.values(analysis.similarity_methods).join("; ") || "żadna (kampanię łączą wspólne ślady, nie podobieństwo)"}
- wyniki deepfake z danych wejściowych: ${analysis.deepfake_scores.map((s) => `${s.item_id}=${s.score}`).join(", ") || "brak"}
- streszczenie (wygenerowane przez model ${analysis.llm_summary?.model ?? "—"}, niezweryfikowane): ${analysis.llm_summary ? `${analysis.llm_summary.narrative}${analysis.llm_summary.infrastructure ? ` Infrastruktura: ${analysis.llm_summary.infrastructure}` : ""}` : "brak"}

## Proponowane działania (do decyzji człowieka)

| Odbiorca | Działanie |
|---|---|
${actions.map((a) => `| ${a.recipient} — ${cell(a.name)} | ${cell(a.action)} |`).join("\n")}

## Pliki i integralność

Weryfikacja: \`shasum -a 256 -c manifest.sha256\`

| Plik | Opis | SHA-256 | Rozmiar | Pozyskano (UTC) |
|---|---|---|---|---|
${integrity.manifest.map((m) => `| ${cell(m.file)} | ${cell(m.source)}${m.derived_from_sha256 ? ` (kopia zredagowana; sha256 oryginału \`${m.derived_from_sha256}\`)` : ""} | \`${m.sha256}\` | ${m.size} | ${cell(formatUtc(m.acquired_utc))} |`).join("\n")}

## Dane osobowe w paczce

| Kategoria | Podstawa | Retencja |
|---|---|---|
${integrity.personal_data_inventory.map((i) => `| ${cell(i.category)} | ${cell(i.basis)} | ${cell(i.retention)} |`).join("\n")}

## Łańcuch przechowywania

${integrity.custody_log.map((c) => `- ${formatUtc(c.utc)}: ${c.actor} — ${c.action}`).join("\n")}

Domeny wyłączone z listy CERT (platformy, skracacze, serwisy publiczne): ${integrity.excluded_from_cert_list.map((e) => `${e.domain} (${e.reason})`).join("; ") || "brak"}.

Ograniczenia: ${integrity.limitations.join("; ")}.
`;
  // adresy rozbrojone: surowe zostają tylko w evidence.json i zgłoszeniach DSA
  return defangText(md);
}
