/**
 * Builds the evidence graph from enriched items.
 *
 * For every item we walk its enrichment (landing URL -> redirect chain -> hosts ->
 * IPs -> ASNs; domains -> NS set / registrar / certificates; page -> trackers,
 * favicon, contacts, wallets; ad copy -> contacts, wallets; image -> dHash) and
 * record each reachable entity as a "pivot" together with the node path that leads
 * to it. Items sharing a pivot get pair evidence weighted by weights.ts; image and
 * text similarity add item-item evidence. Pair evidence is combined (noisy-OR)
 * into ItemLinks that clustering consumes.
 */
import { stripHallucinations } from "../media/asr";
import { fingerprintSimilarity } from "../media/audioFp";
import { speakerSimilarity } from "../media/speaker";
import { hammingDistance } from "../media/imageHash";
import { extractCampaignParams, paramSchema, type CampaignParam } from "../osint/campaignParams";
import { clickIdsFromUrls } from "../osint/clickIds";
import { affiliateIdsFromUrls, type AffiliateId } from "../osint/affiliateIds";
import { verificationTokens } from "../osint/extract";
import { mergePlatformLinkIds, platformLinkIds, type LanderConfig } from "../osint/landerConfig";
import { leadFlowLabel } from "../osint/leadFlow";
import { asSeenOn, despaceText, hasSpacedText } from "../osint/pageTraits";
import { hostingAccounts as hostingAccountsIn } from "../osint/hostingAccounts";
import { companyIdsOfMaterial } from "../text/companyIds";
import { applyShopContext } from "../osint/shopSignals";
import { evaluateCompanyRegistry } from "../osint/companyRegistry";
import { brandInPath, hostingOutsideEu } from "../osint/infraSignals";
import { tlsSignals } from "../osint/tlsSignals";
import { classifyPayer, isPolishAd, PAYER_KIND_NOTES_PL, summarizePayers, type PayerContext } from "../osint/payerKind";
import { maskUrl } from "../osint/redact";
import { maskTokensDeep, metaTokenKeysIn } from "../osint/metaToken";
import { rdapSuspended } from "../osint/rdap";
import { advertiserMismatch } from "../text/advertiserMismatch";
import { SHOT_HAMMING, sharedShots } from "../media/videoShots";
import { infinitiveCta } from "../text/infinitiveCta";
import { detectFictionalExperts, publicPersonsForExperts } from "../text/fictionalExpertAttr";
import { adStart } from "../text/adStart";
import { advertiserNameStyle, commentLanguage, landerSlugStyle, mixedScriptName } from "../text/namingStyle";
import { adCreatedApprox, isTimedMetaId, type MetaIdAnchor } from "../osint/metaIdAge";
import { scarcityCounter } from "../osint/pageTechniques";
import { displayedDomainMismatch } from "../text/displayedDomain";
import { discordSnowflakes } from "../osint/contactIds";
import { idnConfusableInUrl } from "../osint/idnConfusable";
import { PHONE_CONFIG } from "../osint/phoneConfig";
import { phoneLineFlags, phoneLineInfo } from "../osint/phoneLine";
import { profitClaimKey, profitClaims } from "../text/profitClaims";
import { canonicalExperts, findExpertNames, isPublicPerson, loadPublicPersonForms, type ExpertName } from "../text/fictionalExpert";
import { languageErrors } from "../text/languageErrors";
import { foreignPersona, foreignSegments, residueOf } from "../text/residue";
import { translationArtifacts, typographyOf } from "../text/typography";
import { advertiserNameKind, brandStyle } from "../text/brandStyle";
import { celebBaitLabel, DEFAULT_NARRATIVE_CONFIG, detectNarrative, type MaterialNarrative } from "../text/narrative";
import { scamBrands } from "../text/scamBrand";
import { stripGenericPhrases, stripUiChrome } from "../text/uiChrome";
import { domainAgeAt } from "../osint/domainAge";
import { domainTemplate, type DomainTemplate } from "../osint/domainPattern";
import { simhashDistance } from "../osint/pagekit";
import { normalizeUrl, registrableDomain, toUnicodeHost, unwrapPlatformUrl } from "../osint/urls";
import type { EnrichedDataset, Item } from "../pipeline/types";
import { cosineDense, cosineSparse, fitTfidf, type SparseVector } from "../text/similarity";
import { adLibraryIdKey, adPayerKey, advertiserIdKey, readAdRecordTraces } from "./adLibraryTraces";
import { commentNameFactors } from "./commentNames";
import { DEFAULT_LINK_CONFIG, type LinkConfig } from "./config";
import { knownBackendLabel } from "./knownBackends";
import {
  CREATIVE_FILE_PREFIX,
  ENTITY_TYPES,
  nodeId,
  type EdgeType,
  type EntityType,
  type EvidenceGraph,
  type GraphEdge,
  type GraphNode,
  type ItemLink,
  type PairEvidence,
  type SimilarityEdgeType,
} from "./model";
import { combineScores, Discounter, pivotWeight, platformPathRule } from "./weights";

export interface BuildGraphOptions {
  config?: LinkConfig;
  /** Dense embeddings per item id; when given, used instead of TF-IDF. */
  embeddings?: Record<string, number[]>;
  /** Disable text similarity entirely. */
  textMethod?: "tfidf" | "embedding" | "none";
  /** Also return each item's reachable pivots (used by the live "analyze" endpoint). */
  includeItemPivots?: boolean;
  now?: () => Date;
}

export interface ItemPivot {
  pivot: string;
  type: EntityType;
  path: string[];
  relation: number;
  how: string;
}

/** Relation multiplier: 1 for hosting/direct, lower for outbound links or parked pages. */
type Fact = ItemPivot;

const TRACKER_LABELS: Record<string, string> = {
  ga4: "Google Analytics 4",
  ua: "Universal Analytics",
  gtm: "Google Tag Manager",
  google_ads: "Google Ads",
  meta_pixel: "Meta Pixel",
  tiktok_pixel: "TikTok Pixel",
  yandex_metrica: "Yandex Metrica",
  meta_domain_verification: "token weryfikacji domeny Meta",
  google_site_verification: "token weryfikacji Google Search Console",
  yandex_verification: "token weryfikacji Yandex Webmaster",
  clarity: "Microsoft Clarity",
  matomo: "Matomo (serwer/strona)",
  posthog: "PostHog",
  adsense: "wydawca AdSense",
};

const TECHNIQUE_LABELS: Record<string, string> = {
  fake_app_store: "udawany sklep z aplikacjami",
  back_trap: "pułapka przycisku „wstecz”",
  fake_social_post: "udawany post z serwisu społecznościowego",
  fake_comments: "fałszywe komentarze wpisane w stronę",
  fake_security_alert: "fałszywy alarm bezpieczeństwa z numerem telefonu",
  remote_access_tool: "program do zdalnego pulpitu do pobrania",
  clickfix_paste: "fałszywa weryfikacja z poleceniem do wklejenia",
  scarcity_counter: "licznik presji („zostało N miejsc”)",
  anti_devtools: "blokada narzędzi deweloperskich (F12, menu kontekstowe)",
  "kit:formFb": "kit formularza sieci CPA (formFb)",
};

/** Canonical link parameters that carry the ID of the Meta ad in templates ({{ad.id}}). */
const META_AD_ID_PARAMS = new Set<string>(["ad_id", "utm_content", "utm_term"]);

/** Most phone numbers of one material whose line type is kept as an attribute. */
const MAX_PHONE_LINES = 5;

/** Most unmapped input columns kept on the item as input data, and the longest value kept. */
const MAX_INPUT_EXTRA = 30;
const MAX_INPUT_EXTRA_CHARS = 200;

