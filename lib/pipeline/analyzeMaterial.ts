/**
 * "Where does this material belong?" for a whole case: screenshots, a saved page, a HAR, a video, a
 * zip of them, or just a link and a text.
 *
 * The material goes through the same steps as a batch run: case import, enrichment (OCR, address
 * bar, ASR, platform records, click IDs ...), then the evidence graph and the campaign rules on the
 * existing dataset plus the new records. Only the new records are enriched; the existing ones come
 * from the run's enriched.json. The answer has the two levels of the batch output: a known campaign,
 * a new campaign similar to known ones (same family), or a new campaign, with the links behind it.
 * A record without infrastructure whose creative nearly repeats the creatives of one campaign joins it
 * as a variant (campaignRules.contentVariant, `campaignBasis: "content_variant"`), with lower confidence.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { campaignLinkVerdict, clusterCampaigns, verdictContext, type LinkVerdict } from "../graph/cluster";
import { DEFAULT_LINK_CONFIG, type LinkConfig } from "../graph/config";
import { buildEvidenceGraph } from "../graph/link";
import type { CampaignsFile, EdgeType, EntityType, EvidenceGraph, PairEvidence } from "../graph/model";
import type { FaceHit } from "../media/face";
import type { VoiceSpan } from "../media/speaker";
import type { CompiledWatchlist } from "../text/persona";
import { importCases } from "./caseImport";
import { enrichItems } from "./enrich";
import { loadMapping, loadRecords, normalizeRecords, type ColumnMapping } from "./ingest";
import { fixtureSources, type EnrichmentSources } from "./sources";
import { DuplicateFinder, duplicateTraits, isInsufficient, missingData, type DuplicateOf, type Sufficiency } from "./materialVerdicts";
import type { EnrichedDataset, Item } from "./types";
import { contentWords } from "../text/uiChrome";

export interface MaterialInput {
  /** Folder with the material of one case (any mix the case importer reads). */
  caseDir?: string;
  /**
   * Folders of several cases analysed together: one import and one graph, so the new materials are
   * compared with each other as well as with the existing run.
   */
  caseDirs?: string[];
  /**
   * Dataset file (.csv, .tsv, .json, .jsonl): every row becomes a material, through the same column
   * mapping as `bun run ingest` (automatic, or `datasetMapping`). Relative image and video paths are
   * resolved against the file's folder. The case of a row is its `case` column, else its id.
   */
  datasetFile?: string;
  /** Column mapping (JSON) for `datasetFile`, as `bun run ingest --mapping`. */
  datasetMapping?: string;
  url?: string;
  text?: string;
}

export type MaterialStep = "import" | "ocr" | "address_bar" | "asr" | "audio" | "clip" | "voice" | "faces" | "lookups" | "features" | "compare" | "group";

/** Progress of one case: a step starts, ends, is skipped (with the reason in `detail`) or fails. */
export interface MaterialProgress {
  caseId: string;
  step: MaterialStep;
  status: "start" | "done" | "skipped" | "error";
  detail?: string;
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
  media?: { ocr?: boolean; asr?: boolean; audio?: boolean; clip?: boolean; speaker?: boolean; faces?: boolean; facesOnly?: string; adLibrary?: boolean };
  log?: (m: string) => void;
  /** Progress per case and step (import, media, lookups, graph, campaign rules, verdicts). */
  onProgress?: (e: MaterialProgress) => void;
}

export type MaterialVerdict = "known_campaign" | "similar_campaigns" | "new_campaign" | "duplicate" | "insufficient";

export interface MaterialLink {
  other: string;
  /** Campaign of the other ad in the existing run. */
  otherCampaign: string | null;
  score: number;
  strong: boolean;
  /** What the campaign rules made of this link. */
  rule: LinkVerdict;
  /** The near-identical creative the record joined its campaign by (`campaignBasis: "content_variant"`). */
  variant?: boolean;
  evidence: MaterialEvidence[];
}

/** One premise of a link: a shared trait (pivot) or a similarity, with the same fields as `PairEvidence`. */
export interface MaterialEvidence {
  evidence: string;
  weight: number;
  strong: boolean;
  discounted: boolean;
  kind?: PairEvidence["kind"];
  /** Type of the shared node (kind = pivot), e.g. "domain", "tracker", "page_template". */
  pivotType?: EntityType | null;
  /** Similarity edge (kind = similarity), e.g. "similar_image", "similar_text". */
  edgeType?: EdgeType | null;
  /** Id of the shared node (kind = pivot), e.g. "domain:example.test". */
  pivot?: string | null;
}

