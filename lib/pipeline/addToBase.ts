/**
 * "Add to base": puts analysed materials into the base of known campaigns, so that the next analysis sees them (a
 * second material of a new campaign, analysed alone, would otherwise not find the first). One function for the CLI
 * (`analyze-material --add-to-base`), the scheduler (`watch --add-to-base`) and, later, the viewer button.
 *
 * The records and their enrichment are the ones the comparison used (`AnalyzedMaterial`), not computed again. The graph
 * and the campaigns are rebuilt offline from the grown dataset (the same step as `build-graph` in `base`) and the
 * campaigns keep their ids (`keepCampaignIds`). Before a write the files are copied to `<base>/historia/<time>/`, every
 * addition is logged in `<base>/dodane.jsonl`, and files are replaced by rename, so an interrupted write does not
 * leave a half-written base.
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { keepCampaignIds } from "../graph/stableIds";
import type { CampaignsFile, EvidenceGraph } from "../graph/model";
import { findEnriched, mergeDatasets, resolveBaseDir, type AnalyzedMaterial, type MaterialResult, type MaterialVerdict } from "./analyzeMaterial";
import { readJson, runBuildGraph, writeJson } from "./steps";
import type { EnrichedDataset, Item, ItemsFile } from "./types";

export type AddSource = "cli" | "watch" | "gui";

export interface AddToBaseOptions {
  /** Who adds: goes into `dodane.jsonl`. */
  source: AddSource;
  /** Verdicts that are added; default: every one except `duplicate` and (without `force`) `insufficient`. */
  verdicts?: MaterialVerdict[];
  /** Adds a material with too little data (verdict `insufficient`) too. */
  force?: boolean;
  /**
   * Biometric data minimisation: the whole-file voice vector (`speakerEmbedding`) of the added records is NOT written to the
   * base's `enriched.json` (the graph of this addition is still built with it). Cost: a later rebuild of the graph from the
   * base, and a later analysis against it, no longer see a `similar_voice` edge for those records. Default: kept (the
   * graph needs it), see docs/ZGODNOSC.md.
   */
  stripVoiceVectors?: boolean;
  /** Weights of the base; default `<base>/linking.json` when it exists, else the built-in ones. */
  configFile?: string;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface AddToBaseResult {
  added: Array<{ id: string; verdict: MaterialVerdict; campaign: string | null }>;
  /** Not added, with the reason; `duplicateOf` names the record a duplicate repeats. */
  skipped: Array<{ id: string; reason: string; duplicateOf?: string }>;
  /** Ids given to campaigns that had no predecessor (the existing ones keep theirs). */
  createdCampaigns: string[];
  /** Folder with the copy of the files before the change; null when nothing was added. */
  historyDir: string | null;
}

/** Folder (inside the base) with the media of added records. */
const ADDED_MEDIA_DIR = "dodane";
const HISTORY_DIR = "historia";
const LOG_FILE = "dodane.jsonl";

/** Time as a folder name: `2026-11-22T10-00-00Z`. */
const stamp = (d: Date) => `${d.toISOString().slice(0, 19).replace(/:/g, "-")}Z`;

/** Why a verdict is not added, or null when it is. */
function refusal(verdict: MaterialVerdict, o: AddToBaseOptions): string | null {
  if (verdict === "duplicate") return "duplikat materiału już w bazie";
  if (verdict === "insufficient" && !o.force) return "za mało danych do porównania (dodaj z --force, jeśli materiał ma wejść mimo to)";
  if (o.verdicts && !o.verdicts.includes(verdict)) return `werdykt ${verdict} poza listą dopisywanych (${o.verdicts.join(", ")})`;
  return null;
}

/**
 * Copies the files of an added record (screenshots, video) into `<base>/dodane/<id>/` and returns the record with
 * paths relative to the folder the base resolves them against, so the base does not depend on the scratch folder of
 * the analysis. A file that is gone is a note and the path is dropped rather than left dangling.
 */
function adoptMedia(item: Item, importDir: string, baseDir: string, dataDir: string, notes: string[]): Item {
  const dest = path.join(dataDir, ADDED_MEDIA_DIR, item.id.replace(/[^\w.-]+/g, "_"));
  /** Copies one file into the base and returns its path relative to the base folder; null for no file or a missing one. */
  const take = (p: string | null | undefined): string | null => {
    if (!p) return null;
    const from = path.isAbsolute(p) ? p : path.join(importDir, p);
    if (!existsSync(from)) {
      notes.push(`${item.id}: plik ${path.basename(p)} nie istnieje, pominięty`);
      return null;
    }
    mkdirSync(dest, { recursive: true });
    const to = path.join(dest, path.basename(from));
    if (path.resolve(from) !== path.resolve(to)) copyFileSync(from, to);
    return path.relative(baseDir, to);
  };
  return {
    ...item,
    imagePath: take(item.imagePath),
    videoPath: take(item.videoPath),
    ...(item.extraImagePaths ? { extraImagePaths: item.extraImagePaths.map(take).filter((p): p is string => p !== null) } : {}),
    ...(item.extraVideoPaths ? { extraVideoPaths: item.extraVideoPaths.map(take).filter((p): p is string => p !== null) } : {}),
  };
}

/**
 * Copy of the dataset in which the records `ids` carry no whole-file voice vector (everything else is untouched); the
 * input is not modified.
 */