function shortUrl(url: string, max = 64): string {
  const s = url.replace(/^https?:\/\//, "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function normAdvertiser(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Data of a payer node from its kind: the kind, why, and a note when the kind needs a caution (a person may be a victim of identity theft). */
function payerKindData(c: ReturnType<typeof classifyPayer>): Record<string, unknown> {
  const note = PAYER_KIND_NOTES_PL[c.kind];
  return { payerKind: c.kind, payerKindReasons: c.reasons, ...(note ? { payerNote: note } : {}) };
}

function shortAddr(a: string): string {
  return a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}

class GraphBuilder {
  nodes = new Map<string, GraphNode>();
  edges = new Map<string, GraphEdge>();

  node(type: EntityType, key: string, label: string, data: Record<string, unknown> = {}): string {
    const id = nodeId(type, key);
    const existing = this.nodes.get(id);
    if (existing) {
      Object.assign(existing.data, data);
      return id;
    }
    this.nodes.set(id, { id, type, key, label, df: 0, weight: null, strong: false, discounts: [], data, campaignId: null });
    return id;
  }

  edge(source: string, target: string, type: EdgeType, evidence: string, weight = 1): void {
    if (source === target) return;
    const id = `${type}|${source}|${target}`;
    if (!this.edges.has(id)) this.edges.set(id, { id, source, target, type, weight, evidence });
  }
}

/** Builds the evidence graph (nodes, edges, item links). Pure and deterministic. */
export function buildEvidenceGraph(
  dataset: EnrichedDataset,
  options: BuildGraphOptions = {},
): EvidenceGraph & { itemPivots?: Record<string, ItemPivot[]> } {
  const config = options.config ?? DEFAULT_LINK_CONFIG;
  const discounter = new Discounter(config);
  const g = new GraphBuilder();
  const factsByItem = new Map<string, Fact[]>();
  const items = dataset.items;
  const n = items.length;

  // Domain-name templates (e.g. "finance<n>-<lorem><n>.sbs") shared by >= N distinct domains.
  const templateOf = new Map<string, DomainTemplate>();
  const templateDomains = new Map<string, Set<string>>();
  for (const h of Object.values(dataset.hosts)) {
    const d = h.registrableDomain;
    if (!d || templateOf.has(d) || discounter.domainDiscount(d)) continue;
    const t = domainTemplate(d);
    if (!t) continue;
    templateOf.set(d, t);
    for (const key of [t.specific, t.agnostic]) {
      if (!templateDomains.has(key)) templateDomains.set(key, new Set());
      templateDomains.get(key)!.add(d);
    }
  }
  const templateShared = (key: string) => (templateDomains.get(key)?.size ?? 0) >= config.kit.domainPatternMinDomains;

  /** Items whose creative is a screenshot of an ad-library view: mostly interface, so the picture is not compared. */
  const libraryViews = new Set<string>();

  // Template sentences (I23) and developer messages of kit scripts (I25): only text carried by pages in
  // several registrable domains is a trace of a shared template or tool; one site repeats its own text on
  // all its pages. Text on pages of many platform accounts, or on a large share of all pages, is the
  // platform's own (SDK, shared interface) and is masked (config.textBoilerplate).
  const phraseSpread = new Map<string, TextSpread>();
  const kitSpread = new Map<string, TextSpread>();
  const keptPages = new Set<string>();
  for (const item of items) {
    const e = dataset.perItem[item.id];
    const page = e?.pageKey ? dataset.pages[e.pageKey] : null;
    const domain = page ? registrableDomain(page.fetch.finalUrl) ?? normalizeUrl(page.fetch.finalUrl)?.host ?? null : null;
    if (!domain || !page?.kit) continue;
    keptPages.add(e!.pageKey!);
    const account = pageAccountOf(page.kit);
    for (const p of page.kit.templatePhrases ?? []) spreadAdd(phraseSpread, p.key, domain, account, e!.pageKey!);
    for (const k of page.kit.kitStrings ?? []) spreadAdd(kitSpread, k.key, domain, account, e!.pageKey!);
  }
  const masked = (sp: TextSpread | undefined) => !!sp && isPlatformText(sp, keptPages.size, config.textBoilerplate);
  const phraseShared = (key: string) => {
    const sp = phraseSpread.get(key);
    return !!config.templatePhrase && (sp?.domains.size ?? 0) >= config.templatePhrase.minDomains && !masked(sp);
  };
  const kitShared = (key: string) => {
    const sp = kitSpread.get(key);
    return !!config.kitString && (sp?.domains.size ?? 0) >= config.kitString.minDomains && !masked(sp);
  };

  // Tenants of the landing-page platform (landing-cdn/<uuid>) seen together with an owner_uuid: a page
  // that has only the tenant (no page code) is then attributed to that account. A tenant seen with two
  // different owners is ambiguous and not mapped.
  const tenantOwner = new Map<string, string | null>();
  for (const item of items) {
    const e = dataset.perItem[item.id];
    const kit = e?.pageKey ? dataset.pages[e.pageKey]?.kit : null;
    const owner = kit?.lander?.ownerId;
    if (!owner) continue;
    for (const t of kit?.platformTenants ?? []) {
      if (t === owner) continue;
      const cur = tenantOwner.get(t);
      tenantOwner.set(t, cur === undefined || cur === owner ? owner : null);
    }
  }

  // Fictional experts (B-313): "dr"/"prof." plus a name that is not on the public list, from the text of the ad, the
  // screenshot, the recording and the page. Spelling variants are merged over the whole set, so the pre-pass comes first.
  const expertsOf = new Map<string, ExpertName[]>();
  const expertCounts = new Map<string, number>();
  if (config.fictionalExpert) {
    const publicForms = loadPublicPersonForms();
    for (const item of items) {
      const enr = dataset.perItem[item.id];
      const pex = enr?.pageKey ? dataset.pages[enr.pageKey]?.extract : null;
      const text = [item.text, enr?.ocrText ? stripUiChrome(enr.ocrText).text : null, enr?.asrText ? stripHallucinations(enr.asrText) : null, pex?.title, pex?.description, pex?.visibleText].filter(Boolean).join("\n");
      const found = findExpertNames(text).filter((x) => !isPublicPerson(x.key, publicForms)).slice(0, config.fictionalExpert.maxPerMaterial);
      if (!found.length) continue;
      expertsOf.set(item.id, found);
      for (const x of found) expertCounts.set(x.key, (expertCounts.get(x.key) ?? 0) + 1);
    }
  }
  const expertCanon = canonicalExperts(expertCounts);

  for (const item of items) {
    const facts: Fact[] = [];
    const add = (pivot: string, type: EntityType, path: string[], relation: number, how: string) => {
      if (relation > 0) facts.push({ pivot, type, path, relation, how });
    };
    /** Adds a lead-funnel node (B-332) for one token (`form:<uuid>`, `flow:…`, `key:…`, `evhost:…`, `src:<suuid>`) of the item or its page. */
    const addLeadFlow = (from: string, basePath: string[], token: string, relation: number) => {
      const label = leadFlowLabel(token);
      const id = g.node("lead_flow", token, label, { kind: token.split(":")[0] });
      g.edge(from, id, "mentions", `lejek leadów platformy stron: ${label}`);
      add(id, "lead_flow", [...basePath, id], relation, `ten sam lejek leadów platformy stron (${label})`);
    };
    const enr = dataset.perItem[item.id];
    const advertiser = item.advertiser ?? enr?.advertiserOcr ?? null;
    /** Pivot of the advertiser's display name (no library account), dropped below for a taken-over account. */
    let advertiserNamePivot: string | null = null;
    const itemNode = g.node("item", item.id, advertiser ? `${item.id} · ${advertiser}` : item.id, {
      platform: item.platform,
      advertiser,
      text: item.text ? item.text.slice(0, 600) : null,
      landingUrl: item.landingUrl ? maskUrl(item.landingUrl) : item.landingUrl,
      imageUrl: item.imageUrl,
      imagePath: item.imagePath,
      firstSeen: item.firstSeen,
      lastSeen: item.lastSeen,
      label: item.label,
      deepfakeScore: item.deepfakeScore,
      personas: [...new Set((enr?.personas ?? []).map((p) => p.name))],
      ocrText: enr?.ocrText ? enr.ocrText.slice(0, 600) : null,
      asrText: enr?.asrText ? enr.asrText.slice(0, 600) : null,
      ...(enr?.videoOcrText ? { videoOcrText: enr.videoOcrText.slice(0, 600) } : {}),
    });
    const itemData = g.nodes.get(itemNode)!.data;
    // the case folder of the material: ads of one case are not paired in the near-miss report
    if (item.extra?.case) itemData.case = item.extra.case;

    // Screenshot of the ad: kind of platform view and the ad-library ID read by OCR
    // Text spaced out letter by letter (B-337): an attribute and the technique `spaced_text`, read from the
    // ad text and every OCR source (main and further screenshots, video frames); the OCR text is glued back
    // before any matching
    // (or from the OCR character boxes, where tesseract glued the letters into one word)
    if (enr?.ocrSpacedText || [item.text, enr?.ocrText, enr?.extraOcrText, enr?.videoOcrText].some((t) => hasSpacedText(t))) {
      itemData.spacedText = true;
      itemData.techniques = [...new Set([...((itemData.techniques as string[] | undefined) ?? []), "spaced_text"])];
    }
    const ui = enr?.ocrText ? stripUiChrome(despaceText(enr.ocrText)) : null;
    // Fake "as seen on" strip of media logos (B-338): an attribute of the material
    const seenOn = asSeenOn([item.text, ui?.text].filter(Boolean).join("\n"));
    if (seenOn.length) itemData.asSeenOn = seenOn;
    if (ui?.view) itemData.uiView = ui.view;
    if (enr?.advertiserImpersonates) {
      itemData.advertiserImpersonates = enr.advertiserImpersonates.id;
      itemData.advertiserImpersonatesName = enr.advertiserImpersonates.name;
    }
    if (ui?.view === "ad_library") libraryViews.add(item.id);
    // The library ID also comes from the further screenshots of the case and from the input (e.g. a yt-dlp description of the ad)
    const libraryIds = [
      ...new Set([
        ...(ui?.adLibraryIds ?? []),
        ...(enr?.extraOcrText ? stripUiChrome(enr.extraOcrText).adLibraryIds : []),
        ...(/^\d{12,20}$/.test(item.extra.ad_library_id ?? "") ? [item.extra.ad_library_id] : []),
      ]),
    ];
    const fromInput = (libId: string) => item.extra.ad_library_id === libId && !ui?.adLibraryIds.includes(libId);
    if (libraryIds.length) itemData.adLibraryIds = libraryIds;
    for (const libId of libraryIds) {
      const id = g.node("campaign_param", `ad_library_id=${libId}`, `ad_library_id=${libId}`, {
        canonicalName: "ad_library_id",
        name: fromInput(libId) ? "identyfikator biblioteki reklam (z opisu materiału)" : "identyfikator biblioteki reklam (OCR)",
        value: libId,
        cyrillic: false,
        macro: false,
        // without these filters the library lists only active ads and a removed ad is not shown
        sourceUrl: `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&id=${libId}`,
      });
      g.edge(itemNode, id, "carries_param", fromInput(libId) ? "identyfikator biblioteki reklam z opisu materiału" : "identyfikator biblioteki reklam odczytany ze zrzutu ekranu (OCR)");
      add(id, "campaign_param", [itemNode, id], 1, `ten sam identyfikator w bibliotece reklam (${libId}): ta sama reklama`);
    }

    // Record of a public ad library (lib/adlib): the library ID of platforms other than Meta (Meta's is read above)
    // and the payer named by the library
    const libRecord = readAdRecordTraces(item.extra);
    // what the ad says about its advertiser, to tell the kinds of the declared payer apart (lib/osint/payerKind.ts)
    const payerCtx = (regions: string[]): PayerContext => ({ pageName: advertiser ?? enr?.adLibrary?.find((r) => r.pageName)?.pageName ?? null, polishAd: isPolishAd(item.text, regions) });
    if (libRecord) {
      // flat, readable values: they are the features of the material in the GUI and the evidence pack
      itemData.adPlatform = libRecord.platform;
      if (libRecord.adId) itemData.adLibraryAdId = libRecord.adId;
      if (libRecord.advertiserId) itemData.adAdvertiserId = libRecord.advertiserId;
      if (libRecord.legalName) itemData.adAdvertiserLegalName = libRecord.legalName;
      if (libRecord.location) itemData.adAdvertiserLocation = libRecord.location;
      if (libRecord.verified !== null) itemData.adAdvertiserVerified = libRecord.verified ? "tak" : "nie";
      if (libRecord.regions.length) itemData.adRegions = libRecord.regions;
      if (libRecord.firstShown) itemData.adFirstShown = libRecord.firstShown;
      if (libRecord.lastShown) itemData.adLastShown = libRecord.lastShown;
      if (libRecord.platform !== "meta" && libRecord.adId) {
        const idNode = g.node("campaign_param", adLibraryIdKey(libRecord.platform, libRecord.adId), adLibraryIdKey(libRecord.platform, libRecord.adId), {
          canonicalName: "ad_library_id",
          name: `identyfikator reklamy w bibliotece ${libRecord.platform}`,
          value: `${libRecord.platform}:${libRecord.adId}`,
          cyrillic: false,
          macro: false,
          sourceUrl: libRecord.libraryUrl,
        });
        g.edge(itemNode, idNode, "carries_param", `identyfikator reklamy w bibliotece reklam (${libRecord.platform})`);
        add(idNode, "campaign_param", [itemNode, idNode], 1, `ten sam identyfikator w bibliotece reklam (${libRecord.platform}: ${libRecord.adId}): ta sama reklama`);
      }
      for (const name of libRecord.payers) {
        const key = normAdvertiser(name);
        if (!key) continue;
        const payerClass = classifyPayer(name, payerCtx(libRecord.regions));
        // a stub ("Test", "xyz") is typed in by unrelated advertisers: it ties no ads, the kind stays on the item
        if (payerClass.kind === "placeholder") continue;
        const payerKey = adPayerKey(libRecord.platform, key);
        const prev = (g.nodes.get(nodeId("ad_payer", payerKey))?.data.adLibraryIds as string[] | undefined) ?? [];
        const payerNode = g.node("ad_payer", payerKey, name, { name, platform: libRecord.platform, adLibraryIds: libRecord.adId ? [...new Set([...prev, libRecord.adId])] : prev, ...payerKindData(payerClass) });
        g.edge(itemNode, payerNode, "paid_by", `płatnik reklamy według biblioteki reklam (${libRecord.platform})`);
        add(payerNode, "ad_payer", [itemNode, payerNode], 1, `ten sam płatnik reklamy w bibliotece reklam („${name}”)`);
      }
    }

    // Meta Ad Library details (opt-in): DSA payer/beneficiary as a pivot, takedown and reach on the item
    const lib = (enr?.adLibrary ?? []).filter((r) => !r.error);
    if (lib.length) {
      itemData.adLibrary = lib.map((r) => ({
        id: r.id,
        payers: r.payers,
        beneficiaries: r.beneficiaries,
        takenDown: r.takenDown,
        violations: r.violations,
        euReach: r.euReach,
        audience: r.ageMin !== null || r.ageMax !== null ? `${r.ageMin ?? "?"}–${r.ageMax ?? "?"} lat${r.gender && r.gender !== "All" ? `, ${r.gender}` : ""}` : null,
        locations: r.locations,
        pageName: r.pageName,
        creativeText: r.creative?.text ?? null,
        startedAt: r.creative?.startedAt ?? null,
      }));
      if (lib.some((r) => r.takenDown)) itemData.adTakenDown = true;
      const started = lib.map((r) => r.creative?.startedAt).filter((t): t is string => !!t).sort()[0];
      if (started && !itemData.adFirstShown) itemData.adFirstShown = started;
      const names = new Map<string, { label: string; roles: Set<string>; payerClass: ReturnType<typeof classifyPayer> }>();
      for (const r of lib) {
        for (const [role, list] of [["płatnik", r.payers], ["beneficjent", r.beneficiaries]] as const) {
          for (const n of list) {
            const key = normAdvertiser(n);
            if (!key) continue;
            const payerClass = classifyPayer(n, payerCtx(r.locations));
            if (payerClass.kind === "placeholder") continue; // a stub ties no ads (see the library record above)
            const e = names.get(key) ?? { label: n, roles: new Set<string>(), payerClass };
            e.roles.add(role);
            names.set(key, e);
          }
        }
      }
      for (const [key, { label, roles, payerClass }] of names) {
        const prev = (g.nodes.get(nodeId("ad_payer", key))?.data.adLibraryIds as string[] | undefined) ?? [];
        const id = g.node("ad_payer", key, label, { name: label, adLibraryIds: [...new Set([...prev, ...lib.map((r) => r.id)])], ...payerKindData(payerClass) });
        const roleTxt = [...roles].join(" i ");
        g.edge(itemNode, id, "paid_by", `${roleTxt} reklamy według biblioteki reklam Mety (przejrzystość DSA)`);
        add(id, "ad_payer", [itemNode, id], 1, `ten sam ${roleTxt} reklamy w bibliotece reklam („${label}”)`);
      }
    }

    // kinds of the declared payers and beneficiaries as features of the ad (the payer is a self-declaration, not a fact about who paid)
    const declared = {
      payers: [...(libRecord?.payers ?? []), ...lib.flatMap((r) => r.payers)],
      beneficiaries: lib.flatMap((r) => r.beneficiaries),
    };
    const payerSummary = summarizePayers(declared, payerCtx([...(libRecord?.regions ?? []), ...lib.flatMap((r) => r.locations)]));
    if (payerSummary) Object.assign(itemData, payerSummary);

    // library account of the advertiser: from a library record, or the Meta page read by `--ad-library`
    const metaPage = lib.find((r) => r.pageId);
    const account = libRecord?.advertiserId
      ? { platform: libRecord.platform, id: libRecord.advertiserId }
      : metaPage?.pageId
        ? { platform: "meta", id: metaPage.pageId }
        : null;
    if (account) {
      // the library's account ID is stable while the display name changes (a taken-over or renamed account)
      const key = advertiserIdKey(account.platform, account.id);
      const prev = g.nodes.get(nodeId("advertiser", key))?.data;
      const names = [...new Set([...((prev?.names as string[] | undefined) ?? []), ...(advertiser ? [advertiser] : [])])];
      // emission of the page: a deleted page is a disposable account; takedowns are counted per distinct library ad
      const takenDownIds = [...new Set([...((prev?.takenDownIds as string[] | undefined) ?? []), ...(account.platform === "meta" ? lib.filter((r) => r.takenDown).map((r) => r.id) : [])])];
      const a = g.node("advertiser", key, advertiser ?? libRecord?.legalName ?? account.id, {
        platform: account.platform,
        advertiserId: account.id,
        names,
        legalName: libRecord?.legalName ?? prev?.legalName ?? null,
        location: libRecord?.location ?? prev?.location ?? null,
        verified: libRecord?.verified ?? (prev?.verified as boolean | null | undefined) ?? null,
        ...(metaPage?.pageDeleted != null ? { pageDeleted: metaPage.pageDeleted } : {}),
        ...(metaPage?.pageVerification ? { pageVerification: metaPage.pageVerification } : {}),
        ...(takenDownIds.length ? { takenDownIds, adsTakenDown: takenDownIds.length } : {}),
      });
      g.edge(itemNode, a, "posted_by", `reklamodawca według biblioteki reklam (${account.platform}), identyfikator ${account.id}`);
      add(a, "advertiser", [itemNode, a], 1, `to samo konto reklamodawcy w bibliotece reklam (${account.platform}: ${account.id}${libRecord?.legalName ? `, „${libRecord.legalName}”` : ""})`);
    } else if (advertiser) {
      const a = g.node("advertiser", normAdvertiser(advertiser), advertiser);
      g.edge(itemNode, a, "posted_by", "reklamodawca podany w danych reklamy");
      add(a, "advertiser", [itemNode, a], 1, `ten sam reklamodawca „${advertiser}”`);
      advertiserNamePivot = a;
    }

    // Input columns outside the mapping: shown as input data, and linking only for columns named in config.extraPivots
    const extraEntries = Object.entries(item.extra).filter(([, v]) => typeof v === "string" && v.trim() !== "");
    if (extraEntries.length) itemData.inputExtra = Object.fromEntries(extraEntries.slice(0, MAX_INPUT_EXTRA).map(([k, v]) => [k, v.length > MAX_INPUT_EXTRA_CHARS ? `${v.slice(0, MAX_INPUT_EXTRA_CHARS - 1)}…` : v]));
    for (const [column, type] of Object.entries(config.extraPivots ?? {})) {
      const value = item.extra[column]?.trim();
      if (!value || !ENTITY_TYPES.includes(type) || type === "item") continue;
      const id = g.node(type, `extra:${column}=${value}`, `${column}: ${value}`, { column, value, fromInput: true });
      g.edge(itemNode, id, "mentions", `kolumna ${column} danych wejściowych`);
      add(id, type, [itemNode, id], 1, `ta sama wartość kolumny ${column} z danych wejściowych („${value}”)`);
    }

    if (enr?.image) {
      const ih = g.node("imagehash", enr.image.dhash, `obraz ${enr.image.dhash}`, {
        dhash: enr.image.dhash,
        ahash: enr.image.ahash,
        width: enr.image.width,
        height: enr.image.height,
      });
      g.node("item", item.id, "", { dhash: enr.image.dhash });
      g.edge(itemNode, ih, "has_image", "dHash kreacji reklamy");
      // an ad-library view is mostly interface: two different ads can hash identically
      if (ui?.view !== "ad_library") add(ih, "imagehash", [itemNode, ih], 1, `identyczny obraz (dHash ${enr.image.dhash})`);
    }
    // The same creative file (SHA-256 of the bytes): a node of the image-hash type keyed "sha256:<hex>"
    const creativeFiles: Array<{ sha: string; media: "image" | "video" }> = [];
    if (enr?.image?.sha256) creativeFiles.push({ sha: enr.image.sha256, media: "image" });
    if (enr?.videoSha256) creativeFiles.push({ sha: enr.videoSha256, media: "video" });
    for (const f of creativeFiles) {
      const what = f.media === "video" ? "plik wideo" : "plik obrazu";
      const id = g.node("imagehash", `${CREATIVE_FILE_PREFIX}${f.sha}`, `${what} kreacji ${f.sha.slice(0, 12)}…`, { sha256: f.sha, media: f.media, exactFile: true });
      g.edge(itemNode, id, "has_image", `SHA-256 pliku kreacji (${what})`);
      add(id, "imagehash", [itemNode, id], 1, `ten sam plik kreacji (${what}, SHA-256 ${f.sha.slice(0, 16)}…)`);
    }

    /**
     * Fields of the platform's visitor record (B-331, B-345): the cloaker customer account keyed by cloaker
     * host and `cl_sid` (a sid alone or a host alone is an attribute: sid numbers repeat across cloaker
     * hosts, one host serves many customers), `cl_did` as an attribute, the launcher UUID and the 16-digit
     * id of the Meta campaign name. A launcher equal to `owner_uuid` is the same evidence as the platform
     * account and adds no pivot; without an owner it is the owner (as `launcher=` in platform links);
     * only a different UUID becomes a launcher account of its own.
     */
    const addVisitFields = (lc: LanderConfig, from: string, basePath: string[], relation: number) => {
      const cl = lc.cloaker;
      if (cl) {
        itemData.cloaker = { sid: cl.sid, domain: cl.domain, did: cl.did };
        itemData.cloakerInSource = true;
        if (cl.sid && cl.domain) {
          const key = `${cl.domain}/${cl.sid}`;
          const id = g.node("cloaker_account", key, `konto cloakera ${cl.sid} na ${cl.domain}`, { sid: cl.sid, cloakerHost: cl.domain });
          g.edge(from, id, "built_on", `platforma stron zapisuje w kodzie konto klienta cloakera (cl_sid ${cl.sid}, cl_domain ${cl.domain})`);
          add(id, "cloaker_account", [...basePath, id], relation, `to samo konto klienta cloakera (cl_sid ${cl.sid} na ${cl.domain})`);
        }
      }
      if (lc.launcherId) {
        itemData.launcher = lc.launcherId;
        if (lc.launcherId === lc.ownerId) itemData.launcherSameAsOwner = true;
        else if (!lc.ownerId) {
          const id = g.node("platform_account", lc.launcherId, `konto ${lc.launcherId.slice(0, 8)}… na platformie stron`, { ownerId: lc.launcherId, platform: lc.platform });
          g.edge(from, id, "built_on", `pole launcher rekordu platformy wskazuje konto (ta sama wartość co owner_uuid na innych stronach)`);
          add(id, "platform_account", [...basePath, id], relation, `to samo konto na platformie stron (launcher ${lc.launcherId})`);
          itemData.platformAccount ??= lc.launcherId;
          itemData.platformAccountSource ??= "launcher";
        } else {
          const id = g.node("launcher_account", lc.launcherId, `konto launchera ${lc.launcherId.slice(0, 8)}…`, { launcherId: lc.launcherId, ownerId: lc.ownerId });
          g.edge(from, id, "built_on", `rekord platformy zapisuje konto, z którego uruchomiono reklamy (launcher ${lc.launcherId}, inne niż owner_uuid ${lc.ownerId})`);
          add(id, "launcher_account", [...basePath, id], relation, `to samo konto narzędzia do uruchamiania reklam (launcher ${lc.launcherId})`);
        }
      }
      if (lc.fbCampaignNameId) {
        const v = lc.fbCampaignNameId;
        itemData.fbCampaignNameId = v;
        const id = g.node("campaign_param", `fb_campaign_name_id=${v}`, `fb_campaign_name_id=${v}`, {
          canonicalName: "fb_campaign_name_id",
          name: "fb_campaign_name",
          value: v,
          cyrillic: false,
          macro: false,
          origin: "script",
        });
        g.edge(from, id, "carries_param", `16-cyfrowy identyfikator w nazwie kampanii Meta (fb_campaign_name) w rekordzie platformy stron`);
        add(id, "campaign_param", [...basePath, id], relation, `ten sam identyfikator w nazwie kampanii Meta (${v})`);
      }
    };
    // Replaced captions on a borrowed video (B-326) and the watermark of the original recording (B-327):
    // attributes of the material and template traces (notAloneKinds), never a link on their own
    if (enr?.videoOverlay) {
      const o = enr.videoOverlay;
      itemData.subtitleOverlay = { kind: o.kind, color: o.color, box: o.box, frames: o.frames };
      const id = g.node("overlay_template", o.key, `napisy podmienione: ${o.kind === "strip" ? `pas ${o.color === "black" ? "czarny" : "biały"}` : "rozmycie"} (${o.key.split(":")[2]})`, { kind: o.kind, box: o.box });
      g.edge(itemNode, id, "mentions", "pas z podmienionymi napisami na dole nagrania");
      add(id, "overlay_template", [itemNode, id], 1, `ten sam układ podmienionych napisów (${o.key})`);
    }
    if (enr?.sourceWatermark) {
      const w = enr.sourceWatermark;
      itemData.sourceWatermark = { text: w.text, corner: w.corner };
      const id = g.node("reused_footage", `watermark:${w.text}`, `znak źródła nagrania: ${w.text}`, { text: w.text, corner: w.corner });
      g.edge(itemNode, id, "mentions", `znak źródła w rogu kadru nagrania (${w.corner})`);
      add(id, "reused_footage", [itemNode, id], 1, `ten sam znak źródła cudzego nagrania („${w.text}”)`);
    }

    const addContacts = (
      from: string,
      basePath: string[],
      src: { emails?: string[]; phones?: string[]; telegram?: string[]; whatsapp?: string[]; sharedDocs?: string[]; onion?: string[]; messengers?: string[]; wallets?: Array<{ kind: string; address: string }> } | null | undefined,
      where: string,
      relation: number,
    ) => {
      if (!src) return;
      for (const e of src.emails ?? []) {
        const id = g.node("email", e, e);
        g.edge(from, id, "mentions", `adres e-mail ${where}`);
        add(id, "email", [...basePath, id], relation, `ten sam e-mail ${e}`);
      }
      for (const p of src.phones ?? []) {
        const id = g.node("phone", p, p);
        g.edge(from, id, "mentions", `numer telefonu ${where}`);
        add(id, "phone", [...basePath, id], relation, `ten sam numer telefonu ${p}`);
      }
      for (const w of src.whatsapp ?? []) {
        const isPhone = w.startsWith("+");
        // a group invitation has no node type of its own: the label says WhatsApp, so the viewer does not read it as Telegram
        const id = isPhone ? g.node("phone", w, w, { whatsapp: true }) : g.node("telegram", w, `WhatsApp ${w}`, { whatsappGroup: true });
        g.edge(from, id, "mentions", `kontakt WhatsApp ${where}`);
        add(id, isPhone ? "phone" : "telegram", [...basePath, id], relation, `ten sam kontakt WhatsApp ${w}`);
      }
      for (const t of src.telegram ?? []) {
        const id = g.node("telegram", t, t);
        g.edge(from, id, "mentions", `kontakt Telegram ${where}`);
        add(id, "telegram", [...basePath, id], relation, `ten sam kontakt Telegram ${t}`);
      }
      for (const d of src.sharedDocs ?? []) {
        const [service, ...rest] = d.split(":");
        const llm = service === "llm_chat";
        const id = g.node("shared_doc", d, llm ? `udostępniony czat z modelem językowym (${rest.join(":").slice(0, 12)}…)` : `${service} ${rest.join(":").slice(0, 16)}…`, { service });
        g.edge(from, id, "mentions", `${llm ? "udostępniony czat z modelem językowym" : "udostępniony dokument lub formularz"} ${where}`);
        add(id, "shared_doc", [...basePath, id], relation, `ten sam ${llm ? "udostępniony czat z modelem językowym" : "udostępniony dokument lub formularz"} (${service})`);
      }
      for (const o of src.onion ?? []) {
        const id = g.node("onion", o, `${o.slice(0, 12)}….onion`, {});
        g.edge(from, id, "mentions", `adres .onion ${where}`);
        add(id, "onion", [...basePath, id], relation, `ten sam adres .onion (${o.slice(0, 12)}…)`);
      }
      for (const m of src.messengers ?? []) {
        const [service, ...rest] = m.split(":");
        const id = g.node("messenger_invite", m, `${service} ${rest.join(":")}`, { service });
        g.edge(from, id, "mentions", `zaproszenie lub konto komunikatora ${where}`);
        add(id, "messenger_invite", [...basePath, id], relation, `to samo zaproszenie lub konto komunikatora (${service})`);
      }
      for (const w of src.wallets ?? []) {
        const id = g.node("wallet", `${w.kind}:${w.address}`, `${w.kind.toUpperCase()} ${shortAddr(w.address)}`, {
          kind: w.kind,
          address: w.address,
        });
        g.edge(from, id, "mentions", `adres portfela ${where}`);
        add(id, "wallet", [...basePath, id], relation, `ten sam portfel ${w.kind.toUpperCase()} ${w.address}`);
      }
    };

    addContacts(itemNode, [itemNode], enr?.text, "w treści reklamy", 1);

    /** Adds url -> host -> domain (+ ip/asn, ns, registrar, certs) and returns the url node. */
    const addUrlInfra = (url: string, path: string[], relation: number, infraRelation = relation): string | null => {
      const nu = normalizeUrl(url);
      if (!nu) return null;
      // Hosting of a deny-listed platform/shortener says nothing about the advertiser:
      // its IPs, NS, registrar and certificates are scaled by the domain's list factor.
      const platform = discounter.domainDiscount(nu.registrableDomain);
      const hostingRel = infraRelation * (platform ? platform.factor : 1);
      const domainInfraRel = relation * (platform ? platform.factor : 1);
      const urlNode = g.node("url", nu.url, shortUrl(nu.url), { url: nu.url, registrableDomain: nu.registrableDomain });
      const urlPath = [...path, urlNode];
      add(urlNode, "url", urlPath, relation, `ten sam URL ${shortUrl(nu.url)}`);
      const hostLabel = nu.isIdn ? `${toUnicodeHost(nu.host)} (${nu.host})` : nu.host;
      const hostNode = g.node("host", nu.host, hostLabel, { registrableDomain: nu.registrableDomain, isIdn: nu.isIdn });
      g.edge(urlNode, hostNode, "on_host", "host adresu URL");
      const hostPath = [...urlPath, hostNode];
      add(hostNode, "host", hostPath, relation, `ten sam host ${hostLabel}`);

      const hostInfo = dataset.hosts[nu.host];
      // CNAME chain: the registrable domain of each target (operator TDS domains survive label rotation)
      const seenTargets = new Set<string>();
      for (const target of hostInfo?.cnameChain ?? []) {
        const td = registrableDomain(target) ?? target;
        if (seenTargets.has(td) || td === nu.registrableDomain) continue;
        seenTargets.add(td);
        const cnNode = g.node("cname_target", td, `CNAME → ${td}`, { registrableDomain: td });
        const cnData = g.nodes.get(cnNode)!.data;
        const targets = (cnData.targets as string[] | undefined) ?? [];
        if (!targets.includes(target)) targets.push(target);
        cnData.targets = targets.sort();
        g.edge(hostNode, cnNode, "cname_to", `rekord CNAME: ${nu.host} → ${target}`);
        add(cnNode, "cname_target", [...hostPath, cnNode], hostingRel, `wspólny cel CNAME ${td}`);
      }
      for (const ip of hostInfo?.ips ?? []) {
        const asn = dataset.ips[ip];
        const ipNode = g.node("ip", ip, ip, {
          asns: asn?.asns ?? (asn?.asn ? [asn.asn] : []),
          asName: asn?.asName ?? null,
          prefix: asn?.prefix ?? null,
          country: asn?.country ?? null,
        });
        g.edge(hostNode, ipNode, "resolves_to", "rekord DNS A/AAAA");
        const ipPath = [...hostPath, ipNode];
        add(ipNode, "ip", ipPath, hostingRel, `wspólny adres IP ${ip}`);
        if (asn?.asn) {
          const asnNode = g.node("asn", `AS${asn.asn}`, `AS${asn.asn}${asn.asName ? ` ${asn.asName.split(" ")[0]}` : ""}`, {
            asn: asn.asn,
            asName: asn.asName,
            country: asn.country,
            registry: asn.registry,
          });
          g.edge(ipNode, asnNode, "announced_by", `prefiks ${asn.prefix ?? "?"} ogłaszany przez AS${asn.asn}`);
          add(asnNode, "asn", [...ipPath, asnNode], hostingRel, `ten sam system autonomiczny AS${asn.asn}`);
        }
      }

      const domain = nu.registrableDomain;
      if (domain) {
        const di = dataset.domains[domain];
        const domainNode = g.node("domain", domain, nu.isIdn ? `${toUnicodeHost(domain)} (${domain})` : domain, {
          registrableDomain: domain,
          registrar: di?.rdap?.registrar ?? null,
          created: di?.rdap?.created ?? null,
          expires: di?.rdap?.expires ?? null,
          status: di?.rdap?.status ?? [],
          nameservers: di?.ns ?? [],
          mx: di?.mx ?? [],
          certCount: di?.ct?.certs.length ?? null,
          // off the air: its live NS and A belong to the registrar's suspension service, not the operator
          ...(rdapSuspended(di?.rdap?.status, config.lists.suspendedRdapStatuses ?? []) ? { suspended: true } : {}),
          // an archived copy predates the registration: the domain changed hands, so its old content says nothing about the operator
          ...(di?.reRegistered ? { reRegistered: true } : {}),
        });
        g.edge(hostNode, domainNode, "in_domain", "domena rejestrowalna (eTLD+1)");
        const domainPath = [...hostPath, domainNode];
        add(domainNode, "domain", domainPath, relation, `ta sama domena ${domain}`);
        const tpl = templateOf.get(domain);
        if (tpl) {
          for (const [key, agnostic] of [
            [tpl.specific, false],
            [tpl.agnostic, true],
          ] as const) {
            if (!templateShared(key)) continue;
            const domainsWithTpl = [...(templateDomains.get(key) ?? [])].sort();
            const pNode = g.node("domain_pattern", key, `wzorzec ${key}`, {
              template: key,
              agnostic,
              literalChars: tpl.literalChars,
              domains: domainsWithTpl.slice(0, 50),
              domainCount: domainsWithTpl.length,
            });
            g.edge(domainNode, pNode, "matches_pattern", `nazwa ${domain} pasuje do wzorca ${key}`);
            add(pNode, "domain_pattern", [...domainPath, pNode], relation, `ten sam wzorzec nazw domen ${key}`);
          }
        }
        if (di) {
          if (di.ns.length) {
            const nsList = [...di.ns].sort();
            const nsKey = nsList.join(" + ");
            const nsNode = g.node("nameserver", nsKey, nsList.join(", "), { nameservers: nsList });
            g.edge(domainNode, nsNode, "uses_ns", "rekordy NS domeny");
            add(nsNode, "nameserver", [...domainPath, nsNode], Math.min(hostingRel, domainInfraRel), `te same serwery NS (${nsList.join(", ")})`);
          }
          // Own mail server (B-177): the MX set, discounted when every host is a shared provider (weights.ts)
          const mxList = [...new Set((di.mx ?? []).map((m) => m.toLowerCase().replace(/\.$/, "")).filter(Boolean))].sort();
          if (mxList.length) {
            const mxNode = g.node("mx", mxList.join(" + "), mxList.join(", "), { mx: mxList });
            g.edge(domainNode, mxNode, "uses_mx", "rekordy MX domeny");
            add(mxNode, "mx", [...domainPath, mxNode], domainInfraRel, `ten sam serwer poczty (${mxList.join(", ")})`);
          }
          // Verification tokens in TXT: one per Business Manager / Search Console account, like a pixel ID
          for (const t of verificationTokens(di.txt ?? [])) {
            const label = `${TRACKER_LABELS[t.kind] ?? t.kind} ${t.id}`;
            const id = g.node("tracker", `${t.kind}:${t.id}`, label, { kind: t.kind, trackerId: t.id, verification: true });
            g.edge(domainNode, id, "uses_tracker", "token weryfikacji domeny w rekordzie DNS TXT");
            add(id, "tracker", [...domainPath, id], domainInfraRel, `ten sam ${label} (konto platformy, które zweryfikowało domenę)`);
          }
          if (di.rdap?.registrar) {
            const reg = di.rdap.registrar;
            const regNode = g.node("registrar", reg.toLowerCase(), reg, { registrar: reg });
            g.edge(domainNode, regNode, "registered_with", `RDAP: rejestrator${di.rdap.created ? `, utworzona ${di.rdap.created.slice(0, 10)}` : ""}`);
            add(regNode, "registrar", [...domainPath, regNode], domainInfraRel, `ten sam rejestrator ${reg}`);
          }
          for (const cert of di.ct?.certs ?? []) {
            const regDomains = new Set(cert.sanDomains.map((s) => registrableDomain(s)).filter((d): d is string => !!d));
            if (regDomains.size < 2) continue; // only certificates that can link different domains
            const key = cert.serial ?? cert.id;
            const certNode = g.node("cert", key, `cert ${cert.issuer} ${cert.notBefore?.slice(0, 10) ?? ""} (${regDomains.size} domen)`, {
              crtshId: cert.id,
              serial: cert.serial,
              issuer: cert.issuer,
              notBefore: cert.notBefore,
              notAfter: cert.notAfter,
              sanDomains: cert.sanDomains.slice(0, 50),
              sanCount: cert.sanDomains.length,
              sanRegistrableCount: regDomains.size,
            });
            g.edge(domainNode, certNode, "has_cert", "CT log: domena w SAN certyfikatu");
            add(certNode, "cert", [...domainPath, certNode], domainInfraRel, `wspólny certyfikat TLS (${cert.issuer}), SAN obejmuje obie domeny`);
          }
        }
      }
      return urlNode;
    };

    // Landing URL and its redirect chain
    if (enr?.landing) {
      const page = enr.pageKey ? dataset.pages[enr.pageKey] : undefined;
      const ex = page?.extract;
      // A parked final page means its hosting (IP, ASN, NS) belongs to a parking provider.
      const parked = !!ex && discounter.isParked([ex.title, ex.description, ex.visibleText]);
      const pageRel = parked ? config.lists.parkingFactor : 1;
      const chain: Array<{ url: string; status: number | null; kind: string | null }> = [];
      if (page) {
        for (const hop of page.fetch.redirectChain) chain.push({ url: hop.url, status: hop.status, kind: hop.kind });
        chain.push({ url: page.fetch.finalUrl, status: page.fetch.status, kind: null });
      } else chain.push({ url: enr.landing.url, status: null, kind: null });

      let path = [itemNode];
      let prev: string | null = null;
      let prevHop: { status: number | null; kind: string | null } | null = null;
      chain.forEach((hop, idx) => {
        const isFinal = idx === chain.length - 1;
        const urlNode = addUrlInfra(hop.url, path, 1, isFinal ? pageRel : 1);
        if (!urlNode) return;
        if (prev === null) g.edge(itemNode, urlNode, "landing", "link docelowy reklamy");
        else if (prev !== urlNode) {
          g.edge(prev, urlNode, "redirect", prevHop?.kind === "meta-refresh" ? "przekierowanie meta refresh" : `przekierowanie HTTP ${prevHop?.status ?? ""}`.trim());
        }
        if (prev !== urlNode) path = [...path, urlNode];
        prev = urlNode;
        prevHop = hop;
      });

      const finalUrlNode: string | null = prev;
      // Age of the landing domain and its first certificate when the material was first seen (a description, not a pivot)
      const finalDomain = finalUrlNode ? (g.nodes.get(finalUrlNode)?.data.registrableDomain as string | null | undefined) : null;
      const fdi = finalDomain ? dataset.domains[finalDomain] : undefined;
      if (finalDomain && fdi) {
        if (fdi.rdap?.registrantHidden) itemData.registrantHidden = true;
        const age = domainAgeAt(fdi.rdap?.created, (fdi.ct?.certs ?? []).map((c) => c.notBefore), item.firstSeen);
        if (age.domainAgeDays !== null) itemData.domainAgeDays = age.domainAgeDays;
        if (age.certAgeDays !== null) itemData.certAgeDays = age.certAgeDays;
        const dn = g.nodes.get(nodeId("domain", finalDomain));
        if (dn) {
          // lead of the registration and of the first certificate over the domain's earliest material (B-206)
          if (age.domainAgeDays !== null) dn.data.leadDays = Math.min(Number(dn.data.leadDays ?? Infinity), age.domainAgeDays);
          if (age.certAgeDays !== null) dn.data.certLeadDays = Math.min(Number(dn.data.certLeadDays ?? Infinity), age.certAgeDays);
          if (age.firstCertificate) dn.data.firstCertificate = age.firstCertificate;
        }
      }
      if (finalUrlNode && ex) {
        const rel = pageRel;
        if (parked) g.node("url", g.nodes.get(finalUrlNode)!.key, "", { parked: true });
        const finalPath = path;
        for (const t of ex.trackers) {
          const label = `${TRACKER_LABELS[t.kind] ?? t.kind} ${t.id}`;
          const id = g.node("tracker", `${t.kind}:${t.id}`, label, { kind: t.kind, trackerId: t.id });
          g.edge(finalUrlNode, id, "uses_tracker", "identyfikator trackera w kodzie strony");
          add(id, "tracker", [...finalPath, id], rel, `ten sam identyfikator ${label}`);
        }
        const fav = page?.favicon;
        if (fav?.hashes) {
          // A clone of a news site carries that site's favicon: a trait of the impersonated brand, not of the operator.
          const brand = impersonatedBrand(ex.title, page?.fetch.finalUrl ?? enr.landing.url);
          if (brand) itemData.impersonatedBrand = brand;
          const id = g.node("favicon", `mmh3:${fav.hashes.mmh3}`, `favicon ${fav.hashes.mmh3}`, {
            url: fav.url,
            mmh3: fav.hashes.mmh3,
            sha256: fav.hashes.sha256,
            dhash: fav.hashes.dhash,
            ...(brand ? { impersonatedBrand: brand } : {}),
          });
          g.edge(finalUrlNode, id, "has_favicon", "favicon strony (hash Shodan mmh3)");
          add(id, "favicon", [...finalPath, id], rel, `identyczny favicon (mmh3 ${fav.hashes.mmh3})`);
        }
        addContacts(finalUrlNode, finalPath, ex, "na stronie docelowej", rel);
        // the same identifiers in the page's requests (HAR) when the page text no longer carries them
        addContacts(finalUrlNode, finalPath, page?.kit?.requestContacts, "w żądaniach strony (HAR)", rel);
        // a v2 onion address is long retired: an attribute of the material, not a trace
        if (ex.onionV2?.length) itemData.onionV2 = ex.onionV2;
        // The example number of the form field travels with the template to every site built on it:
        // a template trace (page_template, notAloneKinds), never a shared phone line (I23, 3b).
        for (const p of ex.phoneExamples ?? []) {
          const id = g.node("page_template", `phone_example:${p}`, `przykładowy numer z formularza ${p}`, { phoneExample: p });
          g.edge(finalUrlNode, id, "built_on", "przykładowy numer w polu formularza (placeholder, „np. …”)");
          add(id, "page_template", [...finalPath, id], rel, `ten sam przykładowy numer z szablonu formularza ${p}`);
        }
        for (const d of ex.outboundDomains) {
          const disc = discounter.domainDiscount(d);
          if (disc && disc.factor === 0) continue;
          const id = g.node("domain", d, d, { registrableDomain: d });
          g.edge(finalUrlNode, id, "links_to", "strona docelowa linkuje do tej domeny");
          add(id, "domain", [...finalPath, id], rel * config.outboundLinkFactor, `strona linkuje do domeny ${d}`);
        }
      }

      // Page kit: form/API backends, hidden fields, own assets, code comments, DOM structure
      const kit = page?.kit;
      if (finalUrlNode && kit) {
        const rel = pageRel;
        const finalPath = path;
        for (const ep of kit.endpoints) {
          const client = ep.clientId ? ` (klient ${ep.clientId.length > 16 ? `${ep.clientId.slice(0, 15)}…` : ep.clientId})` : "";
          const label = ep.sameOrigin ? `backend ${ep.pathTemplate} (ta sama domena)` : `backend ${ep.host}${ep.pathTemplate}${client}`;
          const id = g.node("endpoint", ep.key, label, {
            host: ep.host,
            pathTemplate: ep.pathTemplate,
            sameOrigin: ep.sameOrigin,
            method: ep.method,
            via: ep.via,
            registrableDomain: registrableDomain(ep.host),
            ...(ep.clientId ? { clientId: ep.clientId, clientIdSource: ep.clientIdSource ?? null } : {}),
          });
          g.edge(finalUrlNode, id, "posts_to", `strona wysyła dane (${ep.via}${ep.method ? `, ${ep.method}` : ""}) do ${ep.raw}`);
          const how = ep.sameOrigin
            ? `ten sam backend formularza *${ep.pathTemplate}`
            : ep.clientId
              ? `ten sam backend formularza z tym samym identyfikatorem klienta (${ep.host}${ep.pathTemplate}, ${ep.clientIdSource ?? "identyfikator"} ${ep.clientId})`
              : `ten sam backend formularza ${ep.host}${ep.pathTemplate}`;
          const known = ep.sameOrigin ? null : knownBackendLabel(ep.host);
          add(id, "endpoint", [...finalPath, id], rel, known ? `${how} [${known}]` : how);
        }
        const hidden = discounter.specificHiddenFields(kit.hiddenFields);
        if (hidden.length >= config.kit.minHiddenFields) {
          const key = hidden.join(",");
          const id = g.node("hidden_fields", key, `ukryte pola: ${hidden.join(", ")}`, { fields: hidden });
          g.edge(finalUrlNode, id, "has_hidden_fields", "zestaw ukrytych pól formularza");
          add(id, "hidden_fields", [...finalPath, id], rel, `ten sam zestaw ukrytych pól (${hidden.join(", ")})`);
        }
        for (const asset of kit.assets) {
          if (!asset.sameOrigin) {
            const disc = discounter.domainDiscount(registrableDomain(asset.host));
            if (disc && disc.factor === 0) continue; // public CDN or library host
          }
          const id = g.node("asset", asset.key, `${asset.kind.toUpperCase()} ${asset.sameOrigin ? asset.path : `${asset.host}${asset.path}`}`, {
            url: asset.url,
            host: asset.host,
            path: asset.path,
            basename: asset.basename,
            kind: asset.kind,
            sameOrigin: asset.sameOrigin,
          });
          g.edge(finalUrlNode, id, "loads_asset", `strona ładuje ${asset.kind.toUpperCase()} ${asset.url}`);
          add(id, "asset", [...finalPath, id], rel, `ten sam plik ${asset.kind.toUpperCase()} ${asset.basename}`);
          // Files hotlinked from one account's site on a free hosting platform: that account's hosting,
          // not a copied kit (a buyer copies kit files to its own domain)
          const site = asset.sameOrigin ? null : discounter.accountSite(asset.host);
          if (site) {
            const hostNode = g.node("host", asset.host, asset.host, { registrableDomain: registrableDomain(asset.host), isIdn: false });
            g.edge(id, hostNode, "on_host", `plik leży na witrynie jednego konta platformy hostingowej (${site.reason})`);
            add(hostNode, "host", [...finalPath, id, hostNode], rel * site.factor, `pliki strony ładowane z tej samej witryny konta na darmowym hostingu (${asset.host})`);
          }
        }
        // Account on video or code hosting named in the page, its requests or its file addresses (B-342,
        // B-148: jsDelivr `/gh/<user>`; notAloneKinds). File addresses are read here too, so the trace does
        // not depend on the extraction having seen the account. Listed on the material as an attribute.
        const accounts = [...new Set([...(kit.hostingAccounts ?? []), ...hostingAccountsIn(kit.assets.map((a) => a.url).join("\n"))])].sort();
        for (const h of accounts) {
          const [service, ...rest] = h.split(":");
          const id = g.node("hosting_account", h, `${service} ${rest.join(":")}`, { service });
          g.edge(finalUrlNode, id, "mentions", `zasób z konta ${service} ${rest.join(":")}`);
          add(id, "hosting_account", [...finalPath, id], rel, `to samo konto na hostingu (${service} ${rest.join(":")})`);
        }
        if (accounts.length) itemData.hostingAccounts = [...new Set([...((itemData.hostingAccounts as string[] | undefined) ?? []), ...accounts])].sort();
        for (const text of kit.comments) {
          const cyr = /[\u0400-\u04FF]/.test(text);
          const id = g.node("comment", text, `„${text.length > 60 ? `${text.slice(0, 59)}…` : text}”`, { text, cyrillic: cyr });
          g.edge(finalUrlNode, id, "has_comment", "komentarz w kodzie strony");
          add(id, "comment", [...finalPath, id], rel, `ten sam komentarz w kodzie („${text.length > 80 ? `${text.slice(0, 79)}…` : text}”)`);
        }
        for (const pid of kit.pathIds ?? []) {
          const id = g.node("path_id", pid.id, `konto ${pid.id.slice(0, 8)}… w ścieżkach zasobów`, { pathId: pid.id, prefix: pid.prefix });
          g.edge(finalUrlNode, id, "uses_path_id", `identyfikator (UUID) w ścieżkach zasobów ładowanych z domeny strony: ${pid.prefix}${pid.id}/…`);
          add(id, "path_id", [...finalPath, id], rel, `ten sam identyfikator w ścieżkach zasobów (${pid.prefix}${pid.id})`);
        }
        // Records of the landing-page platform (window.aio): account, campaign, template, traffic source
        const lc = kit.lander;
        const tenants = kit.platformTenants ?? [];
        if (tenants.length) itemData.platformTenants = tenants;
        if (lc?.ownerId && tenants.length && !tenants.includes(lc.ownerId)) {
          itemData.platformAccountWarning = `najemca landing-cdn (${tenants.join(", ")}) różni się od owner_uuid (${lc.ownerId}) z window.${lc.platform}: konto przypisane według owner_uuid`;
        }
        if (!lc?.ownerId && tenants.length) {
          // No page code with the owner (a HAR or a scan's request list): the tenant stands in for the account
          itemData.landerPlatform ??= lc?.platform ?? "aio";
          for (const t of tenants) {
            const mapped = tenantOwner.get(t) ?? null;
            const account = mapped ?? t;
            const id = g.node("platform_account", account, `konto ${account.slice(0, 8)}… na platformie stron`, {
              ownerId: mapped ?? (g.nodes.get(nodeId("platform_account", account))?.data.ownerId as string | undefined) ?? null,
              tenantId: t,
              platform: lc?.platform ?? "aio",
            });
            g.edge(finalUrlNode, id, "built_on", `pliki strony leżą w katalogu najemcy platformy stron (landing-cdn/${t})${mapped ? `; ten sam najemca ma konto owner_uuid ${mapped}` : ""}`);
            add(id, "platform_account", [...finalPath, id], rel, `to samo konto na platformie stron (najemca landing-cdn ${t}${mapped ? ` = owner_uuid ${mapped}` : ""})`);
          }
          const first = tenants[0];
          const mapped = tenantOwner.get(first) ?? null;
          itemData.platformAccount = mapped ?? first;
          itemData.platformAccountSource = mapped ? "tenant→owner_uuid" : "tenant";
        }
        if (lc) {
          itemData.landerPlatform = lc.platform;
          if (lc.ownerId) {
            itemData.platformAccount = lc.ownerId;
            itemData.platformAccountSource = "owner_uuid";
          }
          if (lc.campaignName) itemData.platformCampaignName = lc.campaignName;
          if (lc.landingName) itemData.landingName = lc.landingName;
          if (lc.sourceName) itemData.trafficSource = lc.sourceName;
          if (lc.sourceName && /cloak/i.test(lc.sourceName)) itemData.cloakerInSource = true;
          if (lc.ownerId) {
            const prevTenants = (g.nodes.get(nodeId("platform_account", lc.ownerId))?.data.tenants as string[] | undefined) ?? [];
            const tenantsOfOwner = [...new Set([...prevTenants, ...tenants.filter((t) => t !== lc.ownerId)])].sort();
            const id = g.node("platform_account", lc.ownerId, `konto ${lc.ownerId.slice(0, 8)}… na platformie stron`, {
              ownerId: lc.ownerId,
              platform: lc.platform,
              ...(tenantsOfOwner.length ? { tenants: tenantsOfOwner } : {}),
            });
            g.edge(finalUrlNode, id, "built_on", `strona zapisuje w kodzie konto właściciela na platformie stron (window.${lc.platform}, owner_uuid ${lc.ownerId})`);
            add(id, "platform_account", [...finalPath, id], rel, `to samo konto na platformie stron (owner_uuid ${lc.ownerId})`);
          }
          if (lc.campaignId) {
            const name = lc.campaignName ? `„${lc.campaignName}”` : lc.campaignId.slice(0, 8);
            const id = g.node("platform_campaign", lc.campaignId, `kampania ${name}`, { campaignId: lc.campaignId, name: lc.campaignName, number: lc.campaignNumber, ownerId: lc.ownerId });
            g.edge(finalUrlNode, id, "built_on", `strona należy do kampanii ${name} na platformie stron (${lc.campaignId}${lc.campaignNumber ? `, nr ${lc.campaignNumber}` : ""})`);
            add(id, "platform_campaign", [...finalPath, id], rel, `ta sama kampania na platformie stron (${name}, ${lc.campaignId})`);
          }
          if (lc.templateId) {
            const id = g.node("page_template", lc.templateId, `szablon strony ${lc.templateId.slice(0, 8)}…`, { templateId: lc.templateId, landerTypeId: lc.landerTypeId });
            g.edge(finalUrlNode, id, "built_on", `strona zbudowana na szablonie platformy (lander_template_uuid ${lc.templateId})`);
            add(id, "page_template", [...finalPath, id], rel, `ten sam szablon strony na platformie (lander_template_uuid ${lc.templateId})`);
          }
          addVisitFields(lc, finalUrlNode, finalPath, rel);
        }
        // Traces seen only in the page's requests (HAR, scan): pixel IDs and third-party hosts (B-158)
        for (const t of kit.requestTrackers ?? []) {
          if (ex?.trackers.some((x) => x.kind === t.kind && x.id === t.id)) continue;
          const label = `${TRACKER_LABELS[t.kind] ?? t.kind} ${t.id}`;
          const id = g.node("tracker", `${t.kind}:${t.id}`, label, { kind: t.kind, trackerId: t.id });
          g.edge(finalUrlNode, id, "uses_tracker", "identyfikator trackera w adresie żądania strony (HAR)");
          add(id, "tracker", [...finalPath, id], rel, `ten sam identyfikator ${label} (z żądań strony)`);
        }
        const requestHosts = new Set<string>();
        for (const host of kit.requestHosts ?? []) {
          // public services and the browser's own traffic say nothing about the operator: no node at all
          if (discounter.domainDiscount(registrableDomain(host)) || discounter.browserHost(host)) continue;
          const id = g.node("endpoint", `tracker_host:${host}`, `host ${host} (żądania strony)`, {
            host,
            pathTemplate: "*",
            sameOrigin: false,
            via: "har",
            registrableDomain: registrableDomain(host),
            trackerHost: true,
          });
          g.edge(finalUrlNode, id, "posts_to", `strona wysyła żądania do ${host} (HAR)`);
          add(id, "endpoint", [...finalPath, id], rel, `ten sam host spoza domeny strony w jej żądaniach (${host})`);
          requestHosts.add(host);
        }
        // Third-party hosts kept above (push, trackers, back-button scripts) listed on the material (B-158)
        if (requestHosts.size) itemData.requestHosts = [...new Set([...((itemData.requestHosts as string[] | undefined) ?? []), ...requestHosts])].sort();
        // Platforms of the page (B-190): an attribute read from the platform paths of its files and backends
        const platforms = new Set<string>(lc?.platform ? [lc.platform] : tenants.length ? ["aio"] : []);
        for (const path of [...kit.assets.map((a) => a.path), ...kit.endpoints.map((e) => e.pathTemplate)]) {
          const p = platformPathRule(config.lists.endpointPlatformPaths, path)?.platform;
          if (p) platforms.add(p);
        }
        if ((kit.requestClickUrls ?? []).some((u) => /[?&]upd_clickid=/i.test(u))) platforms.add("binom");
        if (platforms.size) itemData.pagePlatforms = [...new Set([...((itemData.pagePlatforms as string[] | undefined) ?? []), ...platforms])].sort();
        if (kit.domSimhash) itemData.domSimhash = kit.domSimhash;
        if (kit.cyrillicComments) itemData.cyrillic = true;
        const commentLangs = [...new Set(kit.comments.map(commentLanguage).filter((l): l is "uk" | "ru" => !!l))].sort();
        if (commentLangs.length) itemData.codeCommentLang = commentLangs;
        // Comments written into the page: the set of authors is part of the template
        const cb = kit.commentBlock;
        if (cb) {
          const who = `${cb.authors.slice(0, 3).join(", ")}${cb.authors.length > 3 ? "…" : ""}`;
          const id = g.node("comment_block", cb.key, `blok ${cb.count} komentarzy (${who})`, { authors: cb.authors, count: cb.count, samples: cb.samples });
          g.edge(finalUrlNode, id, "has_comment_block", `sekcja komentarzy wpisana w kod strony, bez wtyczki serwisu (${cb.count} komentarzy, ${cb.authors.length} autorów)`);
          add(id, "comment_block", [...finalPath, id], rel, `ten sam blok fałszywych komentarzy (${cb.authors.length} autorów: ${who})`);
          itemData.commentBlock = id;
          itemData.fakeCommentCount = Math.max(Number(itemData.fakeCommentCount ?? 0), cb.count);
        }
        // The key of the CRM / lead API the form posts with: one account of the buyer of the leads (I23).
        // Only the hash and a preview ever reach the graph, the report and the evidence pack.
        for (const k of kit.crmKeys ?? []) {
          const id = g.node("crm_key", k.sha256, `klucz API CRM ${k.preview}`, { sha256: k.sha256, preview: k.preview, field: k.name, via: k.via });
          g.edge(finalUrlNode, id, "posts_to", `formularz wysyła zgłoszenia z kluczem API (${k.name}, ${k.preview})`);
          add(id, "crm_key", [...finalPath, id], rel, `ten sam klucz API CRM / sieci afiliacyjnej (${k.preview}, sha256 ${k.sha256.slice(0, 12)}…)`);
        }
        // Rare sentences of the template (page text, thank-you message of the scripts): notAloneKinds (I23).
        // A copying error shared by two pages is rarer than a correct sentence: a higher relation, capped.
        const tp = config.templatePhrase;
        for (const p of tp ? (kit.templatePhrases ?? []).filter((x) => phraseShared(x.key)) : []) {
          const quote = p.text.length > 60 ? `${p.text.slice(0, 59)}…` : p.text;
          const id = g.node("template_phrase", p.key, `zdanie „${quote}”`, { text: p.text, source: p.source, ...(p.oddity ? { oddity: p.oddity } : {}) });
          g.edge(finalUrlNode, id, "mentions", `zdanie ${p.source === "script" ? "z komunikatu w skrypcie strony" : p.source === "comment" ? "z komentarza w kodzie strony (wykomentowana stara wersja)" : "z tekstu strony"}: „${quote}”`);
          const oddRel = p.oddity && tp ? Math.min(tp.oddityFactor, tp.maxWeight / config.typeWeights.template_phrase) : 1;
          const odd = p.oddity === "repeat" ? ", z tą samą wpadką: powtórzone słowa" : p.oddity === "mixed_script" ? ", z tą samą wpadką: mieszane alfabety" : "";
          add(id, "template_phrase", [...finalPath, id], rel * oddRel, `to samo rzadkie zdanie szablonu „${quote}”${odd}`);
        }
        // Developer messages of the kit's own scripts (I25, notAloneKinds): a node per shared message; the
        // pair rule (several messages or one long one) is applied when pivots become pair premises.
        for (const k of config.kitString ? (kit.kitStrings ?? []).filter((x) => kitShared(x.key)) : []) {
          const quote = k.text.length > 60 ? `${k.text.slice(0, 59)}…` : k.text;
          const id = g.node("kit_string", k.key, `komunikat „${quote}”`, { text: k.text, words: k.key.split(" ").length, ...(k.oddity ? { oddity: k.oddity } : {}) });
          g.edge(finalUrlNode, id, "mentions", `komunikat programisty w skrypcie strony: „${quote}”`);
          add(id, "kit_string", [...finalPath, id], rel, `ten sam komunikat ze skryptu zestawu stron „${quote}”`);
        }
        // Lead funnel of the landing-page platform (B-332, notAloneKinds): form, flows, key id, event host
        for (const tok of kit.leadFlow ?? []) addLeadFlow(finalUrlNode, finalPath, tok, rel);
        // Back-trap library and a script hidden in an SVG (B-335, B-334): attributes; the SVG's addresses are ordinary url nodes
        if (kit.backLib?.length) itemData.backLib = kit.backLib;
        if (kit.svgScript) {
          itemData.svgScript = true;
          for (const u of kit.svgScript.urls) addUrlInfra(u, finalPath, rel * 0.5);
        }
        if (kit.localizedUi?.length) itemData.localizedUi = kit.localizedUi;
        // Techniques: the same modus operandi (second level only, campaignRules.familyOnlyKinds)
        for (const t of kit.techniques ?? []) {
          const id = g.node("technique", t, TECHNIQUE_LABELS[t] ?? t, { technique: t });
          g.edge(finalUrlNode, id, "uses_technique", `technika strony: ${TECHNIQUE_LABELS[t] ?? t}`);
          add(id, "technique", [...finalPath, id], rel, `ta sama technika strony (${TECHNIQUE_LABELS[t] ?? t}): podobny sposób działania`);
          const list = (itemData.techniques as string[] | undefined) ?? [];
          if (!list.includes(t)) itemData.techniques = [...list, t];
        }
        if (kit.clickfix) itemData.clickfix = kit.clickfix;
        // Trojan in the lander kit (B-333): the attribute says which signals matched, the C2 host is a strong trace
        // (every copy of the same pulled kit reports to the same host)
        if (kit.stealerKit) {
          itemData.stealerKit = kit.stealerKit;
          for (const host of kit.stealerKit.c2Hosts) {
            const id = g.node("c2_host", host, `serwer C2 ${host}`, { signals: kit.stealerKit.signals });
            g.edge(finalUrlNode, id, "mentions", `skrypt zestawu stron wysyła ciasteczka lub dane logowania do ${host}`);
            add(id, "c2_host", [...finalPath, id], rel, `ten sam serwer C2 (${host}), do którego trojan w zestawie stron wysyła dane`);
          }
        }
      }
      // Infrastructure attributes of the landing page (they explain, they never link): the certificate, a brand in the
      // path of a domain without it, the shop platform, hosting outside the EU and the EEA
      if (page) {
        const finalHost = normalizeUrl(page.fetch.finalUrl)?.host;
        if (page.tls && finalHost) {
          const tls = tlsSignals(page.tls, finalHost, item.firstSeen);
          if (tls.issuer) itemData.certIssuer = tls.issuer;
          if (tls.certMismatch) itemData.certMismatch = true;
          if (tls.certExpired) itemData.certExpired = true;
        }
        const brand = brandInPath(page.fetch.finalUrl) ?? brandInPath(enr.landing.url);
        if (brand) itemData.brandInPath = brand;
        if (page.extract?.cms?.length) itemData.pagePlatforms = [...new Set([...((itemData.pagePlatforms as string[] | undefined) ?? []), ...page.extract.cms])].sort();
        const site = page.extract?.siteAttributes;
        if (site?.tldRare) itemData.tldRare = site.tldRare;
        if (site?.domainLangMismatch) itemData.domainLangMismatch = `domena: ${site.domainLangMismatch.domainLang}, strona: ${site.domainLangMismatch.pageLang}`;
        if (site?.privacyControllerMismatch) itemData.privacyControllerMismatch = site.privacyControllerMismatch.controllerDomains;
        if (site?.fakeCourierPayment) itemData.techniques = [...new Set([...((itemData.techniques as string[] | undefined) ?? []), "fake_courier_payment"])];
        const outside = hostingOutsideEu((finalHost ? (dataset.hosts[finalHost]?.ips ?? []) : []).map((ip) => dataset.ips[ip]?.country));
        if (outside) itemData.hostingOutsideEu = outside;
      }
      if (page?.cloaking) {
        itemData.cloakingSuspected = page.cloaking.suspected;
        if (page.cloaking.suspected) itemData.cloakingReasons = page.cloaking.reasons;
      }
      if (page) itemData.finalUrl = maskUrl(page.fetch.finalUrl);
    }

    // Click IDs that carry more than a token: the tracker server (xid) and the clicked Meta ad (fbclid)
    const landingPage = enr?.pageKey ? dataset.pages[enr.pageKey] : undefined;
    const clickIds = clickIdsFromUrls([item.landingUrl, ...(landingPage?.fetch.redirectChain.map((h) => h.url) ?? []), landingPage?.fetch.finalUrl, ...(landingPage?.kit?.requestClickUrls ?? [])]);
    // CTA links of the page (prelander → tracker → lander) carry the tracker's IDs too: a link, not a visit (B-154)
    const outboundUrls = landingPage?.extract?.outboundUrls ?? [];
    const outboundClicks = clickIdsFromUrls(outboundUrls);
    const machines = [...new Set([...clickIds.xids, ...outboundClicks.xids].map((x) => x.machine))];
    const scopedParams = new Set(config.kit.machineScopedParams ?? []);

    // Campaign parameters leaking into URLs (UTM, sub1-5, click/offer/campaign/ad/pixel IDs); those only in
    // the page's outbound links come with the outbound relation
    // the page's own form fields and script config carry the same IDs (origin form/script, I23)
    const paramKey = (cp: CampaignParam) => `${cp.canonicalName}=${cp.value.trim().toLowerCase()}`;
    const ownParams = new Set((enr?.campaignParams ?? []).map(paramKey));
    const pageParams = (landingPage?.kit?.pageParams ?? []).filter((cp) => !ownParams.has(paramKey(cp)));
    for (const cp of pageParams) ownParams.add(paramKey(cp));
    const linkParams = extractCampaignParams(outboundUrls).filter((cp) => !ownParams.has(paramKey(cp)));
    // Text traces that only describe (I25 step 4-5): a commented-out old version, a foreign insert, a foreign persona
    // in the ad name, typography, translation artifacts and the style of brand names. Never a pivot.
    {
      const kitTraits = landingPage?.kit;
      const textPage = landingPage?.extract;
      const residue = residueOf(kitTraits?.comments ?? []);
      if (residue) itemData.residue = { count: residue.count, sample: residue.sample };
      const nameParams: Array<[string, string]> = [...(enr?.campaignParams ?? []), ...pageParams, ...linkParams].map((cp) => [cp.canonicalName, cp.value]);
      const segments = foreignSegments({
        page: textPage?.visibleText,
        scripts: [...(kitTraits?.kitStrings ?? []).map((k) => k.text), ...(kitTraits?.templatePhrases ?? []).filter((p) => p.source === "script").map((p) => p.text)],
        comments: kitTraits?.comments,
        adParams: nameParams.filter(([n]) => n === "ad_name" || n === "adset_name" || n === "campaign_name").map(([, v]) => v),
      });
      if (segments.length) itemData.foreignSegments = segments;
      const persona = foreignPersona(nameParams);
      if (persona.length) itemData.foreignPersona = persona;
      const prose = [item.text, textPage?.visibleText].filter(Boolean).join("\n");
      const typo = typographyOf(prose);
      if (typo) itemData.typography = typo;
      const artifacts = translationArtifacts(prose, [enr?.ocrText, enr?.extraOcrText].filter(Boolean).join("\n"));
      if (artifacts) itemData.translationArtifacts = artifacts;
      const langErrors = languageErrors(segments, artifacts);
      if (langErrors) itemData.languageErrors = langErrors;
      const style = [advertiser, enr?.creativeBrand].map((n) => brandStyle(typeof n === "string" ? n : null)).find(Boolean);
      if (style) itemData.brandStyle = style;
      const nameKind = advertiserNameKind(advertiser);
      if (nameKind) itemData.advertiserNameKind = nameKind;
    }
    const perClick = new Set(config.lists.campaignParamPerClickNames ?? []);
    // Affiliate-network accounts (B-330): scoped to the network host, so a stream_id they carry is not also
    // counted as a global campaign_param
    const affStreams = linkAffiliateIds(g, add, itemNode, [
      ...(landingPage?.kit?.affiliateIds ?? []),
      ...affiliateIdsFromUrls([item.landingUrl, ...(landingPage?.fetch.redirectChain.map((h) => h.url) ?? []), landingPage?.fetch.finalUrl, ...outboundUrls]),
    ], new Set((landingPage?.kit?.crmKeys ?? []).map((k) => k.sha256)));
    // Meta access token (B-144): only the SHA-256 key is a node; the raw token never enters the graph
    const tokenKeys = new Set([
      ...(landingPage?.kit?.metaTokens ?? []),
      ...metaTokenKeysIn([item.landingUrl, ...(landingPage?.fetch.redirectChain.map((h) => h.url) ?? []), landingPage?.fetch.finalUrl, ...outboundUrls]),
    ]);
    for (const k of [...tokenKeys].sort()) {
      const id = g.node("meta_token", k, `token dostępu Meta (sha256 ${k}…)`, { sha256Prefix: k });
      g.edge(itemNode, id, "carries_param", `token dostępu Meta w adresie lub kodzie strony (sha256 ${k}…)`);
      add(id, "meta_token", [itemNode, id], 1, `ten sam token dostępu Meta (sha256 ${k}…)`);
    }
    const params = [...(enr?.campaignParams ?? []), ...pageParams].map((cp) => [cp, 1] as const);
    for (const [cp, relation] of [...params, ...linkParams.map((cp) => [cp, config.outboundParamFactor ?? 0.8] as const)]) {
      if (cp.cyrillic) itemData.cyrillic = true;
      if (mixedScriptName(cp.value)) itemData.namingMixedScript = true;
      // a value new for every click is shared only by one visit: no pivot between materials
      if (perClick.has(cp.canonicalName)) continue;
      if (cp.name.toLowerCase() === "stream_id" && affStreams.has(cp.value.trim().toLowerCase())) continue;
      const value = cp.value.trim();
      const origin = cp.origin === "form" ? " (z formularza)" : cp.origin === "script" ? " (ze skryptu strony)" : "";
      // An internal number of a tracker (campaign_id=319) names a campaign only on one tracker server:
      // every installation counts from 1, so with an xid the machine goes into the key.
      const scope = scopedParams.has(cp.canonicalName) && /^\d+$/.test(value) && machines.length ? machines : [null];
      for (const machine of scope) {
        const scoped = machine ? `${machine}/${value}` : value;
        const key = `${cp.canonicalName}=${scoped.toLowerCase()}`;
        const trackerCampaign = cp.canonicalName === "tracker_campaign" || machine !== null;
        const id = g.node("campaign_param", key, `${cp.canonicalName}=${scoped.length > 40 ? `${scoped.slice(0, 39)}…` : scoped}`, {
          canonicalName: cp.canonicalName,
          name: cp.name,
          value,
          cyrillic: cp.cyrillic,
          macro: cp.macro,
          sourceUrl: cp.sourceUrl,
          ...(cp.origin ? { origin: cp.origin } : {}),
          ...(machine ? { machine } : {}),
          ...(trackerCampaign ? { trackerCampaign: true } : {}),
        });
        const where = relation < 1 ? "linku wychodzącym strony" : cp.origin === "form" ? "ukrytym polu formularza strony" : cp.origin === "script" ? "skrypcie strony" : "URL";
        g.edge(itemNode, id, "carries_param", `parametr ${cp.name} w ${where} ${cp.sourceUrl}${machine ? ` (serwer trackera ${machine})` : ""}`);
        const what =
          cp.canonicalName === "tracker_campaign"
            ? `ten sam klucz kampanii w trackerze (${cp.name}=${value})`
            : machine
              ? `ta sama kampania na tym samym serwerze trackera (${cp.canonicalName}=${value}, maszyna ${machine})`
              : `ten sam parametr kampanii ${cp.canonicalName}=${value}${origin}`;
        add(id, "campaign_param", [itemNode, id], relation, relation < 1 ? `${what} (w linku wychodzącym strony)` : what);
      }
      // A Meta ad ID in the link's parameters (utm_content={{ad.id}}, ad_id=) is the same clicked ad as the
      // adid inside an fbclid: one meta_ad node for both (B-156)
      if (relation === 1 && META_AD_ID_PARAMS.has(cp.canonicalName) && /^\d{15,19}$/.test(value)) {
        const id = g.node("meta_ad", value, `reklama Meta ${value}`, { adId: value });
        g.edge(itemNode, id, "clicked_ad", `identyfikator reklamy Mety w parametrze ${cp.name} linku`);
        add(id, "meta_ad", [itemNode, id], 1, `ta sama reklama w Mecie (identyfikator ${value} z parametru ${cp.name})`);
      }
    }

    // Links of the landing-page platform (?cuuid=…&suuid=…&launcher=…) in the ad's own link, the address
    // bar (OCR), the page code or its requests: the same account and campaign nodes as window.aio, also
    // without the page code. launcher is owner_uuid, so it lands in the account space, not the tenant's.
    const linkIds = mergePlatformLinkIds(
      landingPage?.kit?.platformLinks,
      platformLinkIds([item.landingUrl, ...(landingPage?.fetch.redirectChain.map((h) => h.url) ?? []), landingPage?.fetch.finalUrl, ...(enr?.observedUrls ?? []).map((o) => o.url)]),
    );
    if (linkIds) {
      for (const owner of linkIds.ownerIds) {
        const id = g.node("platform_account", owner, `konto ${owner.slice(0, 8)}… na platformie stron`, { ownerId: owner, platform: "aio" });
        g.edge(itemNode, id, "built_on", `link platformy stron wskazuje konto (launcher=${owner}, ta sama wartość co owner_uuid)`);
        add(id, "platform_account", [itemNode, id], 1, `to samo konto na platformie stron (launcher = owner_uuid ${owner})`);
      }
      for (const c of linkIds.campaignIds) {
        const id = g.node("platform_campaign", c, `kampania ${c.slice(0, 8)}`, { campaignId: c });
        g.edge(itemNode, id, "built_on", `link platformy stron wskazuje kampanię (cuuid=${c})`);
        add(id, "platform_campaign", [itemNode, id], 1, `ta sama kampania na platformie stron (cuuid ${c})`);
      }
      if (linkIds.sourceIds.length) itemData.platformSourceIds = linkIds.sourceIds;
      // suuid of a showcase link is a lead-funnel trace too (B-332)
      for (const sid of linkIds.sourceIds) addLeadFlow(itemNode, [itemNode], `src:${sid}`, 1);
      if (linkIds.ownerIds.length && !itemData.platformAccount) {
        itemData.platformAccount = linkIds.ownerIds[0];
        itemData.platformAccountSource = "launcher";
      }
      itemData.landerPlatform ??= "aio";
    }

    for (const [x, relation] of [...clickIds.xids.map((x) => [x, 1] as const), ...outboundClicks.xids.map((x) => [x, config.outboundParamFactor ?? 0.8] as const)]) {
      // Keyed by the machine only: the "process ID" of this tracker product is one constant on many
      // installations (a trait of the platform, not of one server), so it stays a detail of the node.
      const prevPids = (g.nodes.get(nodeId("click_server", x.machine))?.data.pids as number[] | undefined) ?? [];
      const id = g.node("click_server", x.machine, `serwer trackera ${x.machine}`, { machine: x.machine, pids: [...new Set([...prevPids, x.pid])].sort((p, q) => p - q) });
      g.edge(itemNode, id, "routed_by", `identyfikator kliknięcia ${x.param}=${x.value} w formacie xid: wydany ${x.time}, maszyna ${x.machine}, proces ${x.pid} (stała instalacji platformy), licznik ${x.counter}`);
      add(id, "click_server", [itemNode, id], relation, `ten sam serwer trackera (clickid w formacie xid: maszyna ${x.machine}${relation < 1 ? ", w linku wychodzącym strony" : ""})`);
      if (relation === 1) {
        itemData.clickTime ??= x.time;
        itemData.clickCounter ??= x.counter;
      }
    }
    for (const f of clickIds.fbclids) {
      if (f.appId) itemData.metaAppId ??= f.appId;
      if (!f.adId) continue;
      itemData.metaAdId ??= f.adId;
      const id = g.node("meta_ad", f.adId, `reklama Meta ${f.adId}`, { adId: f.adId, appId: f.appId });
      g.edge(itemNode, id, "clicked_ad", `fbclid w linku zawiera identyfikator klikniętej reklamy ${f.adId}${f.appId ? ` (app_id ${f.appId})` : ""}`);
      add(id, "meta_ad", [itemNode, id], 1, `ta sama reklama w Mecie (identyfikator ${f.adId} odczytany z fbclid)`);
    }

    // Template of the tracking link (parameter names + value shapes): the traffic-distribution system
    const schema = paramSchema(item.landingUrl);
    const schemaPlatform = schema ? (config.lists.paramSchemaPlatformParts ?? []).find((r) => r.platform && schema.key.split("|").includes(r.match))?.platform : undefined;
    if (schemaPlatform) itemData.pagePlatforms = [...new Set([...((itemData.pagePlatforms as string[] | undefined) ?? []), schemaPlatform])].sort();
    if (schema) {
      const id = g.node("param_schema", schema.key, `szablon linku: ${schema.names.join(", ")}`, { schema: schema.key, names: schema.names });
      g.edge(itemNode, id, "follows_schema", "nazwy parametrów linku docelowego i rodzaj ich wartości");
      add(id, "param_schema", [itemNode, id], 1, `ten sam szablon linku śledzącego (${schema.names.join(", ")}; wartości losowe)`);
    }

    // Personas (impersonated people): weak signal, mainly for filtering and triage
    // One edge per persona; every way it was found is kept in the edge evidence ("; "-separated).
    const personaHows = new Map<string, { name: string; role: string | null; category: string | null; hows: string[] }>();
    for (const pm of enr?.personas ?? []) {
      const how = pm.source === "ingest" ? "z kolumny danych wejściowych" : pm.source === "ner" ? "z NER (model językowy)" : pm.source === "face" ? `z twarzy (podobna twarz${pm.similarity !== undefined ? `, ${pm.similarity.toFixed(2)}` : ""}; do przeglądu przez człowieka)` : pm.source === "voice" ? `z głosu (głos podobny do osoby${pm.similarity !== undefined ? `, ${pm.similarity.toFixed(2)}` : ""}; do przeglądu przez człowieka)` : pm.fuzzy ? "z OCR/ASR (dopasowanie przybliżone)" : "z listy obserwowanych nazwisk";
      const cur = personaHows.get(pm.id) ?? { name: pm.name, role: pm.role, category: pm.category ?? null, hows: [] };
      if (!cur.hows.includes(how)) cur.hows.push(how);
      cur.role ??= pm.role;
      cur.category ??= pm.category ?? null;
      personaHows.set(pm.id, cur);
    }
    for (const [pid, p] of personaHows) {
      const id = g.node("persona", pid, p.name, { name: p.name, role: p.role, ...(p.category ? { category: p.category } : {}) });
      g.edge(itemNode, id, "mentions_persona", `persona ${p.hows.join("; ")}`);
      add(id, "persona", [itemNode, id], 1, `ta sama persona: ${p.name}`);
    }
    // Group of the impersonated person ("podszywa się pod: dziennikarkę"): a trait of the group, only for entries that have one
    const personaCategories = [...personaHows.values()].filter((p) => p.category).map((p) => ({ name: p.name, category: p.category }));
    if (personaCategories.length) itemData.personaCategories = personaCategories;
    // The same set of people in one material (a fake conversation of two known persons) is rarer than one
    // person: a pivot of the persona type (group level only, familyOnlyKinds) with a higher base weight
    const personaIds = [...personaHows.keys()].sort();
    for (let i = 0; i < personaIds.length; i++) {
      for (let j = i + 1; j < personaIds.length; j++) {
        const [p, q] = [personaHows.get(personaIds[i])!, personaHows.get(personaIds[j])!];
        const id = g.node("persona", `pair:${personaIds[i]}+${personaIds[j]}`, `${p.name} + ${q.name}`, { pair: true, names: [p.name, q.name] });
        g.edge(itemNode, id, "mentions", `para osób w jednym materiale (${p.name}, ${q.name})`);
        add(id, "persona", [itemNode, id], 1, `ta sama para osób: ${p.name} i ${q.name}`);
      }
    }

    // Look-alike hosts, the weekday the ad started and the creation date of Discord ids (I28, P2): attributes, never traces
    const hostUrls = [item.landingUrl, ...(landingPage?.fetch.redirectChain.map((h) => h.url) ?? []), landingPage?.fetch.finalUrl, ...(enr?.observedUrls ?? []).map((o) => `https://${o.host}`), ...(landingPage?.extract?.outboundUrls ?? [])];
    const confusable = hostUrls.map((u) => (u ? idnConfusableInUrl(u) : null)).find((c) => c !== null);
    if (confusable) itemData.idnConfusable = confusable;
    const started = adStart(typeof itemData.adFirstShown === "string" ? itemData.adFirstShown : null);
    if (started) itemData.adStartWeekday = started;
    // A pressure counter ("N places left") in the creative's OCR or the ad text: a technique attribute (B-346)
    if (scarcityCounter([item.text, enr?.ocrText].filter(Boolean).join("\n"))) itemData.techniques = [...new Set([...((itemData.techniques as string[] | undefined) ?? []), "scarcity_counter"])];
    // Style of the folder name of the landing page and of the advertiser's page name (B-341, B-347): attributes, never traces
    const slugStyle = hostUrls.map((u) => { try { return u ? landerSlugStyle(new URL(u).pathname) : null; } catch { return null; } }).find((s) => s !== null);
    if (slugStyle) itemData.landerSlugStyle = slugStyle;
    const nameStyle = advertiserNameStyle(advertiser ?? enr?.adLibrary?.find((r) => r.pageName)?.pageName ?? null, item.text);
    if (nameStyle) itemData.advertiserNameStyle = nameStyle;
    // A title that is a bare infinitive ("Czytać") betrays machine translation (B-328): an attribute, never a trace
    const infinitive = infinitiveCta(item.extra.ad_title ?? item.extra.title);
    if (infinitive) { itemData.translationArtifacts = { ...((itemData.translationArtifacts as Record<string, number> | undefined) ?? {}), infinitive_cta: 1 }; itemData.infinitiveCta = infinitive; }
    const snowflakes = discordSnowflakes([item.text, enr?.ocrText, ...(landingPage?.extract?.outboundUrls ?? [])].filter(Boolean).join("\n"));
    if (snowflakes.length) itemData.discordSnowflakes = snowflakes;

    // Line type and country of the phone numbers (I28): offline metadata, an explanation of the number, never a weight
    const phones = [...new Set([...(enr?.text?.phones ?? []), ...(landingPage?.extract?.phones ?? [])])].slice(0, MAX_PHONE_LINES);
    if (phones.length) {
      const lines = phones.map(phoneLineInfo);
      itemData.phoneLines = lines;
      const flags = phoneLineFlags(lines, { market: PHONE_CONFIG.defaultMarket, securityAlert: ((itemData.techniques as string[] | undefined) ?? []).includes("fake_security_alert") });
      if (flags.phoneCountryMismatch) itemData.phoneCountryMismatch = true;
      if (flags.tollFreeOnAlert) itemData.tollFreeOnAlert = true;
    }

    // Narrative (topic, hook, IHC label): an attribute of the material and a trait of the group, never a pivot
    const pageEx = landingPage?.extract;
    if (!itemData.asSeenOn) {
      const pageSeenOn = asSeenOn(pageEx?.visibleText);
      if (pageSeenOn.length) itemData.asSeenOn = pageSeenOn;
    }
    const narrative = detectNarrative({
      headline: [pageEx?.title, pageEx?.ogTitle, item.text?.split("\n")[0]].filter(Boolean).join("\n"),
      body: [item.text, ui?.text, enr?.asrText ? stripHallucinations(enr.asrText) : null, enr?.videoOcrText, pageEx?.description, pageEx?.visibleText].filter(Boolean).join("\n"),
    });
    // The scam's own brand (product, "investment platform"): a page-kit trait, campaignRules.notAloneKinds
    const brandBody = [item.text, ui?.text, enr?.asrText ? stripHallucinations(enr.asrText) : null, enr?.videoOcrText, pageEx?.title, pageEx?.description, pageEx?.visibleText].filter(Boolean).join("\n");
    for (const b of scamBrands({ body: brandBody, landingName: typeof itemData.landingName === "string" ? itemData.landingName : null })) {
      const id = g.node("campaign_param", `scam_brand=${b.key}`, `marka oszustwa: ${b.name}`, { canonicalName: "scam_brand", name: "marka oszustwa", value: b.name, key: b.key, scamBrand: true, cyrillic: false, macro: false });
      g.edge(itemNode, id, "mentions", `nazwa produktu lub „platformy” w treści (${b.source})`);
      add(id, "campaign_param", [itemNode, id], 1, `ta sama marka oszustwa: ${b.name}`);
    }
    // A made-up expert ("dr Jan Testowy"): one operator invented the name, so the same name (or a typo of it) links (B-313)
    const experts = expertsOf.get(item.id) ?? [];
    for (const x of experts) {
      const key = expertCanon.get(x.key) ?? x.key;
      const id = g.node("fictional_expert", key, `${x.title === "prof" ? "prof." : "dr"} ${x.name}`, { title: x.title, name: x.name });
      g.edge(itemNode, id, "mentions", `ekspert „${x.name}” (${x.title === "prof" ? "prof." : "dr"}) spoza listy osób publicznych`);
      add(id, "fictional_expert", [itemNode, id], 1, `ten sam zmyślony ekspert: ${x.title === "prof" ? "prof." : "dr"} ${x.name}`);
    }
    if (experts.length) itemData.fictionalExperts = experts.map((x) => `${x.title === "prof" ? "prof." : "dr"} ${x.name}`);
    // Company identifiers and bank accounts of the page and of the screenshots: a trace that only supports a link
    // (campaignRules.notAloneKinds), since a firm's data can be copied; a made-up number still ties the pages that share it
    const { companyIds, legalEntities, companyIdInvalid, notes: companyNotes } = companyIdsOfMaterial(pageEx, [enr?.ocrText, enr?.extraOcrText].filter(Boolean).join("\n"));
    if (companyIds.length) itemData.companyIds = companyIds;
    if (legalEntities.length) itemData.legalEntities = legalEntities;
    if (companyIdInvalid) itemData.companyIdInvalid = true;
    if (companyNotes.length) itemData.companyIdNotes = companyNotes;
    for (const c of companyIds) {
      const isAccount = c.kind === "iban" || c.kind === "nrb";
      // an account number with a wrong mod-97 sum is a typo or a made-up number, not a payment pivot (B-168); it stays a feature of the material
      if (isAccount && !c.valid) continue;
      const type = isAccount ? "bank_account" : "company_id";
      const key = isAccount ? c.value : `${c.kind}:${c.value}`;
      const label = isAccount ? `rachunek ${c.value.slice(0, 4)}…${c.value.slice(-4)}` : `${c.kind.toUpperCase()} ${c.value}`;
      const id = g.node(type, key, label, { kind: c.kind, value: c.value, valid: c.valid, check: c.check });
      g.edge(itemNode, id, "mentions", `${isAccount ? "rachunek bankowy" : "identyfikator firmy"} na ${c.source === "ocr" ? "zrzucie ekranu (OCR)" : "stronie"}${c.valid ? "" : " (nie przechodzi sprawdzenia)"}`);
      add(id, type, [itemNode, id], 1, isAccount ? `ten sam rachunek bankowy ${c.value}` : `ten sam identyfikator firmy ${c.kind.toUpperCase()} ${c.value}`);
    }
    // Shop signals (legal pages, discounts, payments, reviews ...) and contact data of the landing page: attributes
    // of the material that explain why it looks like a fake shop, never a trace. The one exception is a full postal
    // address (postal_address, campaignRules.notAloneKinds): an address copied from another shop's footer links.
    if (pageEx?.shopSignals) {
      const shop = applyShopContext(pageEx.shopSignals, { firstSeen: item.firstSeen });
      itemData.shopSignals = shop;
      if (shop.techniques.length) itemData.techniques = [...new Set([...((itemData.techniques as string[] | undefined) ?? []), ...shop.techniques])];
    }
    // Company registers (opt-in `--company-registry`): what the VAT white list and KRS say about the page's NIP / KRS,
    // and flags where the page differs (name, address, removal, age vs the domain): attributes, never a trace
    if (enr?.companyRegistry?.some((r) => r.found || r.error)) {
      const shop = pageEx?.shopSignals ? applyShopContext(pageEx.shopSignals, { firstSeen: item.firstSeen }) : null;
      const finalDom = landingPage?.fetch.finalUrl ? registrableDomain(landingPage.fetch.finalUrl) : null;
      const assessment = evaluateCompanyRegistry(enr.companyRegistry, {
        brandNames: [...legalEntities, shop?.footerBrand ?? ""].filter(Boolean),
        pageAddresses: (pageEx?.contact?.address.addresses ?? []).map((a) => ({ street: a.street, number: a.number, postalCode: a.postalCode })),
        firstSeen: item.firstSeen,
        domainCreated: finalDom ? dataset.domains[finalDom]?.rdap?.created : null,
      });
      itemData.companyRegistry = { records: enr.companyRegistry.map((r) => ({ source: r.source, id: r.id, found: r.found, name: r.name, address: r.address, status: r.status, registeredAt: r.registeredAt, removedAt: r.removedAt, error: r.error })), ...assessment };
    }
    const contact = pageEx?.contact;
    if (contact) {
      if (contact.emailDomains.length) itemData.emailDomainKinds = Object.fromEntries(contact.emailDomains.map((e) => [e.email, e.kind]));
      if (contact.address.completeness !== "none") itemData.addressCompleteness = contact.address.completeness;
      if (contact.phoneAreaMismatch) itemData.phoneAreaMismatch = contact.phoneAreaMismatch;
      for (const a of contact.address.addresses) {
        const id = g.node("postal_address", a.key, `${a.street} ${a.number}, ${a.postalCode} ${a.city}`, { street: a.street, number: a.number, flat: a.flat, postalCode: a.postalCode, city: a.city });
        g.edge(itemNode, id, "mentions", "adres siedziby na stronie sklepu");
        add(id, "postal_address", [itemNode, id], 1, `ten sam adres: ${a.street} ${a.number}, ${a.postalCode} ${a.city}`);
      }
      // the domain of a contact address other than the shop's is linked like any domain the page points to
      const deadContactDomains = contact.otherEmailDomains.filter((d) => dataset.domains[d]?.contactDomainDead);
      if (deadContactDomains.length) itemData.contactDomainDead = deadContactDomains;
      for (const d of contact.otherEmailDomains) {
        const disc = discounter.domainDiscount(d);
        if (disc && disc.factor === 0) continue;
        const id = g.node("domain", d, d, { registrableDomain: d });
        g.edge(itemNode, id, "links_to", "domena adresu e-mail kontaktowego (inna niż domena sklepu)");
        add(id, "domain", [itemNode, id], config.outboundLinkFactor, `adres e-mail na domenie ${d}`);
      }
    }
    if (enr?.creativeBrand) itemData.creativeBrand = enr.creativeBrand;
    if (enr?.aiImageMeta) itemData.aiImageMeta = `${enr.aiImageMeta.marker}: ${enr.aiImageMeta.detail}`;
    // fake "live stream" recorded by yt-dlp (B-301): the ad is a recording that was or is a live broadcast
    if (/^(was_live|is_live|true)$/i.test(item.extra?.live_status ?? "")) itemData.liveStream = true;
    // Profit claims (amount + period) of the copy, OCR, transcript and page: an attribute, and a trace of the
    // scheme's script for groups only (campaignRules.familyOnlyKinds); standard deposits stay out of the key (I23)
    const claims = profitClaims(brandBody);
    if (claims.length) {
      itemData.profitClaims = claims.map(({ amount, currency, period, quote }) => ({ amount, currency, period, quote }));
      const key = profitClaimKey(claims);
      if (key) {
        const id = g.node("profit_claim", key, `obiecywany zysk ${key.replaceAll("|", ", ")}`, { pairs: key.split("|") });
        g.edge(itemNode, id, "mentions", `kwoty zysku w treści (${claims.filter((c) => !c.standard).map((c) => c.quote).join("; ")})`);
        add(id, "profit_claim", [itemNode, id], 1, `te same kwoty obiecywanego zysku (${key.replaceAll("|", ", ")})`);
      }
    }
    if (narrative) {
      const label = celebBaitLabel(narrative, { persona: personaHows.size > 0, fakeMedia: !!(itemData.impersonatedBrand || itemData.advertiserImpersonates || enr?.creativeBrand) });
      const stored: MaterialNarrative = { ...narrative, date: item.firstSeen, ...(label ? { label } : {}) };
      itemData.narrative = stored;
    }
    // A "doctor" with a title and a name that is not on the list of public figures, in a health ad (B-300):
    // an attribute for the reviewer ("probably an invented doctor"), never a pivot.
    if (narrative?.topics.some((t) => t.id === "health")) {
      const experts = detectFictionalExperts(brandBody, [...publicPersonsForExperts(), ...personaHows.values()]);
      if (experts.length) itemData.fictionalExpert = experts.map((e) => `${e.title} ${e.name}`);
    }
    // Register check (B-314, opt-in plugin): a label only, it changes no weight
    const unregistered = enr?.expertChecks?.filter((c) => !c.registered).map((c) => c.name);
    if (unregistered?.length) itemData.expertNotInRegister = unregistered;
    // Investment ad from an account named like a guest house or a person: most likely a taken-over account
    // paid with a victim's card (I23). The name is the victim's, so it links nothing; the library account
    // ID, when known, stays (the operator controls that account while the ads run).
    const mismatch = advertiserMismatch(advertiser, !!narrative?.topics.some((t) => DEFAULT_NARRATIVE_CONFIG.financialTopics.includes(t.id)));
    if (mismatch) {
      itemData.advertiserMismatch = true;
      itemData.advertiserMismatchKind = mismatch.kind;
      const drop = facts.findIndex((f) => f.pivot === advertiserNamePivot);
      if (drop >= 0) facts.splice(drop, 1);
    }

    // The domain shown in the creative against the page the ad leads to (I28): an attribute, never a trace
    const chainDomains = [item.landingUrl, ...(landingPage?.fetch.redirectChain.map((h) => h.url) ?? []), landingPage?.fetch.finalUrl]
      .map((u) => (u ? registrableDomain(u) : null))
      .filter((d): d is string => !!d);
    const shownDomain = displayedDomainMismatch({
      ocr: ui?.text ?? null,
      text: item.text,
      barDomains: (enr?.observedUrls ?? []).map((o) => registrableDomain(o.host)).filter((d): d is string => !!d),
      landing: chainDomains,
    });
    if (shownDomain) {
      itemData.displayedDomainMismatch = { displayed: shownDomain.displayed, landing: shownDomain.landing, source: shownDomain.source, confidence: shownDomain.confidence };
      if (shownDomain.displayedBrandDomain) itemData.displayedBrandDomain = true;
    }

    // Addresses seen in the browser address bar of screenshots and recordings
    const observedUrls = enr?.observedUrls ?? [];
    if (observedUrls.length) {
      itemData.observedUrls = [
        ...new Set(observedUrls.map((o) => `${o.host}${o.frameTime !== undefined ? ` (nagranie ${o.frameTime} s)` : ""}${o.platform ? " (strona platformy)" : ""}`)),
      ];
      const inApp = observedUrls.find((o) => o.inAppBrowser)?.inAppBrowser;
      if (inApp) itemData.inAppBrowser = inApp;
    }
    if (enr?.landingSource) itemData.landingSource = enr.landingSource;
    if (enr?.landing?.fragment && !enr.landing.fragment.startsWith("capture=")) itemData.landingFragment = enr.landing.fragment;
    for (const o of observedUrls) {
      if (o.platform) continue;
      if (enr?.landing && normalizeUrl(o.url)?.host === enr.landing.host) continue; // the landing page itself
      const urlNode = addUrlInfra(o.url, [itemNode], 1);
      if (urlNode) {
        if (o.source === "qr_code") {
          g.edge(itemNode, urlNode, "mentions", "adres zakodowany w kodzie QR na zrzucie");
          continue;
        }
        const where = o.source === "address_bar_video" ? `nagraniu ekranu (${o.frameTime} s)` : "zrzucie ekranu";
        g.edge(itemNode, urlNode, "mentions", `adres w pasku przeglądarki na ${where}${o.inAppBrowser ? `, przeglądarka w aplikacji ${o.inAppBrowser}` : ""}`);
      }
    }

    // Targets of platform redirect wrappers (l.facebook.com/l.php?u=, google.com/url?q=, adurl=) in the link, the
    // redirect chain, the address bar and the copy: the platform's own domain weighs nothing, its target does
    const wrapped = [item.landingUrl, ...(landingPage?.fetch.redirectChain.map((h) => h.url) ?? []), ...observedUrls.map((o) => o.url), ...(enr?.text?.urls ?? [])];
    for (const target of new Set(wrapped.map((u) => (u ? unwrapPlatformUrl(u) : null)).filter((u): u is string => !!u))) {
      if (enr?.landing && normalizeUrl(target)?.host === normalizeUrl(landingPage?.fetch.finalUrl ?? "")?.host) continue;
      const urlNode = addUrlInfra(target, [itemNode], 1);
      if (urlNode) g.edge(itemNode, urlNode, "mentions", "adres docelowy z linku-opakowania platformy (przekierowanie serwisu)");
    }

    // URLs mentioned in the ad copy (other than the landing URL)
    for (const u of enr?.text?.urls ?? []) {
      if (enr?.landing && normalizeUrl(u)?.url === enr.landing.url) continue;
      const urlNode = addUrlInfra(u, [itemNode], 1);
      if (urlNode) g.edge(itemNode, urlNode, "mentions", "URL w treści reklamy");
    }

    factsByItem.set(item.id, dedupeFacts(facts));
  }

  addRegistrationBursts(dataset, g, factsByItem, config);
  annotateAdCreated(g);

  // Document frequency and weights
  const pivotItems = new Map<string, Array<{ itemId: string; fact: Fact }>>();
  for (const [itemId, facts] of factsByItem) {
    for (const fact of facts) {
      const list = pivotItems.get(fact.pivot) ?? [];
      list.push({ itemId, fact });
      pivotItems.set(fact.pivot, list);
    }
  }
  const blocks = [...g.nodes.values()].filter((nd) => nd.type === "comment_block");
  const nameFactors = config.commentBlockNames ? commentNameFactors(Object.fromEntries(blocks.map((nd) => [nd.id, (nd.data.authors as string[] | undefined) ?? []])), config.commentBlockNames) : new Map<string, number>();
  for (const node of g.nodes.values()) {
    if (node.type === "item") continue;
    node.df = pivotItems.get(node.id)?.length ?? 0;
    node.discounts = discounter.discountsFor({ type: node.type, key: node.key, id: node.id, data: node.data });
    const nameFactor = nameFactors.get(node.id) ?? 1;
    if (nameFactor < 1) node.discounts.push({ reason: "pospolite imiona w bloku komentarzy (częste w blokach innych stron)", factor: nameFactor, rule: "comment_names" });
    const base = node.data.burst
      ? config.registrationBurstWeight
      : node.data.exactFile
        ? (config.creativeFileWeight ?? 0.95)
        : node.data.trackerCampaign
          ? (config.trackerCampaignWeight ?? config.typeWeights.campaign_param)
          : node.data.pair
            ? (config.personaPairWeight ?? config.typeWeights.persona)
            : node.data.scamBrand
              ? (config.scamBrandWeight ?? config.typeWeights.campaign_param)
              : node.data.trackerHost
                ? (config.trackerHostWeight ?? config.typeWeights.endpoint)
              : node.type === "tracker" && node.data.kind === "adsense"
              ? (config.adsensePublisherWeight ?? config.typeWeights.tracker)
              : node.type === "tracker" && String(node.data.kind ?? "").endsWith("verification")
              ? (config.verificationTokenWeight ?? config.typeWeights.tracker)
              : undefined;
    const w = pivotWeight(node.type, node.discounts, node.df, n, config, base);
    node.weight = round(w.weight);
    // the same creative file joins by the campaign rules, not by union-find: a platform-account conflict wins over it
    node.strong = w.strong && !node.data.exactFile;
    node.data.weightParts = { base: w.base, listFactor: w.listFactor, idf: round(w.idf), ubiquity: round(w.ubiquity) };
  }

  // Infrastructure of each ad (addresses, hosting, backends, platform records, identifiers): decides
  // whether content similarity may join it (campaignRules.contentKinds)
  const infraKinds = new Set(config.campaignRules.infrastructureKinds ?? []);
  const infraMin = config.campaignRules.infrastructureMinWeight ?? 0.3;
  for (const [itemId, facts] of factsByItem) {
    const types = new Set<string>();
    for (const f of facts) {
      if (!infraKinds.has(f.type)) continue;
      const node = g.nodes.get(f.pivot);
      if (node?.data.scamBrand) continue; // a name in the copy, not infrastructure
      const parts = node?.data.weightParts as { base: number; listFactor: number } | undefined;
      if (parts && parts.base * parts.listFactor * f.relation >= infraMin) types.add(f.type);
    }
    g.nodes.get(nodeId("item", itemId))!.data.infrastructure = [...types].sort();
  }

  // Pair evidence from shared pivots
  const pairs = new Map<string, PairEvidence[]>();
  const pushPair = (a: string, b: string, ev: PairEvidence) => {
    const [x, y] = a < b ? [a, b] : [b, a];
    const key = `${x}\u0000${y}`;
    const list = pairs.get(key) ?? [];
    list.push(ev);
    pairs.set(key, list);
  };
  const pivotsOf = new Map<string, Set<string>>();
  for (const [itemId, facts] of factsByItem) pivotsOf.set(itemId, new Set(facts.map((f) => f.pivot)));
  /** Shared kit messages of each pair (I25): one premise per pair, see kitStringPremise. */
  const kitPairs = new Map<string, KitPairShare[]>();
  for (const [pivot, holders] of pivotItems) {
    if (holders.length < 2 || holders.length > config.maxPivotDf) continue;
    const node = g.nodes.get(pivot)!;
    if (!node.weight || node.weight <= 0) continue;
    if (node.type === "kit_string") {
      for (let i = 0; i < holders.length; i++) {
        for (let j = i + 1; j < holders.length; j++) {
          const [A, B] = holders[i].itemId < holders[j].itemId ? [holders[i], holders[j]] : [holders[j], holders[i]];
          if (A.itemId === B.itemId) continue;
          const key = `${A.itemId}\u0000${B.itemId}`;
          const list = kitPairs.get(key) ?? [];
          list.push({ pivot, words: Number(node.data.words ?? 0), weight: node.weight * Math.min(A.fact.relation, B.fact.relation), text: String(node.data.text ?? ""), pathA: A.fact.path, pathB: B.fact.path });
          kitPairs.set(key, list);
        }
      }
      continue;
    }
    // The TLD-agnostic template ("T.*") only adds evidence for pairs that do not already share a
    // TLD-specific variant of the same template ("T.sbs").
    const specificPrefix = node.type === "domain_pattern" && node.data.agnostic === true ? `${pivot.slice(0, -1)}` : null;
    const sharesSpecific = (a: string, b: string) => {
      if (!specificPrefix) return false;
      const mine = [...(pivotsOf.get(a) ?? [])].filter((p) => p.startsWith(specificPrefix) && p !== pivot);
      return mine.some((p) => pivotsOf.get(b)?.has(p));
    };
    const discountText = node.discounts.length
      ? ` — zdyskontowane: ${node.discounts.map((d) => `${d.reason} (×${d.factor})`).join("; ")}`
      : "";
    for (let i = 0; i < holders.length; i++) {
      for (let j = i + 1; j < holders.length; j++) {
        const A = holders[i];
        const B = holders[j];
        if (A.itemId === B.itemId) continue;
        if (sharesSpecific(A.itemId, B.itemId)) continue;
        const rel = Math.min(A.fact.relation, B.fact.relation);
        const weight = node.weight * rel;
        const how = A.fact.relation <= B.fact.relation ? A.fact.how : B.fact.how;
        const [first, second] = A.itemId < B.itemId ? [A, B] : [B, A];
        pushPair(A.itemId, B.itemId, {
          kind: "pivot",
          pivot,
          pivotType: node.type,
          edgeType: null,
          weight: round(weight),
          strong: node.strong && rel >= 1,
          discounted: node.discounts.length > 0 || rel < 1,
          evidence: `${how}${discountText}${rel < 1 ? ` (relacja pośrednia ×${round(rel)})` : ""}`,
          pathA: first.fact.path,
          pathB: second.fact.path,
        });
      }
    }
  }

  for (const [key, shared] of kitPairs) {
    const ev = kitStringPremise(shared, config.kitString);
    if (!ev) continue;
    const [a, b] = key.split("\u0000");
    pushPair(a, b, ev);
  }

  // Image similarity (near-duplicates; exact duplicates are covered by the imagehash pivot)
  const withImage = items.filter((it) => dataset.perItem[it.id]?.image && !libraryViews.has(it.id));
  const thr = config.similarity.imageHamming;
  for (let i = 0; i < withImage.length; i++) {
    for (let j = i + 1; j < withImage.length; j++) {
      const a = dataset.perItem[withImage[i].id].image!;
      const b = dataset.perItem[withImage[j].id].image!;
      const d = hammingDistance(a.dhash, b.dhash);
      if (d === 0 || d > thr) continue;
      const weight = config.similarity.imageWeight * (1 - (0.5 * d) / Math.max(1, thr));
      const ev = `prawie identyczna kreacja (dHash, odległość Hamminga ${d}/64)`;
      pushPair(withImage[i].id, withImage[j].id, simEvidence("similar_image", weight, ev, 1 - d / 64));
      g.edge(nodeId("item", withImage[i].id), nodeId("item", withImage[j].id), "similar_image", ev, round(weight));
    }
  }

  // Shared video shots (B-329): the same recording or AI insert cut into another montage; the frame-mean CLIP misses it
  const withShots = items.filter((it) => (dataset.perItem[it.id]?.videoShots?.length ?? 0) > 0 && !libraryViews.has(it.id));
  for (let i = 0; i < withShots.length; i++) {
    for (let j = i + 1; j < withShots.length; j++) {
      const { count, best } = sharedShots(dataset.perItem[withShots[i].id].videoShots!, dataset.perItem[withShots[j].id].videoShots!);
      if (!count) continue;
      const weight = config.similarity.imageWeight * (1 - (0.5 * best) / Math.max(1, SHOT_HAMMING));
      const ev = `to samo ujęcie wideo w innym montażu (${count} wspólnych ujęć, dHash, odległość Hamminga ${best}/64)`;
      pushPair(withShots[i].id, withShots[j].id, simEvidence("similar_image", weight, ev, 1 - best / 64));
      g.edge(nodeId("item", withShots[i].id), nodeId("item", withShots[j].id), "similar_image", ev, round(weight));
    }
  }

  // Semantic image similarity (CLIP; opt-in): variants of one creative template that dHash misses
  // Video creatives use the frame-mean embedding, images the image embedding; both live in one CLIP space.
  const creativeEmb = (id: string) => {
    const e = dataset.perItem[id];
    return e?.videoEmbedding?.length ? { v: e.videoEmbedding, video: true } : e?.imageEmbedding?.length ? { v: e.imageEmbedding, video: false } : null;
  };
  const withEmb = items.filter((it) => creativeEmb(it.id) !== null && !libraryViews.has(it.id));
  const sem = config.similarity.imageSemantic;
  for (let i = 0; i < withEmb.length; i++) {
    for (let j = i + 1; j < withEmb.length; j++) {
      const ea = dataset.perItem[withEmb[i].id];
      const eb = dataset.perItem[withEmb[j].id];
      if (ea.image && eb.image && hammingDistance(ea.image.dhash, eb.image.dhash) <= thr) continue; // already a (near-)duplicate
      const ca = creativeEmb(withEmb[i].id)!;
      const cb = creativeEmb(withEmb[j].id)!;
      const c = cosineDense(ca.v, cb.v);
      if (c < sem.minCosine) continue;
      const weight = sem.weight * (0.5 + (0.5 * (c - sem.minCosine)) / Math.max(1e-9, 1 - sem.minCosine));
      const ev = `ten sam szablon kreacji (CLIP${ca.video || cb.video ? ", klatki wideo" : ""}, cosinus ${c.toFixed(2)})`;
      pushPair(withEmb[i].id, withEmb[j].id, simEvidence("similar_image_semantic", weight, ev, c));
      g.edge(nodeId("item", withEmb[i].id), nodeId("item", withEmb[j].id), "similar_image_semantic", ev, round(weight));
    }
  }

  // DOM structure similarity of landing pages (page kit reused on different domains)
  const finalUrlOf = (it: Item) => {
    const enr = dataset.perItem[it.id];
    return enr?.pageKey ? (dataset.pages[enr.pageKey]?.fetch.finalUrl ?? null) : null;
  };
  const withDom = items.filter((it) => typeof g.nodes.get(nodeId("item", it.id))?.data.domSimhash === "string");
  const domThr = config.similarity.dom.hamming;
  for (let i = 0; i < withDom.length; i++) {
    for (let j = i + 1; j < withDom.length; j++) {
      const fa = finalUrlOf(withDom[i]);
      if (fa && fa === finalUrlOf(withDom[j])) continue; // same page: already linked by URL/host
      const a = String(g.nodes.get(nodeId("item", withDom[i].id))!.data.domSimhash);
      const b = String(g.nodes.get(nodeId("item", withDom[j].id))!.data.domSimhash);
      const d = simhashDistance(a, b);
      if (d > domThr) continue;
      const weight = config.similarity.dom.weight * (1 - (0.5 * d) / Math.max(1, domThr));
      const ev = `ta sama struktura strony docelowej (simhash DOM, odległość ${d}/64)`;
      pushPair(withDom[i].id, withDom[j].id, simEvidence("similar_dom", weight, ev, 1 - d / 64));
      g.edge(nodeId("item", withDom[i].id), nodeId("item", withDom[j].id), "similar_dom", ev, round(weight));
    }
  }

  // Audio fingerprint similarity (same voice-over or music track; opt-in enrichment)
  const withAudio = items.filter((it) => (dataset.perItem[it.id]?.audioFp?.fingerprint.length ?? 0) > 0);
  for (let i = 0; i < withAudio.length; i++) {
    for (let j = i + 1; j < withAudio.length; j++) {
      const sim = fingerprintSimilarity(dataset.perItem[withAudio[i].id].audioFp!.fingerprint, dataset.perItem[withAudio[j].id].audioFp!.fingerprint);
      if (sim < config.similarity.audio.minSimilarity) continue;
      const span = Math.max(1e-9, 1 - config.similarity.audio.minSimilarity);
      const weight = config.similarity.audio.weight * (0.5 + (0.5 * (sim - config.similarity.audio.minSimilarity)) / span);
      const ev = `ta sama ścieżka dźwiękowa (Chromaprint, podobieństwo ${sim.toFixed(2)})`;
      pushPair(withAudio[i].id, withAudio[j].id, simEvidence("similar_audio", weight, ev, sim));
      g.edge(nodeId("item", withAudio[i].id), nodeId("item", withAudio[j].id), "similar_audio", ev, round(weight));
    }
  }

  // Speaker similarity (SpeechBrain ECAPA; opt-in): the same voice, also in a different recording.
  // A cloned voice of one public figure matches across unrelated operators, so it never links alone.
  const withVoice = items.filter((it) => (dataset.perItem[it.id]?.speakerEmbedding?.length ?? 0) > 0);
  const voice = config.similarity.voice;
  for (let i = 0; i < withVoice.length; i++) {
    for (let j = i + 1; j < withVoice.length; j++) {
      const ea = dataset.perItem[withVoice[i].id];
      const eb = dataset.perItem[withVoice[j].id];
      if (ea.audioFp?.fingerprint.length && eb.audioFp?.fingerprint.length && fingerprintSimilarity(ea.audioFp.fingerprint, eb.audioFp.fingerprint) >= config.similarity.audio.minSimilarity) continue; // same recording: similar_audio covers it
      const c = speakerSimilarity(ea.speakerEmbedding!, eb.speakerEmbedding!);
      if (c < voice.minCosine) continue;
      const weight = voice.weight * (0.5 + (0.5 * (c - voice.minCosine)) / Math.max(1e-9, 1 - voice.minCosine));
      const ev = `ten sam głos mówcy (SpeechBrain ECAPA, cosinus ${c.toFixed(2)}; także sklonowany głos tej samej osoby)`;
      pushPair(withVoice[i].id, withVoice[j].id, simEvidence("similar_voice", weight, ev, c));
      g.edge(nodeId("item", withVoice[i].id), nodeId("item", withVoice[j].id), "similar_voice", ev, round(weight));
    }
  }

  // Text similarity
  const textMethod = options.textMethod ?? (options.embeddings ? "embedding" : "tfidf");
  if (textMethod !== "none") {
    const texts = items.map((it) => textOf(it, dataset));
    const eligible = items
      .map((it, idx) => ({ it, idx }))
      .filter(({ idx }) => texts[idx].length >= config.similarity.text.minChars);
    let sim: (i: number, j: number) => number;
    let threshold: number;
    if (textMethod === "embedding" && options.embeddings) {
      const emb = options.embeddings;
      sim = (i, j) => {
        const a = emb[items[i].id];
        const b = emb[items[j].id];
        return a && b ? cosineDense(a, b) : 0;
      };
      threshold = config.similarity.text.embeddingThreshold;
    } else {
      const model = fitTfidf(texts);
      const vecs: SparseVector[] = texts.map((t) => model.transform(t));
      sim = (i, j) => cosineSparse(vecs[i], vecs[j]);
      threshold = config.similarity.text.tfidfThreshold;
    }
    for (let x = 0; x < eligible.length; x++) {
      for (let y = x + 1; y < eligible.length; y++) {
        const i = eligible[x].idx;
        const j = eligible[y].idx;
        const c = sim(i, j);
        if (c < threshold) continue;
        const weight = config.similarity.text.weight * (0.5 + (0.5 * (c - threshold)) / Math.max(1e-9, 1 - threshold));
        const ev = `podobna treść reklamy (cosinus ${c.toFixed(2)}, ${textMethod === "embedding" ? "embeddingi" : "TF-IDF n-gramów"})`;
        pushPair(items[i].id, items[j].id, simEvidence("similar_text", weight, ev, c));
        g.edge(nodeId("item", items[i].id), nodeId("item", items[j].id), "similar_text", ev, round(weight));
      }
    }
  }

  // Aggregate pair evidence into links
  const links: ItemLink[] = [];
  for (const [key, evidence] of pairs) {
    const [a, b] = key.split("\u0000");
    evidence.sort((x, y) => y.weight - x.weight);
    const score = combineScores(evidence.map((e) => e.weight));
    const strong = evidence.some((e) => e.strong);
    if (score < 0.05 && !strong) continue; // keep the graph light: only negligible (discounted) pairs are dropped
    links.push({ a, b, score: round(score), strong, evidence });
  }
  links.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));

  // last line of defence (B-144): a raw Meta token in any string of the graph (a URL kept in item data, a redirect chain) is masked
  const nodes = maskTokensDeep([...g.nodes.values()].sort((x, y) => x.id.localeCompare(y.id)));
  const edges = maskTokensDeep([...g.edges.values()].sort((x, y) => x.id.localeCompare(y.id)));
  const byType: Partial<Record<EntityType, number>> = {};
  for (const t of ENTITY_TYPES) {
    const c = nodes.filter((nd) => nd.type === t).length;
    if (c) byType[t] = c;
  }
  return {
    version: 1,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    mode: dataset.mode,
    baseDir: dataset.baseDir,
    textMethod: textMethod === "embedding" && !options.embeddings ? "tfidf" : textMethod,
    stats: {
      items: n,
      nodes: nodes.length,
      edges: edges.length,
      links: links.length,
      strongLinks: links.filter((l) => l.strong).length,
      byType,
    },
    nodes,
    edges,
    links: maskTokensDeep(links),
    ...(options.includeItemPivots ? { itemPivots: Object.fromEntries(factsByItem) } : {}),
  };
}