export interface MaterialPivot {
  /** Node id, e.g. "domain:example.test". */
  id: string;
  type: string;
  label: string;
  weight: number | null;
  strong: boolean;
  /** Down-weighted: a shared-infrastructure list, frequency, or an indirect relation (e.g. an outbound link). */
  discounted: boolean;
  discountReasons: string[];
  /** Records of the existing run with this trait. */
  df: number;
  /** Those records (ids, at most MAX_SHARED_WITH). */
  sharedWith: string[];
  /** Node details; for a domain also `created` (RDAP registration date). */
  data: Record<string, unknown>;
}

/** Cap of `MaterialPivot.sharedWith` (df keeps the full count). */
export const MAX_SHARED_WITH = 100;

export interface MaterialItemResult {
  id: string;
  /** Case (folder name) the record comes from; for a bare link or text, the record id. */
  caseId?: string;
  verdict: MaterialVerdict;
  verdictText: string;
  /** Existing campaign the record joined (id from the existing run). */
  campaign: string | null;
  /**
   * How the record got into its campaign when not by the usual rules: "content_variant" = it has no
   * infrastructure and joined as a variant of a nearly identical creative (less certain). Absent otherwise.
   */
  campaignBasis?: "content_variant";
  /** Existing campaigns in the same group of similar campaigns. */
  similarCampaigns: string[];
  /** Why the record is not in those campaigns (different accounts, one kind of evidence). */
  apart: string[];
  /** Other new records of the same material in the same campaign (e.g. the pages of one funnel). */
  withNew: string[];
  /** New campaign of this batch (`N1`, `N2` ...) when the record's campaign holds new records only (two or more). */
  newCampaign?: string | null;
  /** The record is the same ad collected again: the original (existing or earlier in the batch) and why. */
  duplicateOf?: DuplicateOf;
  /** What to add so the material can be compared (verdicts insufficient and new_campaign). */
  missing?: string[];
  /** Block of comments written into the landing page: its size and how many other records (run and batch) carry the same block. */
  fakeComments?: { count: number; repeatedInOtherItems: number };
  /** Techniques of the landing page: fake_app_store, back_trap, fake_social_post, fake_comments. */
  techniques?: string[];
  /** Traits of the record (graph pivots) with their weight and how many records of the existing run share them. */
  pivots?: MaterialPivot[];
  /** Faces found in the record's pictures (opt-in `faces`): box, and for a face similar to a public figure of the closed list the persona id and the similarity ("podobna twarz do X (0,xx)", for review). */
  faces?: FaceHit[];
  /** Stretches of speech in the record's video (opt-in `speaker`, needs the gallery data/voices): seconds from the start, and for a voice similar to a public figure of the closed list the persona id and the cosine ("głos podobny do X (0,xx)", for review, never "this is X's voice"). */
  voices?: VoiceSpan[];
  links: MaterialLink[];
  /** Traits of the record read from the material (graph node data). */
  features: Record<string, unknown>;
  errors: string[];
}