export function withoutVoiceVectors(data: EnrichedDataset, ids: Set<string>): EnrichedDataset {
  const perItem = Object.fromEntries(
    Object.entries(data.perItem).map(([id, e]) => {
      if (!ids.has(id) || !e.speakerEmbedding) return [id, e];
      const { speakerEmbedding: _dropped, ...rest } = e;
      return [id, rest];
    }),
  );
  return { ...data, perItem };
}

/** Writes a file next to its destination and renames it over it: readers see the old or the new file, never half. */
function writeAtomic(file: string, data: unknown): () => void {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, typeof data === "string" ? data : JSON.stringify(data), "utf8");
  return () => renameSync(tmp, file);
}

/**
 * Adds the materials of an analysis to the base in `dataDir` (see the module description). Returns what was added and
 * what was not with the reasons; when nothing is added no file is touched.
 */
export async function addToBase(dataDir: string, analyzed: { result: MaterialResult; captured: AnalyzedMaterial }, opts: AddToBaseOptions): Promise<AddToBaseResult> {
  const log = opts.log ?? (() => undefined);
  const out: AddToBaseResult = { added: [], skipped: [], createdCampaigns: [], historyDir: null };
  const { result, captured } = analyzed;
  const enrichedFile = findEnriched(dataDir);
  if (!enrichedFile) throw new Error(`brak enriched.json w ${dataDir} (ani w work/): to nie jest baza`);
  const base = readJson<EnrichedDataset>(enrichedFile);
  const known = new Set(base.items.map((i) => i.id));
  const items = new Map(captured.items.map((i) => [i.id, i]));

  for (const r of result.items) {
    const why = refusal(r.verdict, opts) ?? (known.has(r.id) ? "rekord o tym id jest już w bazie" : !items.has(r.id) ? "brak danych rekordu z analizy" : null);
    if (why) out.skipped.push({ id: r.id, reason: why, ...(r.duplicateOf ? { duplicateOf: r.duplicateOf.id } : {}) });
    else out.added.push({ id: r.id, verdict: r.verdict, campaign: r.campaign });
  }
  if (!out.added.length) return out;

  const now = opts.now?.() ?? new Date();
  const dir = path.dirname(enrichedFile);
  const baseDir = resolveBaseDir(base.baseDir, dataDir);
  const notes: string[] = [];
  const ids = new Set(out.added.map((a) => a.id));
  const newItems = captured.items.filter((i) => ids.has(i.id)).map((i) => adoptMedia(i, captured.importDir, baseDir, dataDir, notes));
  const extra: EnrichedDataset = { ...captured.enriched, items: newItems, perItem: Object.fromEntries(Object.entries(captured.enriched.perItem).filter(([id]) => ids.has(id))) };
  const grown = mergeDatasets(base, extra);

  // The graph is rebuilt in a scratch folder inside the base (same file system, so the final rename is atomic).
  const scratch = path.join(dataDir, `.dodaj-${process.pid}`);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  try {
    const prevCampaigns = existsSync(path.join(dataDir, "campaigns.json")) ? readJson<CampaignsFile>(path.join(dataDir, "campaigns.json")) : null;
    const prevGraph = existsSync(path.join(dataDir, "graph.json")) ? readJson<EvidenceGraph>(path.join(dataDir, "graph.json")) : null;
    writeJson(path.join(scratch, "enriched.json"), { ...grown, baseDir }, false);
    const configFile = opts.configFile ?? (existsSync(path.join(dataDir, "linking.json")) ? path.join(dataDir, "linking.json") : undefined);
    const built = await runBuildGraph({
      enriched: path.join(scratch, "enriched.json"),
      graph: path.join(scratch, "graph.json"),
      campaigns: path.join(scratch, "campaigns.json"),
      config: configFile,
      text: prevGraph?.textMethod === "none" ? "none" : "tfidf",
    });
    const stable = keepCampaignIds(prevCampaigns, built.campaigns, built.graph);
    out.createdCampaigns = stable.created;
    for (const a of out.added) a.campaign = stable.campaigns.assignments[a.id] ?? null;

    // copy of the previous files, then the replacement of all of them
    const history = path.join(dataDir, HISTORY_DIR, stamp(now));
    mkdirSync(history, { recursive: true });
    const itemsFile = path.join(dir, "items.json");
    const replaced: Array<[string, unknown]> = [
      [enrichedFile, opts.stripVoiceVectors ? withoutVoiceVectors(grown, ids) : grown],
      [path.join(dataDir, "graph.json"), stable.graph],
      [path.join(dataDir, "campaigns.json"), stable.campaigns],
      ...(existsSync(itemsFile) ? ([[itemsFile, { ...readJson<ItemsFile>(itemsFile), items: [...readJson<ItemsFile>(itemsFile).items, ...newItems] }]] as Array<[string, unknown]>) : []),
    ];
    for (const [file] of replaced) if (existsSync(file)) copyFileSync(file, path.join(history, path.basename(file)));
    out.historyDir = history;
    const commits = replaced.map(([file, data]) => writeAtomic(file, data));
    for (const commit of commits) commit();
    appendFileSync(
      path.join(dataDir, LOG_FILE),
      out.added.map((a) => `${JSON.stringify({ ts: now.toISOString(), source: opts.source, id: a.id, verdict: a.verdict })}\n`).join(""),
      "utf8",
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  for (const n of notes) log(n);
  return out;
}