/** Where a text key (template sentence, kit message) was seen: registrable domains, platform accounts, pages. */
interface TextSpread {
  domains: Set<string>;
  accounts: Set<string>;
  pages: Set<string>;
}

/** Records one page carrying a text key in `spread` (`account` null: page outside a known platform account). */
function spreadAdd(spread: Map<string, TextSpread>, key: string, domain: string, account: string | null, pageKey: string): void {
  const sp = spread.get(key) ?? { domains: new Set<string>(), accounts: new Set<string>(), pages: new Set<string>() };
  sp.domains.add(domain);
  if (account) sp.accounts.add(account);
  sp.pages.add(pageKey);
  spread.set(key, sp);
}

/**
 * Account of the page on a landing-page platform: owner_uuid of the embedded config, else the launcher of
 * its links, else its landing-cdn tenant; null when the page shows none.
 */
function pageAccountOf(kit: NonNullable<EnrichedDataset["pages"][string]["kit"]>): string | null {
  return kit.lander?.ownerId ?? kit.platformLinks?.ownerIds[0] ?? kit.platformTenants?.[0] ?? null;
}

/**
 * Whether text seen on these pages is the platform's own (I25, config.textBoilerplate): carried by pages of
 * at least `minPlatformAccounts` accounts (the SDK reaches every account, a text kit a few buyers), or by
 * at least `maxPageShare` of the `totalPages` pages of the batch (from `minPages` pages on). null: no mask.
 */
