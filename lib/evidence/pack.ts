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
import { isSimilarityEdge, type Campaign, type CampaignsFile, type EvidenceGraph, type ItemLink } from "../graph/model";
import { Discounter } from "../graph/weights";
import { normalizeUrl, registrableDomain } from "../osint/urls";
import type { CampaignSummary } from "../pipeline/summary";
import type { EnrichedDataset, Item, PageInfo } from "../pipeline/types";
import { DEFAULT_NARRATIVE_CONFIG, topicQuote, type MaterialNarrative } from "../text/narrative";

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
}

export interface ManifestEntry {
  file: string;
  sha256: string;
  size: number;
  mime: string;
  acquired_utc: string | null;
  source: string;
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

  const manifest: ManifestEntry[] = [];
  const copied = new Map<string, string>();
  const addFile = (source: string, dest: string, acquired: string | null, sourceLabel: string): string | null => {
    const abs = path.isAbsolute(source) ? source : path.join(root, source);
    if (!existsSync(abs)) return null;
    if (copied.has(abs)) return copied.get(abs)!;
    const destAbs = path.join(outDir, dest);
    mkdirSync(path.dirname(destAbs), { recursive: true });
    copyFileSync(abs, destAbs);
    manifest.push({ file: dest, sha256: sha256File(destAbs), size: statSync(destAbs).size, mime: mimeOf(destAbs), acquired_utc: acquired, source: sourceLabel });
    copied.set(abs, dest);
    return dest;
  };
  const datasetDir = path.isAbsolute(opts.enriched.baseDir) ? opts.enriched.baseDir : path.join(root, opts.enriched.baseDir);