export interface MaterialResult {
  mode: "offline" | "hybrid";
  items: MaterialItemResult[];
  /** Campaigns made of new records only (linked with each other, not with the existing run). */
  newCampaigns?: Array<{ id: string; members: string[]; evidence: string[] }>;
  skipped: Array<{ id: string; reason: string }>;
  /** Outcome of every step per case (done, skipped with the reason in `detail`, error); the "start" events are left out. */
  steps: MaterialProgress[];
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

function bareRecord(input: MaterialInput): Item {
  return { id: "nowa-reklama", platform: null, advertiser: null, text: input.text?.trim() || null, imageUrl: null, imagePath: null, landingUrl: input.url?.trim() || null, firstSeen: null, lastSeen: null, label: null, persona: null, deepfakeScore: null, videoPath: null, extra: {} };
}

/** Folder the image paths of a dataset are relative to: absolute, or relative to the working directory or the run folder. */
function resolveBaseDir(baseDir: string, dataDir: string): string {
  if (path.isAbsolute(baseDir)) return baseDir;
  const fromCwd = path.resolve(baseDir);
  return existsSync(fromCwd) ? fromCwd : path.resolve(dataDir, baseDir);
}

const FEATURE_KEYS = [
  "landingUrl", "finalUrl", "landingSource", "landingFragment", "observedUrls", "inAppBrowser", "advertiser", "uiView", "adLibraryIds",
  "personas", "impersonatedBrand", "platformCampaignName", "landingName", "trafficSource", "cloakerInSource", "platformAccount",
  "platformAccountSource", "platformAccountWarning", "platformTenants", "infrastructure",
  "metaAdId", "metaAppId", "clickTime", "clickCounter", "cyrillic", "cloakingSuspected", "ocrText", "asrText", "firstSeen", "techniques",
];

/**
 * Compares new material (case folders, a link, a text or a dataset file) with an existing run: imports and
 * enriches only the new records, builds one graph with the run, and gives each record a verdict, its links and
 * the outcome of every step (`steps`, skipped ones with the reason). Reads and writes files in `ctx`.
 */
export async function analyzeMaterial(input: MaterialInput, ctx: MaterialContext): Promise<MaterialResult> {
  const toolNotes = new Map<string, string>();
  const log = (m: string) => {
    const off = /^(OCR|ASR|CLIP|odcisk audio|twarze|głos mówcy) pomini[ęe]t[ye]: (.*)$/.exec(m);
    if (off) toolNotes.set(off[1], off[2]);
    ctx.log?.(m);
  };
  const steps: MaterialProgress[] = [];
  const progress = (caseId: string, step: MaterialStep, status: MaterialProgress["status"], detail?: string) => {
    const event: MaterialProgress = { caseId, step, status, ...(detail ? { detail } : {}) };
    if (status !== "start") steps.push(event);
    try {
      ctx.onProgress?.(event);
    } catch {
      // a failing listener must not stop the analysis
    }
  };
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
  /** Case of each new record (folder name; the record id for a bare link or text). */
  const caseOf = new Map<string, string>();
  const caseDirs = [...(input.caseDir ? [input.caseDir] : []), ...(input.caseDirs ?? [])];
  if (caseDirs.length) {
    // the importer reads every case of a folder: give it a folder with only these cases
    const casesDir = path.join(ctx.workDir, "cases");
    rmSync(casesDir, { recursive: true, force: true });
    mkdirSync(casesDir, { recursive: true });
    const names = new Set<string>();
    for (const dir of caseDirs) {
      const folder = path.basename(path.resolve(dir));
      let name = folder;
      for (let k = 2; names.has(name); k++) name = `${folder}-${k}`;
      names.add(name);
      symlinkSync(path.resolve(dir), path.join(casesDir, name), "dir");
    }
    for (const n of names) progress(n, "import", "start");
    let res: Awaited<ReturnType<typeof importCases>>;
    try {
      res = await importCases({ casesDir, outDir: importDir, log: (m) => notes.push(m) });
    } catch (e) {
      for (const n of names) progress(n, "import", "error", (e as Error).message);
      throw e;
    }
    skipped = res.skipped;
    const records = readJson<Array<Record<string, unknown>>>(path.join(importDir, "input.json")).filter((r) => names.has(String(r.case ?? r.id)));
    const mapping = readJson<ColumnMapping>(path.join(importDir, "mapping.json"));
    const single = caseDirs.length === 1;
    if (input.url && single) for (const r of records) r.landing_url ??= input.url;
    items = normalizeRecords(records, mapping).items;
    for (const r of records) caseOf.set(String(r.id), String(r.case ?? r.id));
    if (input.text && single) for (const it of items) it.text = [it.text, input.text].filter(Boolean).join("\n");
    if (!single && (input.url || input.text)) items.push(bareRecord(input));
    const imported = new Set(records.map((r) => String(r.case ?? r.id)));
    for (const n of names) {
      if (imported.has(n)) progress(n, "import", "done", `${records.filter((r) => String(r.case ?? r.id) === n).length} rekord(y)`);
      else progress(n, "import", "skipped", skipped.find((x) => x.id === n || x.id.startsWith(`${n}/`))?.reason ?? "brak strony, zrzutu ani wideo w katalogu");
    }
  }
  if (input.datasetFile) {
    const file = path.resolve(input.datasetFile);
    const rows = normalizeRecords(loadRecords(file), loadMapping(input.datasetMapping)).items;
    const dir = path.dirname(file);
    const local = (p: string | null | undefined) => (p && !/^https?:\/\//i.test(p) ? (path.isAbsolute(p) ? p : path.resolve(dir, p)) : null);
    for (const it of rows) {
      it.imagePath = local(it.imagePath) ?? local(it.imageUrl);
      if (it.imagePath && it.imageUrl && !/^https?:\/\//i.test(it.imageUrl)) it.imageUrl = null;
      it.videoPath = local(it.videoPath);
      if (it.extraImagePaths) it.extraImagePaths = it.extraImagePaths.map((p) => local(p) ?? p);
      caseOf.set(it.id, it.extra.case || it.id);
    }
    notes.push(`plik zbioru: ${rows.length} rekordów z ${path.basename(file)}`);
    items.push(...rows);
  }
  if (!items.length && (input.url || input.text)) items = [bareRecord(input)];
  if (!items.length) throw new Error("materiał nie zawiera ani strony, ani zrzutu, ani wideo, ani linku czy tekstu");
  const existingIds = new Set(base.items.map((i) => i.id));
  const taken = new Set<string>();
  for (const it of items) {
    const caseId = caseOf.get(it.id) ?? it.id;
    let id = it.id;
    for (let k = 2; existingIds.has(id) || taken.has(id); k++) id = `${it.id}-${k}`;
    it.id = id;
    it.label = null;
    taken.add(id);
    caseOf.set(id, caseId);
  }
  const newIds = new Set(items.map((i) => i.id));
  log(`nowe rekordy: ${[...newIds].join(", ")}`);

  // 2. Enrich only the new records
  const fixtureDir = path.join(importDir, "fixtures");
  const fallbackFixtures = ctx.fixtures && existsSync(ctx.fixtures) ? ctx.fixtures : fixtureDir;
  const sources = existsSync(fixtureDir) ? hybridSources(fixtureDir, ctx.live ?? null) : (ctx.live ?? fixtureSources(fallbackFixtures));
  const caseIds = [...new Set(items.map((it) => caseOf.get(it.id) ?? it.id))];
  const itemsOf = (c: string) => items.filter((it) => (caseOf.get(it.id) ?? it.id) === c);
  const media = { ocr: ctx.media?.ocr ?? true, asr: ctx.media?.asr ?? false, audio: ctx.media?.audio ?? false, clip: ctx.media?.clip ?? false, voice: ctx.media?.speaker ?? false, faces: ctx.media?.faces ?? false };
  const hasImage = (it: Item) => !!(it.imagePath || it.imageUrl || it.extraImagePaths?.length);
  const planned: Array<[MaterialStep, boolean, (it: Item) => boolean]> = [
    ["ocr", media.ocr, hasImage],
    ["address_bar", media.ocr, (it) => hasImage(it) || !!it.videoPath],
    ["asr", media.asr, (it) => !!it.videoPath],
    ["audio", media.audio, (it) => !!it.videoPath],
    ["clip", media.clip, (it) => hasImage(it) || !!it.videoPath],
    ["voice", media.voice, (it) => !!it.videoPath],
    ["faces", media.faces, (it) => hasImage(it) || !!it.videoPath],
    ["lookups", !!ctx.live, () => true],
  ];
  for (const c of caseIds) for (const [step, on, applies] of planned) if (on && itemsOf(c).some(applies)) progress(c, step, "start");
  let extra: EnrichedDataset;
  try {
    extra = await enrichItems(items, {
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
      faces: ctx.media?.faces ?? false,
      facesOnly: ctx.media?.facesOnly,
      adLibrary: ctx.media?.adLibrary ?? false,
      archiveDir: null,
      log,
    });
  } catch (e) {
    for (const c of caseIds) for (const [step, on, applies] of planned) if (on && itemsOf(c).some(applies)) progress(c, step, "error", (e as Error).message);
    throw e;
  }
  reportMediaSteps(extra, caseIds, itemsOf, media, !!ctx.live, toolNotes, progress);

  // 3. One graph and the campaign rules over the existing dataset plus the new records
  const merged = mergeDatasets(base, extra);
  const textMethod = oldGraph?.textMethod === "none" ? "none" : "tfidf";
  const phase = <T>(step: MaterialStep, run: () => T): T => {
    for (const c of caseIds) progress(c, step, "start");
    try {
      const out = run();
      for (const c of caseIds) progress(c, step, "done");
      return out;
    } catch (e) {
      for (const c of caseIds) progress(c, step, "error", (e as Error).message);
      throw e;
    }
  };
  const raw = phase("features", () => buildEvidenceGraph(merged, { config, textMethod, includeItemPivots: true }));
  // traits of the existing run: which records of the run hold each pivot
  const baseHolders = new Map<string, string[]>();
  for (const [itemId, facts] of Object.entries(raw.itemPivots ?? {})) {
    if (newIds.has(itemId)) continue;
    for (const f of facts) baseHolders.set(f.pivot, [...(baseHolders.get(f.pivot) ?? []), itemId]);
  }
  const { campaigns } = phase("compare", () => clusterCampaigns(raw, { config }));
  for (const c of caseIds) progress(c, "group", "start");
  const { accountOf, infraItems } = verdictContext(raw.nodes);
  const nodeData = new Map<string, Record<string, unknown>>();
  const nodeById = new Map(raw.nodes.map((n) => [n.id, n]));
  for (const n of raw.nodes) if (n.type === "item") nodeData.set(n.key, n.data);
  const oldOf = (id: string) => oldCampaigns.assignments[id] ?? null;
  const majorityOld = (members: string[]) => {
    const counts = new Map<string, number>();
    for (const m of members) {
      const c = oldOf(m);
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  };

  const pivotsOf = (id: string): MaterialPivot[] =>
    (raw.itemPivots?.[id] ?? [])
      .map((f): MaterialPivot | null => {
        const node = nodeById.get(f.pivot);
        if (!node) return null;
        const holders = (baseHolders.get(f.pivot) ?? []).sort();
        const nodeData: Record<string, unknown> = { ...node.data };
        delete nodeData.weightParts;
        if (node.type === "domain" && !nodeData.created) nodeData.created = merged.domains[node.key]?.rdap?.created ?? null;
        const reasons = node.discounts.map((d) => `${d.reason} (×${d.factor})`);
        if (f.relation < 1) reasons.push(`relacja pośrednia ×${Math.round(f.relation * 100) / 100}: ${f.how}`);
        return {
          id: node.id,
          type: node.type,
          label: node.label,
          weight: node.weight,
          strong: node.strong && f.relation >= 1,
          discounted: reasons.length > 0,
          discountReasons: reasons,
          df: holders.length,
          sharedWith: holders.slice(0, MAX_SHARED_WITH),
          data: nodeData,
        };
      })
      .filter((p): p is MaterialPivot => p !== null)
      .sort((a, b) => Number(b.strong) - Number(a.strong) || (b.weight ?? 0) - (a.weight ?? 0) || a.id.localeCompare(b.id));

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
    const variant = camp?.variants?.find((v) => v.id === id);
    const links: MaterialLink[] = raw.links
      .filter((l) => (l.a === id && !newIds.has(l.b)) || (l.b === id && !newIds.has(l.a)))
      .map((l) => {
        const other = l.a === id ? l.b : l.a;
        return {
          other,
          otherCampaign: oldOf(other),
          score: l.score,
          strong: l.strong,
          rule: campaignLinkVerdict(l, config, accountOf, infraItems),
          ...(variant?.like === other ? { variant: true } : {}),
          evidence: l.evidence.slice(0, 6).map((e) => ({
            evidence: e.evidence,
            weight: e.weight,
            strong: e.strong,
            discounted: e.discounted,
            kind: e.kind,
            pivotType: e.pivotType,
            edgeType: e.edgeType,
            pivot: e.pivot,
          })),
        };
      })
      .sort((x, y) => Number(!!y.variant) - Number(!!x.variant) || Number(y.strong) - Number(x.strong) || y.score - x.score)
      .slice(0, 10);
    const strongest = links.find((l) => l.otherCampaign === known && (l.strong || l.rule === "campaign"));
    const verdict: MaterialVerdict = known ? "known_campaign" : similar.length ? "similar_campaigns" : "new_campaign";
    const verdictText =
      verdict === "known_campaign" && variant
        ? `Należy do kampanii ${known} jako wariant: kreacja prawie identyczna z materiałem ${variant.like} (${variant.evidence}); materiał nie ma własnych śladów infrastruktury, więc przypisanie opiera się tylko na kreacji i jest mniej pewne.`
        : verdict === "known_campaign"
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
    const block = typeof data.commentBlock === "string" ? nodeById.get(data.commentBlock) : undefined;
    results.push({
      id,
      caseId: caseOf.get(id) ?? id,
      verdict,
      verdictText: withNew.length && verdict !== "known_campaign" ? `${verdictText} Razem z: ${withNew.join(", ")}.` : verdictText,
      campaign: known,
      ...(variant ? { campaignBasis: "content_variant" as const } : {}),
      similarCampaigns: similar,
      apart: fam?.apart ?? [],
      withNew,
      newCampaign: null,
      ...(block ? { fakeComments: { count: Number(data.fakeCommentCount ?? 0), repeatedInOtherItems: Math.max(0, block.df - 1) } } : {}),
      ...(Array.isArray(data.techniques) && data.techniques.length ? { techniques: data.techniques as string[] } : {}),
      pivots: pivotsOf(id),
      ...(extra.perItem[id]?.faces ? { faces: extra.perItem[id].faces } : {}),
      ...(extra.perItem[id]?.voices ? { voices: extra.perItem[id].voices } : {}),
      links,
      features,
      errors: extra.perItem[id]?.errors ?? [],
    });
  }

  // 4. Campaigns of new records only: N1, N2 ... in the order of the records
  const newCampaigns: NonNullable<MaterialResult["newCampaigns"]> = [];
  const nOf = new Map<string, string>();
  for (const r of results) {
    const camp = campaigns.campaigns.find((c) => c.id === campaigns.assignments[r.id]);
    if (!camp || camp.members.length < 2 || camp.members.some((m) => !newIds.has(m))) continue;
    let nid = nOf.get(camp.id);
    if (!nid) {
      nid = `N${newCampaigns.length + 1}`;
      nOf.set(camp.id, nid);
      newCampaigns.push({ id: nid, members: [...camp.members], evidence: camp.topEvidence.map((e) => e.label) });
    }
    r.newCampaign = nid;
  }

  // 5. Duplicates: the same ad collected again (against the run and the earlier records of the batch)
  const baseDir = resolveBaseDir(base.baseDir, ctx.dataDir);
  const itemById = new Map(merged.items.map((it) => [it.id, it]));
  const traitsOf = (id: string) => {
    const it = itemById.get(id);
    const dir = newIds.has(id) ? importDir : baseDir;
    const img = it?.imagePath ? (path.isAbsolute(it.imagePath) ? it.imagePath : path.join(dir, it.imagePath)) : null;
    return duplicateTraits(id, nodeData.get(id) ?? {}, it?.landingUrl ?? merged.perItem[id]?.landing?.url ?? null, img);
  };
  const dups = await new DuplicateFinder().find(
    [...newIds].map(traitsOf),
    base.items.map((it) => traitsOf(it.id)),
  );
  const byId = new Map(results.map((r) => [r.id, r]));
  for (const r of results) {
    const d = dups.get(r.id);
    if (!d) continue;
    const orig = byId.get(d.id);
    const campaign = orig ? orig.campaign : oldOf(d.id);
    r.verdict = "duplicate";
    r.duplicateOf = d;
    r.campaign = campaign;
    // the campaign now comes from the original: a variant basis holds only if the original had it
    if (orig?.campaignBasis) r.campaignBasis = orig.campaignBasis;
    else delete r.campaignBasis;
    if (orig) {
      r.similarCampaigns = orig.similarCampaigns;
      r.newCampaign = orig.newCampaign ?? r.newCampaign;
    }
    r.verdictText = `Duplikat materiału ${d.id}: ${d.reason}.${campaign ? ` Kampania ${campaign}.` : r.newCampaign ? ` Nowa kampania ${r.newCampaign}.` : ""}`;
  }

  // 6. Not enough to compare: no address, no identifier, (almost) no text, and no link over the thresholds
  for (const r of results) {
    if (r.verdict === "duplicate") continue;
    const enr = merged.perItem[r.id];
    const it = itemById.get(r.id);
    const data = nodeData.get(r.id) ?? {};
    const camp = campaigns.campaigns.find((c) => c.id === campaigns.assignments[r.id]);
    const t = enr?.text;
    const words = contentWords([it?.text, enr?.ocrText, enr?.extraOcrText, enr?.asrText].filter(Boolean).join("\n")).length;
    const s: Sufficiency = {
      hasAddress: !!(r.features.landingUrl || data.finalUrl || enr?.landing || enr?.pageKey || enr?.observedUrls?.length || t?.urls.length),
      hasIdentifier: !!(t?.emails.length || t?.phones.length || t?.telegram.length || t?.whatsapp.length || t?.wallets.length || data.metaAdId || (data.adLibraryIds as unknown[] | undefined)?.length || data.platformAccount),
      contentWords: words,
      hasImage: !!enr?.image,
      hasVideo: !!it?.videoPath,
      hasPage: !!enr?.pageKey,
      linked: (camp?.members.length ?? 1) > 1 || !!camp?.familyId,
    };
    if (isInsufficient(s)) {
      r.verdict = "insufficient";
      r.missing = missingData(s);
      r.verdictText = `Za mało danych do porównania: brak adresu strony, identyfikatorów i treści (${words} słów po usunięciu elementów interfejsu). Dorzuć: ${r.missing.join("; ")}.`;
    } else if (r.verdict === "new_campaign") {
      const m = missingData(s);
      if (m.length) r.missing = m;
    }
  }
  for (const c of caseIds) {
    const v = results.filter((r) => r.caseId === c).map((r) => r.verdict);
    progress(c, "group", "done", [...new Set(v)].join(", "));
  }
  return { mode: ctx.live ? "hybrid" : "offline", items: results, newCampaigns, skipped, steps, notes };
}

/** Outcome of the media and lookup steps per case, from what the enrichment produced. */
function reportMediaSteps(
  extra: EnrichedDataset,
  caseIds: string[],
  itemsOf: (c: string) => Item[],
  media: { ocr: boolean; asr: boolean; audio: boolean; clip: boolean; voice: boolean; faces: boolean },
  live: boolean,
  toolNotes: Map<string, string>,
  progress: (caseId: string, step: MaterialStep, status: MaterialProgress["status"], detail?: string) => void,
): void {
  for (const c of caseIds) {
    const its = itemsOf(c);
    const enr = its.map((it) => extra.perItem[it.id]).filter(Boolean);
    const img = its.some((it) => !!(it.imagePath || it.imageUrl || it.extraImagePaths?.length));
    const vid = its.some((it) => !!it.videoPath);
    const errs = enr.flatMap((e) => e.errors);
    const errOf = (re: RegExp) => errs.find((e) => re.test(e));
    const report = (step: MaterialStep, on: boolean, offWhy: string, applies: boolean, missingWhy: string, tool: string | null, done: boolean, doneWhy: string, errRe: RegExp) => {
      if (!on) return progress(c, step, "skipped", offWhy);
      if (!applies) return progress(c, step, "skipped", missingWhy);
      if (tool && toolNotes.has(tool)) return progress(c, step, "skipped", `${tool}: ${toolNotes.get(tool)}`);
      const err = errOf(errRe);
      if (err && !done) return progress(c, step, "error", err);
      progress(c, step, "done", done ? undefined : doneWhy);
    };
    report("ocr", media.ocr, "OCR wyłączony", img, "brak obrazu", "OCR", enr.some((e) => !!(e.ocrText || e.extraOcrText)), "nie odczytano tekstu", /ocr|tesseract/i);
    report("address_bar", media.ocr, "wymaga OCR", img || vid, "brak zrzutu i wideo", "OCR", enr.some((e) => (e.observedUrls?.length ?? 0) > 0), "brak paska adresu na zrzutach", /pasek|address/i);
    report("asr", media.asr, "transkrypcja wyłączona", vid, "brak wideo", "ASR", enr.some((e) => !!e.asrText), "brak mowy", /asr|whisper|transkry/i);
    report("audio", media.audio, "odcisk audio wyłączony", vid, "brak wideo", "odcisk audio", enr.some((e) => (e.audioFp?.fingerprint.length ?? 0) > 0), "brak ścieżki dźwiękowej", /fpcalc|audio/i);
    report("clip", media.clip, "CLIP wyłączony", img || vid, "brak obrazu i wideo", "CLIP", enr.some((e) => !!(e.imageEmbedding?.length || e.videoEmbedding?.length)), "brak osadzenia", /clip/i);
    report("voice", media.voice, "głos wyłączony", vid, "brak wideo", "głos mówcy", enr.some((e) => e.voices !== undefined), "adapter nie zwrócił wyniku", /speaker|głos/i);
    report("faces", media.faces, "twarze wyłączone", img || vid, "brak obrazu i wideo", "twarze", enr.some((e) => e.faces !== undefined), "adapter nie zwrócił wyniku", /faces/i);
    report("lookups", live, "tryb offline: bez zapytań sieciowych, tylko strony z materiału", true, "", null, true, "", /dns|rdap|asn/i);
  }
}