function isPlatformText(sp: TextSpread, totalPages: number, tb: LinkConfig["textBoilerplate"]): boolean {
  if (!tb) return false;
  if (sp.accounts.size >= tb.minPlatformAccounts) return true;
  return totalPages >= tb.minPages && sp.pages.size / totalPages >= tb.maxPageShare;
}

/** One kit message shared by a pair of pages: its node, word count, pivot weight (after IDF) and paths. */
interface KitPairShare {
  pivot: string;
  words: number;
  weight: number;
  text: string;
  pathA: string[];
  pathB: string[];
}

/**
 * The single kit_string premise of a pair of pages (I25), or null: the pair shares at least `minShared`
 * messages, or one of at least `longWords` words; a single short log line ("Loading done!") can be a
 * coincidence, a set of them or a long one is the same file. Weighted by the rarest shared message (its
 * IDF already applied), so ten shared lines do not count ten times.
 */
function kitStringPremise(shared: KitPairShare[], cfg: LinkConfig["kitString"]): PairEvidence | null {
  if (!cfg || !shared.length) return null;
  if (shared.length < cfg.minShared && !shared.some((s) => s.words >= cfg.longWords)) return null;
  const best = [...shared].sort((x, y) => y.weight - x.weight)[0];
  const quotes = shared.slice(0, 3).map((s) => `„${s.text.length > 50 ? `${s.text.slice(0, 49)}…` : s.text}”`).join(", ");
  return {
    kind: "pivot",
    pivot: best.pivot,
    pivotType: "kit_string",
    edgeType: null,
    weight: round(best.weight),
    strong: false,
    discounted: false,
    evidence: `${shared.length === 1 ? "ten sam komunikat" : `te same komunikaty (${shared.length})`} ze skryptu zestawu stron: ${quotes}`,
    pathA: best.pathA,
    pathB: best.pathB,
  };
}