  // ---------------------------------------------------------------- ads (facts)
  const pagesOf = (item: Item): PageInfo | null => {
    const enr = opts.enriched.perItem[item.id];
    return enr?.pageKey ? (opts.enriched.pages[enr.pageKey] ?? null) : null;
  };
  const ads = members.map((item) => {
    const enr = opts.enriched.perItem[item.id];
    const page = pagesOf(item);
    const creatives: Array<{ file: string; sha256: string | null; source: string }> = [];
    if (item.imagePath) {
      const dest = addFile(path.join(datasetDir, item.imagePath), `files/creatives/${path.basename(item.imagePath)}`, null, "plik kreacji z danych wejściowych");
      if (dest) creatives.push({ file: dest, sha256: manifest.find((m) => m.file === dest)?.sha256 ?? null, source: item.imagePath });
    } else if (item.imageUrl) {
      creatives.push({ file: item.imageUrl, sha256: null, source: "URL obrazu (plik nie został zachowany przez starter)" });
    }
    if (item.videoPath) {
      const dest = addFile(path.join(datasetDir, item.videoPath), `files/media/${path.basename(item.videoPath)}`, null, "plik audio/wideo z danych wejściowych");
      if (dest) creatives.push({ file: dest, sha256: manifest.find((m) => m.file === dest)?.sha256 ?? null, source: item.videoPath });
    }
    const adUrlColumns = Object.entries(item.extra).filter(([k]) => /url|link|permalink|snapshot/i.test(k));
    return {
      item_id: item.id,
      platform: item.platform,
      service: item.platform ? `reklama w serwisie ${item.platform}` : null,
      ad_urls: adUrlColumns.map(([, v]) => v),
      ad_ids: { ad_id: item.id, ...Object.fromEntries(Object.entries(item.extra).filter(([k]) => /(^|_)id$|_id_/i.test(k))) },
      advertiser_displayed: item.advertiser,
      advertiser_note: nodeById.get(`item:${item.id}`)?.data.advertiserMismatch === true ? "konto reklamowe prawdopodobnie przejęte (nazwa nie pasuje do treści)" : null,
      payer_displayed: item.extra.ad_payers ?? null,
      repository_record: item.extra.ad_library_url ?? null,
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
      creative_files: creatives,
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
        const archived = p.archiveFile ? addFile(p.archiveFile, `files/html/${path.basename(p.archiveFile)}`, utc(p.fetch.fetchedAt), "zdekodowany HTML strony (archiwum startera)") : null;
        return {
          url: p.fetch.finalUrl,
          requested_url: p.requestedUrl,
          fetched_utc: utc(p.fetch.fetchedAt),
          status: p.fetch.status,
          user_agent: p.fetch.userAgent,
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
        warc_file: null,
        screenshots: [],
        registration_data: {
          registrar: di?.rdap?.registrar ?? null,
          created_utc: utc(di?.rdap?.created),
          expires_utc: utc(di?.rdap?.expires),
          status: di?.rdap?.status ?? [],
          nameservers: di?.ns ?? [],
          mx: di?.mx ?? [],
          ips,
          cname_chains: Object.fromEntries(hostInfos.filter((h) => h.cnameChain.length).map((h) => [h.host, h.cnameChain])),
          certificates: (di?.ct?.certs ?? []).slice(0, 10).map((c) => ({ issuer: c.issuer, not_before: c.notBefore, not_after: c.notAfter, san_count: c.sanDomains.length, crtsh_id: c.id })),
        },
        cert_warning_list_status: "niesprawdzone — sprawdź https://hole.cert.pl/domains/v2/domains.json i zapisz RegisterPositionId oraz InsertDate",
        financial_service_offered: domainOffer.get(domain) ?? null,
        payment_identifiers: [...new Set(kitPages.flatMap((p) => p.extract?.wallets.map((w) => `${w.kind}:${w.address}`) ?? []))],
      };
    });
  const certDomains = domains.filter((d) => !d.excluded_from_cert_list).flatMap((d) => [d.domain_fqdn, ...d.hosts.filter((h) => h !== d.domain_fqdn)]);

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
  const accounts = [...new Set(members.map((m) => m.advertiser).filter((a): a is string => !!a))].sort().map((name) => ({
    advertiser_displayed: name,
    platforms: [...new Set(members.filter((m) => m.advertiser === name).map((m) => m.platform).filter(Boolean))],
    ads: members.filter((m) => m.advertiser === name).map((m) => m.id),
    library_account: libraryAccount(members.filter((m) => m.advertiser === name)),
  }));

  // ---------------------------------------------------------------- observations vs analysis
  const memberSet = new Set(campaign.members);
  const internal: ItemLink[] = opts.graph.links.filter((l) => memberSet.has(l.a) && memberSet.has(l.b));
  const sharedIdentifiers = campaign.topEvidence
    .filter((e) => !isSimilarityEdge(e.type))
    .map((e) => ({ type: e.type, value: nodeById.get(e.key)?.key ?? e.label, ads_with_identifier: e.count }));
  const firstSeen = campaign.firstSeen ? campaign.firstSeen.slice(0, 10) : "?";
  const lastSeen = campaign.lastSeen ? campaign.lastSeen.slice(0, 10) : "?";
  const platforms = [...new Set(members.map((m) => m.platform).filter(Boolean))].join(", ") || "brak danych";
  const personaNames = impersonated.map((p) => p.impersonated_person).join(", ") || "brak wskazań";
  const summaryFacts =
    `W okresie ${firstSeen} – ${lastSeen} zarejestrowano ${members.length} reklam (platformy: ${platforms}) ` +
    `kierujących do ${domains.length} domen (${domains.map((d) => d.domain_fqdn).join(", ") || "brak"}). ` +
    `W treści reklam lub danych wejściowych wskazano osoby: ${personaNames}. ` +
    `Reklamy łączą wspólne identyfikatory: ${sharedIdentifiers.slice(0, 5).map((s) => `${s.type} ${s.value}`).join("; ") || "brak"}.`;
  const hasFinancialOffer = domainOffer.size > 0;

  const toolVersion = opts.toolVersion ?? { name: "hacknation-osint-starter", version: "0.1.0", gitCommit: null };
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
    similarity_methods: {
      image: `dHash 64 bit, próg Hamminga ${config.similarity.imageHamming}`,
      text: `${opts.graph.textMethod}, próg ${opts.graph.textMethod === "embedding" ? config.similarity.text.embeddingThreshold : config.similarity.text.tfidfThreshold}`,
      dom: `simhash struktury DOM, próg ${config.similarity.dom.hamming}`,
      audio: `Chromaprint, próg ${config.similarity.audio.minSimilarity}`,
    },
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
    prior_reports: [],
    impersonated_person: impersonated,
    observations: {
      note: "fakty: co zarejestrowano, gdzie i kiedy (UTC)",
      shared_identifiers: sharedIdentifiers,
      ads,
      domains,
      accounts,
    },
    analysis,
    integrity: {} as Record<string, unknown>,
  };

