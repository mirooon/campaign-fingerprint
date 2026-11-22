/**
 * Pipeline steps shared by the CLI scripts and `pipeline`: each step reads/writes
 * JSON files so it can be run (and inspected) on its own.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCache, TTL } from "../cache";
import { clusterCampaigns } from "../graph/cluster";
import { DEFAULT_LINK_CONFIG, mergeConfig, type LinkConfig, type LinkConfigOverride } from "../graph/config";
import { evaluateClustering, type EvalResult } from "../graph/eval";
import { campaignEvolution } from "../graph/evolution";
import { buildEvidenceGraph, textOf } from "../graph/link";
import { Discounter } from "../graph/weights";
import type { CampaignsFile, EvidenceGraph, NearMissesFile } from "../graph/model";
import { pruneGraphForOutput } from "../graph/prune";
import { embed, getProvider } from "../llm";
import { compileWatchlist, loadWatchlist } from "../text/persona";
import { archiveStepOptions } from "./archiveContext";
import { enrichItems } from "./enrich";
import { loadMapping, loadRecords, normalizeRecords } from "./ingest";
import { datasetDuplicates, duplicateMedia, duplicateTraits } from "./materialVerdicts";
import { fixtureSources, liveSources } from "./sources";
import type { EnrichedDataset, ItemsFile } from "./types";

export const DEFAULTS = {
  input: "data/sample/ads.csv",
  mapping: "data/sample/mapping.json",
  items: "data/work/items.json",
  enriched: "data/work/enriched.json",
  fixtures: "data/sample/fixtures",
  config: "data/sample/linking.json",
  graph: "data/graph.json",
  campaigns: "data/campaigns.json",
  personas: "data/sample/personas.json",
  archive: "data/work/archive",
  evidence: "data/evidence",
  ctFeed: "data/ct-watch.jsonl",
  ctLexicon: "data/sample/ct-lexicon.json",
  ctReplay: "data/sample/ct-stream.jsonl",
} as const;

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function writeJson(file: string, data: unknown, pretty = true): void {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, `${pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)}\n`, "utf8");
}

export function loadLinkConfig(file: string | undefined): LinkConfig {
  if (!file || !existsSync(file)) return mergeConfig(null);
  return mergeConfig(readJson<LinkConfigOverride>(file));
}

export interface IngestStepOptions {
  input: string;
  mapping?: string;
  out: string;
  baseDir?: string;
}

export function runIngest(o: IngestStepOptions): ItemsFile {
  const records = loadRecords(o.input);
  const mappingFile = o.mapping && existsSync(o.mapping) ? o.mapping : undefined;
  const { items, warnings, mapping } = normalizeRecords(records, loadMapping(mappingFile));
  const file: ItemsFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: o.input,
    baseDir: o.baseDir ?? path.dirname(o.input),
    items,
    warnings,
  };
  writeJson(o.out, file);
  console.log(`[ingest] ${items.length} reklam z ${o.input} -> ${o.out}`);
  console.log(`[ingest] mapowanie kolumn: ${JSON.stringify(mapping)}`);
  for (const w of warnings.slice(0, 20)) console.warn(`[ingest] uwaga: ${w}`);
  if (warnings.length > 20) console.warn(`[ingest] ... i ${warnings.length - 20} kolejnych uwag`);
  return file;
}

export interface EnrichStepOptions {
  items: string;
  out: string;
  offline?: boolean;
  fixtures?: string;
  concurrency?: number;
  skip?: string[];
  /** Persona watchlist JSON (public figures). */
  personas?: string;
  /** Opt-in person NER through the configured LLM provider. */
  ner?: boolean;
  /** Opt-in cloaking check (two extra GETs per landing page). */
  cloaking?: boolean;
  ocr?: boolean;
  asr?: boolean;
  audio?: boolean;
  clip?: boolean;
  /** SpeechBrain speaker embeddings of video creatives. */
  speaker?: boolean;
  /** Faces in creatives, screenshots and video frames; persona from a face similar to a public figure of the closed list. */
  faces?: boolean;
  /** With `faces`: compare only with this person id (1:1 verification at that person's request). */
  facesOnly?: string;
  /** Meta Ad Library details for ad-library IDs (MetaAdsCollector, live mode). */
  adLibrary?: boolean;
  /** Directory for archived HTML; null disables archiving. */
  archive?: string | null;
  /** Opt-in archive lookup (urlscan, Wayback) for landing pages that do not answer; ARCHIVE_SOURCES picks the sources. */
  archiveLookup?: boolean;
}