function simEvidence(edgeType: SimilarityEdgeType, weight: number, evidence: string, similarity?: number): PairEvidence {
  return {
    kind: "similarity",
    pivot: null,
    pivotType: null,
    edgeType,
    weight: round(weight),
    strong: false,
    discounted: false,
    evidence,
    ...(similarity !== undefined ? { similarity: round(similarity) } : {}),
    pathA: [],
    pathB: [],
  };
}

/**
 * Text used for similarity: ad copy, OCR of the creative without the platform's interface and the
 * transcript without hallucinated credits, all without stock ad phrases; falling back to the landing
 * page title and description.
 */
export function textOf(item: Item, dataset: EnrichedDataset): string {
  const enr = dataset.perItem[item.id];
  // OCR of a screenshot: without the platform's interface labels, which every ad shares
  const ocr = enr?.ocrText ? stripUiChrome(enr.ocrText).text : null;
  const asr = enr?.asrText ? stripHallucinations(enr.asrText) : null;
  // stock phrases of ads ("dowiedz się więcej", "tylko dziś") say nothing about who wrote the copy
  const own = stripGenericPhrases([item.text, ocr, asr, enr?.videoOcrText].filter((t): t is string => !!t && t.trim().length > 0).join("\n"));
  if (own) return own;
  const ex = enr?.pageKey ? dataset.pages[enr.pageKey]?.extract : null;
  return [ex?.title, ex?.description].filter(Boolean).join(". ");
}

