/**
 * "Where does this material belong?" for a whole case: screenshots, a saved page, a HAR, a video, a
 * zip of them, or just a link and a text.
 *
 * The material goes through the same steps as a batch run: case import, enrichment (OCR, address
 * bar, ASR, platform records, click IDs ...), then the evidence graph and the campaign rules on the
 * existing dataset plus the new records. Only the new records are enriched; the existing ones come
 * from the run's enriched.json. The answer has the two levels of the batch output: a known campaign,
 * a new campaign similar to known ones (same family), or a new campaign, with the links behind it.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { campaignLinkVerdict, clusterCampaigns, type LinkVerdict } from "../graph/cluster";
import { DEFAULT_LINK_CONFIG, type LinkConfig } from "../graph/config";
import { buildEvidenceGraph } from "../graph/link";
import type { CampaignsFile, EvidenceGraph } from "../graph/model";
import type { CompiledWatchlist } from "../text/persona";
import { importCases } from "./caseImport";
import { enrichItems } from "./enrich";
import { normalizeRecords, type ColumnMapping } from "./ingest";
import { fixtureSources, type EnrichmentSources } from "./sources";
import type { EnrichedDataset, Item } from "./types";

export interface MaterialInput {
  /** Folder with the material of one case (any mix the case importer reads). */
  caseDir?: string;
  url?: string;
  text?: string;
}

export interface MaterialContext {
  /** Folder of an existing run: graph.json, campaigns.json and enriched.json (or work/enriched.json). */
  dataDir: string;
  /** Scratch folder for the import output and archived pages. */
  workDir: string;
  /** Recorded fixtures for a link without a captured page (offline demo on the sample dataset). */
  fixtures?: string;
  /** Live passive lookups (DNS, RDAP, ASN) and one GET for a page the material does not hold; null = offline. */
  live?: EnrichmentSources | null;
  config?: LinkConfig;
  personas?: CompiledWatchlist | null;
  media?: { ocr?: boolean; asr?: boolean; audio?: boolean; clip?: boolean; speaker?: boolean; adLibrary?: boolean };
  log?: (m: string) => void;
}

export type MaterialVerdict = "known_campaign" | "similar_campaigns" | "new_campaign";

export interface MaterialLink {
  other: string;
  /** Campaign of the other ad in the existing run. */
  otherCampaign: string | null;
  score: number;
  strong: boolean;
  /** What the campaign rules made of this link. */
  rule: LinkVerdict;
  evidence: Array<{ evidence: string; weight: number; strong: boolean; discounted: boolean }>;
}

export interface MaterialItemResult {
  id: string;
  verdict: MaterialVerdict;
  verdictText: string;
  /** Existing campaign the record joined (id from the existing run). */
  campaign: string | null;
  /** Existing campaigns in the same group of similar campaigns. */
  similarCampaigns: string[];
  /** Why the record is not in those campaigns (different accounts, one kind of evidence). */
  apart: string[];
  /** Other new records of the same material in the same campaign (e.g. the pages of one funnel). */
  withNew: string[];
  links: MaterialLink[];
  /** Traits of the record read from the material (graph node data). */
  features: Record<string, unknown>;
  errors: string[];
}