/**
 * `enrich` step: reads items.json, enriches the landing pages, hosts, domains and media (live passive sources, or
 * recorded fixtures with `offline`), writes enriched.json and prints a summary. With `archiveLookup` a landing page
 * that does not answer gets a public copy (urlscan, Wayback) with its provenance; an offline run skips that with the reason.
 */
export async function runEnrich(o: EnrichStepOptions): Promise<EnrichedDataset> {
  const itemsFile = readJson<ItemsFile>(o.items);
  const sources = o.offline ? fixtureSources(o.fixtures ?? DEFAULTS.fixtures) : liveSources();
  const skip = Object.fromEntries((o.skip ?? []).map((s) => [s.trim(), true]));
  console.log(`[enrich] tryb: ${o.offline ? `offline (fixtures: ${o.fixtures ?? DEFAULTS.fixtures})` : "live (pasywne zapytania, cache w .cache/)"}`);
  const watchlist = o.personas && existsSync(o.personas) ? compileWatchlist(loadWatchlist(o.personas)) : null;
  if (watchlist) console.log(`[enrich] lista obserwowanych osób: ${watchlist.entries.length} (${o.personas})`);
  const archiveStep = archiveStepOptions({ enabled: !!o.archiveLookup, offline: o.offline });
  const parking = new Discounter(DEFAULT_LINK_CONFIG);
  const extras = [archiveStep && "archiwa stron (urlscan, Wayback)", o.ner && "NER", o.cloaking && "cloaking", o.ocr && "OCR", o.asr && "ASR", o.audio && "audio", o.clip && "CLIP", o.speaker && "głos (SpeechBrain)", o.faces && "twarze (OpenCV)", o.adLibrary && "biblioteka reklam"].filter(Boolean);
  if (extras.length) console.log(`[enrich] włączone opcje: ${extras.join(", ")}`);
  let lastLog = 0;
  const ds = await enrichItems(itemsFile.items, {
    sources,
    baseDir: itemsFile.baseDir,
    concurrency: o.concurrency ?? 4,
    skip,
    personas: watchlist,
    ner: o.ner ? { provider: getProvider() } : null,
    cloaking: !!o.cloaking,
    ocr: !!o.ocr,
    asr: !!o.asr,
    audio: !!o.audio,
    clip: !!o.clip,
    speaker: !!o.speaker,
    faces: !!o.faces,
    facesOnly: o.facesOnly,
    adLibrary: !!o.adLibrary,
    archiveDir: o.archive === undefined ? DEFAULTS.archive : o.archive,
    archive: archiveStep ? { ...archiveStep, isBlockPage: (texts) => parking.isParked(texts) } : null,
    log: (m) => console.log(`[enrich] ${m}`),
    onProgress: (stage, done, total) => {
      const now = Date.now();
      if (done === total || now - lastLog > 1500) {
        lastLog = now;
        console.log(`[enrich] ${stage}: ${done}/${total}`);
      }
    },
  });
  writeJson(o.out, ds);
  const pages = Object.values(ds.pages);
  const pageErrors = pages.filter((p) => p.fetch.error).length;
  const itemErrors = Object.values(ds.perItem).filter((e) => e.errors.length).length;
  console.log(
    `[enrich] strony: ${pages.length} (błędy: ${pageErrors}), hosty: ${Object.keys(ds.hosts).length}, domeny: ${Object.keys(ds.domains).length}, IP: ${Object.keys(ds.ips).length}, reklamy z błędami: ${itemErrors} -> ${o.out}`,
  );
  const per = Object.values(ds.perItem);
  const cloaked = pages.filter((p) => p.cloaking?.suspected).length;
  console.log(
    `[enrich] persony: ${per.filter((e) => e.personas.length).length} reklam, parametry kampanii: ${per.reduce((n, e) => n + e.campaignParams.length, 0)}, backendy formularzy: ${pages.reduce((n, p) => n + (p.kit?.endpoints.length ?? 0), 0)}${o.cloaking ? `, podejrzenie cloakingu: ${cloaked} stron` : ""}${o.ocr ? `, OCR: ${per.filter((e) => e.ocrText).length}` : ""}${o.asr ? `, ASR: ${per.filter((e) => e.asrText).length}` : ""}${o.audio ? `, odciski audio: ${per.filter((e) => e.audioFp).length}` : ""}${o.clip ? `, CLIP: ${per.filter((e) => e.imageEmbedding).length} obrazów, ${per.filter((e) => e.videoEmbedding).length} wideo` : ""}${o.speaker ? `, głos mówcy: ${per.filter((e) => e.speakerEmbedding).length}` : ""}${o.faces ? `, twarze: ${per.reduce((n, e) => n + (e.faces?.length ?? 0), 0)} (podobne do osób z listy: ${per.filter((e) => e.faces?.some((f) => f.persona)).length} reklam)` : ""}${o.adLibrary ? `, biblioteka reklam: ${per.filter((e) => e.adLibrary?.some((r) => !r.error)).length} reklam (zdjęte przez Metę: ${per.filter((e) => e.adLibrary?.some((r) => r.takenDown)).length})` : ""}`,
  );
  return ds;
}