function dedupeFacts(facts: Fact[]): Fact[] {
  const best = new Map<string, Fact>();
  for (const f of facts) {
    const cur = best.get(f.pivot);
    if (!cur || f.relation > cur.relation || (f.relation === cur.relation && f.path.length < cur.path.length)) best.set(f.pivot, f);
  }
  return [...best.values()];
}

/**
 * Domains registered at the same registrar within N hours form a "registration burst" pivot.
 * Registrars are grouped by IANA ID when RDAP gives one: registries spell the same registrar
 * differently ("Example Inc" in one TLD, "Example, LLC" in another).
 */
function addRegistrationBursts(
  dataset: EnrichedDataset,
  g: GraphBuilder,
  factsByItem: Map<string, Fact[]>,
  config: LinkConfig,
): void {
  const windowMs = config.registrationBurstHours * 3_600_000;
  const byRegistrar = new Map<string, Array<{ domain: string; created: number }>>();
  for (const d of Object.values(dataset.domains)) {
    const reg = d.rdap?.registrar;
    const created = d.rdap?.created ? Date.parse(d.rdap.created) : NaN;
    if (!reg || Number.isNaN(created)) continue;
    const groupKey = d.rdap?.registrarIanaId != null ? `iana:${d.rdap.registrarIanaId}` : reg.toLowerCase();
    const list = byRegistrar.get(groupKey) ?? [];
    list.push({ domain: d.domain, created });
    byRegistrar.set(groupKey, list);
  }
  const burstOf = new Map<string, string>();
  for (const [groupKey, list] of byRegistrar) {
    list.sort((a, b) => a.created - b.created);
    let group: typeof list = [];
    const flush = () => {
      if (group.length >= 2) {
        const first = new Date(group[0].created).toISOString().slice(0, 10);
        const spanH = Math.round((group[group.length - 1].created - group[0].created) / 3_600_000);
        const regName = dataset.domains[group[0].domain]?.rdap?.registrar ?? "";
        const id = g.node("registrar", `${groupKey}|${first}`, `seria rejestracji: ${regName}, ${first} (${group.length} domen w ${spanH} h)`, {
          registrar: regName,
          burst: true,
          domains: group.map((x) => x.domain),
        });
        for (const x of group) {
          g.edge(nodeId("domain", x.domain), id, "registration_burst", `zarejestrowana ${new Date(x.created).toISOString().slice(0, 16).replace("T", " ")}`);
          burstOf.set(x.domain, id);
        }
      }
      group = [];
    };
    for (const entry of list) {
      if (group.length && entry.created - group[group.length - 1].created > windowMs) flush();
      group.push(entry);
    }
    flush();
  }
  if (!burstOf.size) return;
  for (const facts of factsByItem.values()) {
    const extra: Fact[] = [];
    for (const f of facts) {
      if (f.type !== "domain" || f.relation < 1) continue;
      const burst = burstOf.get(f.pivot.slice("domain:".length));
      if (!burst) continue;
      const label = g.nodes.get(burst)!;
      extra.push({
        pivot: burst,
        type: "registrar",
        path: [...f.path, burst],
        relation: 1,
        how: `domeny zarejestrowane seryjnie (${label.data.registrar}, w odstępie ≤ ${config.registrationBurstHours} h)`,
      });
    }
    facts.push(...dedupeFacts(extra).filter((e) => !facts.some((f) => f.pivot === e.pivot)));
  }
}