export interface MaterialResult {
  mode: "offline" | "hybrid";
  items: MaterialItemResult[];
  skipped: Array<{ id: string; reason: string }>;
  notes: string[];
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

/** enriched.json of an existing run: next to graph.json, or in work/. */
export function findEnriched(dataDir: string): string | null {
  for (const f of [path.join(dataDir, "enriched.json"), path.join(dataDir, "work", "enriched.json")]) if (existsSync(f)) return f;
  return null;
}

/** Captured pages and images first, then live passive sources (when allowed) for everything else. */
function hybridSources(fixtureDir: string, live: EnrichmentSources | null): EnrichmentSources {
  const fx = fixtureSources(fixtureDir);
  if (!live) return fx;
  const httpFile = path.join(fixtureDir, "http.json");
  const keys = new Set(existsSync(httpFile) ? Object.keys(readJson<Record<string, unknown>>(httpFile)) : []);
  const has = (url: string) => {
    try {
      return keys.has(new URL(url).toString());
    } catch {
      return false;
    }
  };
  const dnsFile = path.join(fixtureDir, "dns.json");
  const captured = existsSync(dnsFile) ? readJson<Record<string, Record<string, string[]>>>(dnsFile) : {};
  return {
    mode: "live",
    fetchPage: (url, opts) => (has(url) && !opts?.userAgent ? fx.fetchPage(url, opts) : live.fetchPage(url, opts)),
    fetchBinary: (url) => (has(url) ? fx.fetchBinary(url) : live.fetchBinary(url)),
    // A/AAAA captured in the HAR describe the time of capture; the rest comes from live lookups
    dns: async (name, types) => {
      const rec = await live.dns(name, types);
      const cap = captured[name.toLowerCase()];
      if (cap?.A?.length) rec.a = [...cap.A];
      if (cap?.AAAA?.length) rec.aaaa = [...cap.AAAA];
      return rec;
    },
    rdap: (d) => live.rdap(d),
    ct: (d) => live.ct(d),
    asn: (ip) => live.asn(ip),
  };
}

function mergeDatasets(base: EnrichedDataset, extra: EnrichedDataset): EnrichedDataset {
  return {
    ...base,
    items: [...base.items, ...extra.items],
    perItem: { ...base.perItem, ...extra.perItem },
    pages: { ...base.pages, ...extra.pages },
    hosts: { ...base.hosts, ...extra.hosts },
    domains: { ...extra.domains, ...base.domains, ...Object.fromEntries(Object.entries(extra.domains).filter(([, d]) => d.rdap || d.ns.length)) },
    ips: { ...base.ips, ...extra.ips },
  };
}

const FEATURE_KEYS = [
  "landingUrl", "finalUrl", "landingSource", "landingFragment", "observedUrls", "inAppBrowser", "advertiser", "uiView", "adLibraryIds",
  "personas", "impersonatedBrand", "platformCampaignName", "landingName", "trafficSource", "cloakerInSource", "platformAccount",
  "metaAdId", "metaAppId", "clickTime", "clickCounter", "cyrillic", "cloakingSuspected", "ocrText", "asrText", "firstSeen",
];

export async function analyzeMaterial(input: MaterialInput, ctx: MaterialContext): Promise<MaterialResult> {
  const log = ctx.log ?? (() => {});
  const config = ctx.config ?? DEFAULT_LINK_CONFIG;
  const enrichedFile = findEnriched(ctx.dataDir);
  if (!enrichedFile) throw new Error(`brak enriched.json w ${ctx.dataDir} (ani w work/)`);
  const base = readJson<EnrichedDataset>(enrichedFile);
  const oldCampaigns = readJson<CampaignsFile>(path.join(ctx.dataDir, "campaigns.json"));
  const oldGraph = existsSync(path.join(ctx.dataDir, "graph.json")) ? readJson<EvidenceGraph>(path.join(ctx.dataDir, "graph.json")) : null;
  mkdirSync(ctx.workDir, { recursive: true });

  // 1. New records
  let items: Item[] = [];
  let skipped: MaterialResult["skipped"] = [];
  const notes: string[] = [];
  const importDir = path.join(ctx.workDir, "import");
  if (input.caseDir) {
    // the importer reads every case of a folder: give it a folder with only this case
    const casesDir = path.join(ctx.workDir, "cases");
    rmSync(casesDir, { recursive: true, force: true });
    mkdirSync(casesDir, { recursive: true });
    symlinkSync(path.resolve(input.caseDir), path.join(casesDir, path.basename(input.caseDir)), "dir");
    const res = await importCases({ casesDir, outDir: importDir, log: (m) => notes.push(m) });
    skipped = res.skipped;
    const records = readJson<Array<Record<string, unknown>>>(path.join(importDir, "input.json")).filter(
      (r) => r.id === path.basename(input.caseDir!) || r.case === path.basename(input.caseDir!),
    );
    const mapping = readJson<ColumnMapping>(path.join(importDir, "mapping.json"));
    if (input.url) for (const r of records) r.landing_url ??= input.url;
    items = normalizeRecords(records, mapping).items;
    if (input.text) for (const it of items) it.text = [it.text, input.text].filter(Boolean).join("\n");
  }
  if (!items.length && (input.url || input.text)) {
    items = [
      { id: "nowa-reklama", platform: null, advertiser: null, text: input.text?.trim() || null, imageUrl: null, imagePath: null, landingUrl: input.url?.trim() || null, firstSeen: null, lastSeen: null, label: null, persona: null, deepfakeScore: null, videoPath: null, extra: {} },
    ];
  }
  if (!items.length) throw new Error("materiał nie zawiera ani strony, ani zrzutu, ani wideo, ani linku czy tekstu");
  const existingIds = new Set(base.items.map((i) => i.id));
  for (const it of items) {
    let id = it.id;
    for (let k = 2; existingIds.has(id); k++) id = `${it.id}-${k}`;
    it.id = id;
    it.label = null;
  }
  const newIds = new Set(items.map((i) => i.id));
  log(`nowe rekordy: ${[...newIds].join(", ")}`);

  // 2. Enrich only the new records
  const fixtureDir = path.join(importDir, "fixtures");
  const fallbackFixtures = ctx.fixtures && existsSync(ctx.fixtures) ? ctx.fixtures : fixtureDir;
  const sources = existsSync(fixtureDir) ? hybridSources(fixtureDir, ctx.live ?? null) : (ctx.live ?? fixtureSources(fallbackFixtures));
  const extra = await enrichItems(items, {
    sources,
    baseDir: importDir,
    concurrency: 2,
    skip: ctx.live ? { ct: true } : {},
    personas: ctx.personas ?? null,
    ocr: ctx.media?.ocr ?? true,
    asr: ctx.media?.asr ?? false,
    audio: ctx.media?.audio ?? false,
    clip: ctx.media?.clip ?? false,
    speaker: ctx.media?.speaker ?? false,
    adLibrary: ctx.media?.adLibrary ?? false,
    archiveDir: null,
    log,
  });

  // 3. One graph and the campaign rules over the existing dataset plus the new records
  const merged = mergeDatasets(base, extra);
  const textMethod = oldGraph?.textMethod === "none" ? "none" : "tfidf";
  const raw = buildEvidenceGraph(merged, { config, textMethod });
  const { campaigns } = clusterCampaigns(raw, { config });
  const accountOf = new Map<string, string>();
  const nodeData = new Map<string, Record<string, unknown>>();
  for (const n of raw.nodes) {
    if (n.type !== "item") continue;
    nodeData.set(n.key, n.data);
    if (typeof n.data.platformAccount === "string") accountOf.set(n.key, n.data.platformAccount);
  }
  const oldOf = (id: string) => oldCampaigns.assignments[id] ?? null;
  const majorityOld = (members: string[]) => {
    const counts = new Map<string, number>();
    for (const m of members) {
      const c = oldOf(m);
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  };

  const results: MaterialItemResult[] = [];
  for (const id of newIds) {
    const campId = campaigns.assignments[id];
    const camp = campaigns.campaigns.find((c) => c.id === campId);
    const oldMembers = (camp?.members ?? []).filter((m) => !newIds.has(m));
    const known = oldMembers.length ? majorityOld(oldMembers) : null;
    const fam = camp?.familyId ? campaigns.families?.find((f) => f.id === camp.familyId) : undefined;
    const similar = fam
      ? [...new Set(fam.campaigns.filter((c) => c !== campId).flatMap((c) => campaigns.campaigns.find((x) => x.id === c)?.members ?? []).filter((m) => !newIds.has(m)).map(oldOf).filter((c): c is string => !!c && c !== known))].sort()
      : [];
    const links: MaterialLink[] = raw.links
      .filter((l) => (l.a === id && !newIds.has(l.b)) || (l.b === id && !newIds.has(l.a)))
      .map((l) => {
        const other = l.a === id ? l.b : l.a;
        return {
          other,
          otherCampaign: oldOf(other),
          score: l.score,
          strong: l.strong,
          rule: campaignLinkVerdict(l, config, accountOf),
          evidence: l.evidence.slice(0, 6).map((e) => ({ evidence: e.evidence, weight: e.weight, strong: e.strong, discounted: e.discounted })),
        };
      })
      .sort((x, y) => Number(y.strong) - Number(x.strong) || y.score - x.score)
      .slice(0, 10);
    const strongest = links.find((l) => l.otherCampaign === known && (l.strong || l.rule === "campaign"));
    const verdict: MaterialVerdict = known ? "known_campaign" : similar.length ? "similar_campaigns" : "new_campaign";
    const verdictText =
      verdict === "known_campaign"
        ? `Należy do kampanii ${known}${strongest ? ` (${strongest.strong ? "silny dowód" : "dowody kilku rodzajów"}: ${strongest.evidence[0]?.evidence ?? ""})` : ""}.`
        : verdict === "similar_campaigns"
          ? `Nowa kampania, podobna do ${similar.join(", ")} (grupa podobnych kampanii${fam?.apart.length ? `; osobno, bo: ${fam.apart.join("; ")}` : ""}).`
          : links.length
            ? "Nowa kampania: powiązania ze znanymi kampaniami są za słabe albo jednego rodzaju."
            : "Nowa kampania: brak wspólnych śladów ze znanymi kampaniami.";
    const data = nodeData.get(id) ?? {};
    const features = Object.fromEntries(FEATURE_KEYS.filter((k) => data[k] !== undefined && data[k] !== null && data[k] !== "").map((k) => [k, data[k]]));
    // the landing URL may come from the material itself (address bar, ad text), not from the input
    if (!features.landingUrl && extra.perItem[id]?.landing) features.landingUrl = extra.perItem[id].landing!.url;
    const withNew = (camp?.members ?? []).filter((m) => m !== id && newIds.has(m));
    results.push({
      id,
      verdict,
      verdictText: withNew.length && verdict !== "known_campaign" ? `${verdictText} Razem z: ${withNew.join(", ")}.` : verdictText,
      campaign: known,
      similarCampaigns: similar,
      apart: fam?.apart ?? [],
      withNew,
      links,
      features,
      errors: extra.perItem[id]?.errors ?? [],
    });
  }
  return { mode: ctx.live ? "hybrid" : "offline", items: results, skipped, notes };
}