  // ---------------------------------------------------------------- outputs
  const files: string[] = [];
  const write = (rel: string, content: string) => {
    writeFileSync(path.join(outDir, rel), content, "utf8");
    files.push(rel);
  };
  const certChunks: string[][] = [];
  for (let i = 0; i < certDomains.length; i += 50) certChunks.push(certDomains.slice(i, i + 50));
  write("cert-domains.txt", `${certDomains.join("\n")}${certDomains.length ? "\n" : ""}`);
  if (certChunks.length > 1) certChunks.forEach((chunk, i) => write(`cert-domains-${i + 1}.txt`, `${chunk.join("\n")}\n`));
  write("dsa-art16-notice.md", renderDsaNotice(record, campaign, ads, domains));
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
    timestamp_token: null,
    timestamp_note: "brak znacznika czasu RFC 3161 — dodaj u kwalifikowanego dostawcy dla kluczowych paczek (art. 41 eIDAS)",
    seal: null,
    custody_log: [
      { utc: now.toISOString(), actor: "starter (eksport paczki)", action: `eksport paczki dla kampanii ${campaign.id}`, tool_version: `${toolVersion.name} ${toolVersion.version}${toolVersion.gitCommit ? ` (${toolVersion.gitCommit})` : ""}`, sha256_after: manifestSha },
    ],
    personal_data_inventory: [
      { category: "imię i nazwisko osoby publicznej, której wizerunek użyto", basis: "art. 6 ust. 1 lit. f RODO (wniosek)", retention: TODO("okres retencji") },
      { category: "nazwy kont reklamodawców", basis: "art. 6 ust. 1 lit. f RODO (wniosek)", retention: TODO("okres retencji") },
      { category: "dane kontaktowe i portfele widoczne w reklamach i na stronach", basis: "art. 6 ust. 1 lit. f RODO (wniosek)", retention: TODO("okres retencji") },
      { category: "dane rejestracyjne domen (publiczny RDAP)", basis: "art. 6 ust. 1 lit. f RODO (wniosek)", retention: TODO("okres retencji") },
    ],
    excluded_from_cert_list: excluded,
    limitations: [
      "archiwum stron to zdekodowany HTML (UTF-8) i SHA-256 surowej odpowiedzi; brak WARC (ISO 28500) i zrzutów ekranu",
      "rekordy z repozytorium reklam (art. 39 DSA) nie są pobierane — pobierz przed zgłoszeniem",
      "status na Liście Ostrzeżeń CERT nie jest sprawdzany automatycznie",
    ],
  };
  writeFileSync(path.join(outDir, "evidence.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  writeFileSync(path.join(outDir, "evidence.md"), renderMarkdown(record, campaign), "utf8");
  return { outDir, record, files: ["evidence.json", "evidence.md", "manifest.sha256", ...files, ...manifest.filter((m) => m.file.startsWith("files/")).map((m) => m.file)], certDomains };
}

type Ads = Array<{ item_id: string; ad_urls: string[]; landing_url: string | null; landing_chain: Array<{ url: string }>; advertiser_displayed: string | null; first_seen_utc: string | null }>;
type Domains = Array<{ domain_fqdn: string }>;

function renderDsaNotice(record: Record<string, unknown>, campaign: Campaign, ads: Ads, domains: Domains): string {
  const submitter = record.submitter as Submitter;
  const legal = record.legal_assessment as { candidates: string[] };
  const urls = new Set<string>();
  for (const a of ads) {
    for (const u of a.ad_urls) urls.add(u);
    if (a.landing_url) urls.add(a.landing_url);
    for (const h of a.landing_chain) urls.add(h.url);
  }
  return `# Zgłoszenie nielegalnych treści (art. 16 ust. 2 DSA) — SZABLON

> Wygenerowano z paczki dowodów \`${String(record.package_id)}\` (kampania ${campaign.id}, ${String(record.created_utc)}).
> Przed wysłaniem człowiek weryfikuje treść i decyduje o zgłoszeniu. Wysyłaj precyzyjne zgłoszenia — masowe, nieprecyzyjne zgłoszenia mogą skutkować zawieszeniem ich rozpatrywania (art. 23 ust. 2 DSA).

## (a) Wyjaśnienie, dlaczego treść jest nielegalna

${String(record.summary_facts)}

Proponowane podstawy prawne (do weryfikacji): ${legal.candidates.join("; ")}.

${TODO("uzasadnienie zrozumiałe dla moderatora bez szczegółowej analizy prawnej, np. wizerunek użyty bez zgody w reklamie fałszywej platformy inwestycyjnej; domena na Liście Ostrzeżeń CERT od dnia …")}

## (b) Dokładna lokalizacja elektroniczna (URL)

${[...urls].map((u) => `- ${u}`).join("\n") || "- " + TODO("URL reklamy (permalink / biblioteka reklam)")}

Dodatkowe informacje identyfikujące:
${ads.map((a) => `- reklama ${a.item_id}${a.advertiser_displayed ? `, reklamodawca „${a.advertiser_displayed}”` : ""}${a.first_seen_utc ? `, pierwsza obserwacja ${a.first_seen_utc}` : ""}`).join("\n")}
- domeny: ${domains.map((d) => d.domain_fqdn).join(", ")}

## (c) Zgłaszający

- Imię i nazwisko / nazwa: ${submitter.name}
- E-mail: ${submitter.email}

## (d) Oświadczenie o dobrej wierze

${GOOD_FAITH_STATEMENT}
`;
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

function renderMarkdown(record: Record<string, unknown>, campaign: Campaign): string {
  const obs = record.observations as {
    shared_identifiers: Array<{ type: string; value: string; ads_with_identifier: number }>;
    ads: Array<Record<string, unknown>>;
    domains: Array<Record<string, unknown>>;
    accounts: Array<{ advertiser_displayed: string; ads: string[]; library_account: LibraryAccount | null }>;
  };
  const integrity = record.integrity as { manifest: ManifestEntry[]; manifest_sha256: string; limitations: string[]; excluded_from_cert_list: Array<{ domain: string; reason: string }> };
  const personas = record.impersonated_person as Array<{ impersonated_person: string; public_role: string | null; match_basis: string[]; consent_status: string; biometric_data: string }>;
  const analysis = record.analysis as { campaign_assignment: { cohesion: number; strong_components: number }; deepfake_scores: Array<{ item_id: string; score: number | null }>; llm_summary: { model: string; narrative: string } | null; similarity_methods: Record<string, string> };
  const actions = record.requested_action as Array<{ recipient: string; name: string; action: string }>;
  const submitter = record.submitter as Submitter;
  const cell = (v: unknown) => String(v ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ");
  return `# Paczka dowodów — kampania ${campaign.id}

| Pole | Wartość |
|---|---|
| package_id | \`${String(record.package_id)}\` |
| utworzono (UTC) | ${String(record.created_utc)} |
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

| Typ | Wartość | Reklamy |
|---|---|---|
${obs.shared_identifiers.map((s) => `| ${cell(s.type)} | ${cell(s.value)} | ${s.ads_with_identifier} |`).join("\n")}

### Reklamy

| ID | Platforma | Reklamodawca | Pierwsza / ostatnia obserwacja (UTC) | Link docelowy |
|---|---|---|---|---|
${obs.ads.map((a) => `| ${cell(a.item_id)} | ${cell(a.platform)} | ${cell(a.advertiser_displayed)} | ${cell(a.first_seen_utc)} / ${cell(a.last_seen_utc)} | ${cell(a.landing_url)} |`).join("\n")}

### Domeny

| Domena | Rejestrator | Utworzona (UTC) | NS | IP (ASN) |
|---|---|---|---|---|
${obs.domains
  .map((d) => {
    const reg = d.registration_data as { registrar: string | null; created_utc: string | null; nameservers: string[]; ips: Array<{ ip: string; asn: number | null }> };
    return `| ${cell(d.domain_fqdn)}${d.excluded_from_cert_list ? " *(poza listą CERT)*" : ""} | ${cell(reg.registrar)} | ${cell(reg.created_utc)} | ${cell(reg.nameservers.join(", "))} | ${cell(reg.ips.map((i) => `${i.ip}${i.asn ? ` (AS${i.asn})` : ""}`).join(", "))} |`;
  })
  .join("\n")}

### Konta reklamodawców

${obs.accounts.map((a) => `- „${a.advertiser_displayed}”: ${a.ads.join(", ")}${a.library_account ? `; konto w bibliotece reklam (${a.library_account.platform}): ${a.library_account.advertiser_id}${a.library_account.legal_name ? `, nazwa prawna „${a.library_account.legal_name}”` : ""}${a.library_account.location ? `, kraj ${a.library_account.location}` : ""}${a.library_account.verified === null ? "" : a.library_account.verified ? ", zweryfikowany" : ", niezweryfikowany"}` : ""}`).join("\n") || "- brak"}

## Analiza (wyniki modeli i heurystyk — wskazówki)

- przypisanie do kampanii: union-find + Louvain; spójność ${analysis.campaign_assignment.cohesion}, składowe silnych dowodów: ${analysis.campaign_assignment.strong_components}
- metody podobieństwa: ${Object.entries(analysis.similarity_methods).map(([k, v]) => `${k}: ${v}`).join("; ")}
- wyniki deepfake z danych wejściowych: ${analysis.deepfake_scores.map((s) => `${s.item_id}=${s.score}`).join(", ") || "brak"}
- streszczenie LLM: ${analysis.llm_summary ? `${analysis.llm_summary.narrative} (model: ${analysis.llm_summary.model})` : "brak"}

## Proponowane działania (do decyzji człowieka)

| Odbiorca | Działanie |
|---|---|
${actions.map((a) => `| ${a.recipient} — ${cell(a.name)} | ${cell(a.action)} |`).join("\n")}

## Pliki i integralność

Weryfikacja: \`shasum -a 256 -c manifest.sha256\`

| Plik | SHA-256 | Rozmiar | Pozyskano (UTC) |
|---|---|---|---|
${integrity.manifest.map((m) => `| ${cell(m.file)} | \`${m.sha256}\` | ${m.size} | ${cell(m.acquired_utc)} |`).join("\n")}

Domeny wyłączone z listy CERT (platformy, skracacze, serwisy publiczne): ${integrity.excluded_from_cert_list.map((e) => `${e.domain} (${e.reason})`).join("; ") || "brak"}.

Ograniczenia: ${integrity.limitations.join("; ")}.
`;
}