export interface BuildGraphStepOptions {
  enriched: string;
  graph: string;
  campaigns: string;
  /** Where to write the report of near misses (`near-misses.json`); default: next to `campaigns`. */
  nearMisses?: string;
  config?: string;
  text?: "tfidf" | "embedding" | "none";
}

async function computeEmbeddings(ds: EnrichedDataset): Promise<Record<string, number[]> | null> {
  const cache = createCache({ namespace: "embed", defaultTtlMs: TTL.week * 4 });
  const model = process.env.OLLAMA_EMBED_MODEL || "bge-m3";
  const out: Record<string, number[]> = {};
  const todo: Array<{ id: string; text: string; key: string }> = [];
  for (const item of ds.items) {
    const text = textOf(item, ds);
    if (!text.trim()) continue;
    const key = `${model}:${createHash("sha256").update(text).digest("hex")}`;
    const hit = await cache.get<number[]>(key);
    if (hit) out[item.id] = hit;
    else todo.push({ id: item.id, text, key });
  }
  if (todo.length) {
    const vectors = await embed(todo.map((t) => t.text));
    for (let i = 0; i < todo.length; i++) {
      out[todo[i].id] = vectors[i];
      await cache.set(todo[i].key, vectors[i]);
    }
  }
  return out;
}

/**
 * Copies of one ad inside the dataset (same picture, video, ad ID, page or page body, see materialVerdicts.ts): item
 * nodes of the copies get `duplicateOf: { id, reason }`, so the viewer can stack them. Returns the count.
 */
export async function markDuplicates(graph: EvidenceGraph, ds: EnrichedDataset, enrichedDir: string): Promise<number> {
  const baseDir = path.isAbsolute(ds.baseDir) ? ds.baseDir : existsSync(path.resolve(ds.baseDir)) ? path.resolve(ds.baseDir) : path.resolve(enrichedDir, ds.baseDir);
  const nodes = new Map(graph.nodes.filter((n) => n.type === "item").map((n) => [n.key, n]));
  const traits = ds.items.map((it) => {
    const img = it.imagePath ? (path.isAbsolute(it.imagePath) ? it.imagePath : path.join(baseDir, it.imagePath)) : null;
    return { ...duplicateTraits(it.id, nodes.get(it.id)?.data ?? {}, it.landingUrl ?? ds.perItem[it.id]?.landing?.url ?? null, img, duplicateMedia(ds, it.id)), firstSeen: it.firstSeen };
  });
  const dups = await datasetDuplicates(traits);
  for (const [id, d] of dups) {
    const node = nodes.get(id);
    if (node) node.data.duplicateOf = d;
  }
  return dups.size;
}