/**
 * Brand a page impersonates: the last part of its title after a dash or a bar ("… — Kurier Testowy"),
 * when the page's own domain does not carry that name. Null when the title names no such brand.
 */
export function impersonatedBrand(title: string | null | undefined, pageUrl: string | null | undefined): string | null {
  const parts = (title ?? "").split(/\s[—–|-]\s/);
  if (parts.length < 2) return null;
  const brand = parts[parts.length - 1].trim();
  if (brand.length < 3 || brand.length > 30 || brand.split(/\s+/).length > 3 || !/\p{L}/u.test(brand)) return null;
  const token = brand.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (token.length < 3) return null;
  let host = "";
  try {
    host = new URL(String(pageUrl ?? "")).hostname.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  } catch {
    return null;
  }
  return host.includes(token) || token.includes(host) ? null : brand;
}

function round(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}

/** Relation of the team_id+user_id pair (B-330): 0.9 x 0.7 stays below strongThreshold, so it never merges alone. */
const AFFILIATE_TEAM_RELATION = 0.7;

/** Polish reader label of an affiliate-network ID kind (B-330). */
const AFFILIATE_KIND_LABEL: Record<AffiliateId["kind"], string> = {
  team_user: "zespół i użytkownik",
  stream: "strumień (stream_id)",
  offer_uuid: "oferta (offer_uuid)",
  api_key: "klucz API",
};