export async function runBuildGraph(o: BuildGraphStepOptions): Promise<{ graph: EvidenceGraph; campaigns: CampaignsFile; nearMisses: NearMissesFile }> {
  const ds = readJson<EnrichedDataset>(o.enriched);
  const config = loadLinkConfig(o.config);
  let embeddings: Record<string, number[]> | undefined;
  let textMethod = o.text ?? "tfidf";
  if (textMethod === "embedding") {
    try {
      embeddings = (await computeEmbeddings(ds)) ?? undefined;
      console.log(`[graph] embeddingi: ${Object.keys(embeddings ?? {}).length} tekstów`);
    } catch (e) {
      console.warn(`[graph] embeddingi niedostępne (${(e as Error).message}); używam TF-IDF`);
      textMethod = "tfidf";
    }
  }
  // item pivots feed campaign evolution only; they stay out of graph.json
  const { itemPivots, ...raw } = buildEvidenceGraph(ds, { config, embeddings, textMethod, includeItemPivots: true });
  const clustered = clusterCampaigns(raw, { config });
  const dups = await markDuplicates(clustered.graph, ds, path.dirname(o.enriched));
  if (dups) console.log(`[graph] duplikaty (ta sama reklama zebrana ponownie): ${dups}`);
  const campaigns = clustered.campaigns;
  const labelOf = new Map(raw.nodes.map((n) => [n.id, n.label]));
  const firstSeen = Object.fromEntries(ds.items.map((it) => [it.id, it.firstSeen]));
  for (const c of campaigns.campaigns) if (c.size > 1) c.evolution = campaignEvolution(c.members, itemPivots ?? {}, firstSeen, (id) => labelOf.get(id) ?? id);
  // Clustering used every pair; the written graph keeps each item's strongest links and every link inside a campaign.
  const graph = pruneGraphForOutput(clustered.graph, config.output);
  writeJson(o.graph, graph, false);
  writeJson(o.campaigns, campaigns);
  const nearMissesPath = o.nearMisses ?? path.join(path.dirname(o.campaigns), "near-misses.json");
  writeJson(nearMissesPath, clustered.nearMisses);
  const multi = campaigns.campaigns.filter((c) => c.size > 1);
  console.log(
    `[graph] węzły: ${graph.stats.nodes}, krawędzie: ${graph.stats.edges}, powiązania reklam: ${graph.stats.links} (silne: ${graph.stats.strongLinks}), tekst: ${graph.textMethod}`,
  );
  console.log(`[graph] kampanie (≥2 reklamy): ${multi.length}, pojedyncze reklamy: ${campaigns.campaigns.length - multi.length}, modularność Louvain: ${campaigns.method.louvain.modularity ?? "—"}`);
  for (const c of multi.slice(0, 15)) {
    const ev = c.topEvidence
      .slice(0, 3)
      .map((e) => `${e.type === "similar_image" || e.type === "similar_text" ? "" : `${e.type}: `}${e.label} (${e.count})`)
      .join("; ");
    console.log(`  ${c.id}  ${String(c.size).padStart(3)} reklam  ${c.firstSeen?.slice(0, 10) ?? "?"} – ${c.lastSeen?.slice(0, 10) ?? "?"}  ${ev}`);
  }
  console.log(`[graph] bliskie pary bez połączenia: ${clustered.nearMisses.total} (na liście ${clustered.nearMisses.pairs.length})`);
  console.log(`[graph] zapisano ${o.graph}, ${o.campaigns} i ${nearMissesPath}`);
  return { graph, campaigns, nearMisses: clustered.nearMisses };
}

export interface EvaluateStepOptions {
  graph: string;
  campaigns: string;
}

export interface EvaluateStepResult {
  result: EvalResult | null;
  breakdown: Array<{ label: string; size: number; predicted: Record<string, number> }>;
}

export function runEvaluate(o: EvaluateStepOptions): EvaluateStepResult {
  const graph = readJson<EvidenceGraph>(o.graph);
  const campaigns = readJson<CampaignsFile>(o.campaigns);
  const truth: Record<string, string> = {};
  for (const n of graph.nodes) {
    if (n.type === "item" && typeof n.data.label === "string" && n.data.label) truth[n.key] = n.data.label;
  }
  if (!Object.keys(truth).length) return { result: null, breakdown: [] };
  const result = evaluateClustering(campaigns.assignments, truth);
  const byLabel = new Map<string, Record<string, number>>();
  for (const [item, label] of Object.entries(truth)) {
    const pred = campaigns.assignments[item] ?? "?";
    const m = byLabel.get(label) ?? {};
    m[pred] = (m[pred] ?? 0) + 1;
    byLabel.set(label, m);
  }
  const breakdown = [...byLabel.entries()]
    .map(([label, predicted]) => ({ label, size: Object.values(predicted).reduce((a, b) => a + b, 0), predicted }))
    .sort((a, b) => b.size - a.size || a.label.localeCompare(b.label));
  return { result, breakdown };
}