/**
 * Adds the affiliate-network accounts of one item (B-330): an `affiliate_account` node keyed by kind, network
 * host and value for the team_id+user_id pair, stream_id and offer_uuid. An api_key becomes the `crm_key`
 * node of its SHA-256 (the same account as a key in the form, never counted twice; skipped when the page's
 * crm keys already hold it). Returns the lower-cased stream values linked here, so the caller does not count
 * them again as a global campaign_param.
 */
function linkAffiliateIds(
  g: GraphBuilder,
  add: (pivot: string, type: EntityType, path: string[], relation: number, how: string) => void,
  itemNode: string,
  ids: AffiliateId[],
  crmHashes: Set<string>,
): Set<string> {
  const streams = new Set<string>();
  const seen = new Set<string>();
  for (const a of ids) {
    const key = `${a.kind === "team_user" ? "team" : a.kind}:${a.host}:${a.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const where = a.via === "form" ? "ukrytym polu formularza" : a.via === "referer" ? "zakodowanym parametrze referer linku" : "linku zamówienia";
    if (a.kind === "api_key") {
      if (crmHashes.has(a.value)) continue;
      const id = g.node("crm_key", a.value, `klucz API sieci afiliacyjnej (sha256 ${a.value.slice(0, 12)}…)`, { sha256: a.value, field: "api_key", via: a.via, host: a.host });
      g.edge(itemNode, id, "posts_to", `klucz API sieci afiliacyjnej ${a.host} w ${where} (sha256 ${a.value.slice(0, 12)}…)`);
      add(id, "crm_key", [itemNode, id], 1, `ten sam klucz API sieci afiliacyjnej (sha256 ${a.value.slice(0, 12)}…)`);
      continue;
    }
    if (a.kind === "stream") streams.add(a.value.toLowerCase());
    const what = AFFILIATE_KIND_LABEL[a.kind];
    const id = g.node("affiliate_account", key, `${a.host} · ${what} ${a.value}`, { kind: a.kind, host: a.host, value: a.value, via: a.via, ...(a.attrs ? { attrs: a.attrs } : {}) });
    g.edge(itemNode, id, "carries_param", `konto sieci afiliacyjnej ${a.host} (${what} ${a.value}) w ${where}`);
    // the team+user pair is two small numbers: below strongThreshold, it only supports a link (rule kind affiliate_team)
    add(id, "affiliate_account", [itemNode, id], a.kind === "team_user" ? AFFILIATE_TEAM_RELATION : 1, `to samo konto w sieci afiliacyjnej ${a.host}: ${what} ${a.value}`);
  }
  return streams;
}

/**
 * Approximate creation date of the ads (B-343): the cases with a time-ordered Meta ad id and a first-shown date
 * calibrate the ids, and every case with such an id and a position between two anchors gets `adCreatedApprox`.
 * An attribute for the timeline, never a trace.
 */
function annotateAdCreated(g: { nodes: Map<string, GraphNode> }): void {
  const idOf = (d: Record<string, unknown>): string | null => [d.metaAdId, d.adLibraryAdId].find((v): v is string => typeof v === "string" && isTimedMetaId(v)) ?? null;
  const items = [...g.nodes.values()].filter((n) => n.type === "item");
  const anchors: MetaIdAnchor[] = [];
  for (const n of items) {
    const id = idOf(n.data);
    const date = typeof n.data.adFirstShown === "string" ? n.data.adFirstShown : null;
    if (id && date) anchors.push({ id, date });
  }
  if (anchors.length < 2) return;
  for (const n of items) {
    const id = idOf(n.data);
    const approx = id ? adCreatedApprox(id, anchors) : null;
    if (approx) n.data.adCreatedApprox = approx;
  }
}
