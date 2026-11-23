/**
 * `base`: builds a base of known campaigns from a folder of cases (import-cases -> ingest -> enrich ->
 * build-graph), so that `analyze-material --data <base>` and the viewer have something to compare new
 * material with. Works without the network (the cases are read as recorded captures) and says which
 * steps it skipped and why. No team labels unless a labels file is given.
 */
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { detectAsr } from "../media/asr";
import { detectFpcalc } from "../media/audioFp";
import { detectClip } from "../media/imageEmbed";
import { detectOcr } from "../media/ocr";
import { ctLexiconFile, lexiconFromGraph } from "../ct/lexiconFromBase";
import type { EvidenceGraph } from "../graph/model";
import { importCases } from "./caseImport";
import { liveLookups } from "./liveLookups";
import { readJson, runBuildGraph, runEnrich, runIngest, writeJson } from "./steps";

export type BaseStepName = "import-cases" | "lookups" | "ingest" | "enrich" | "ocr" | "asr" | "audio" | "clip" | "build-graph" | "ct-lexicon";

export interface BaseStep {
  step: BaseStepName;
  status: "ok" | "skipped";
  /** Why the step did not run (always set when skipped). */
  reason?: string;
  /** What the step did, for the log. */
  detail?: string;
}

export interface ToolAvailability {
  available: boolean;
  reason: string | null;
}

export interface MediaAvailability {
  ocr: ToolAvailability;
  asr: ToolAvailability;
  audio: ToolAvailability;
  clip: ToolAvailability;
}

export interface BaseOptions {
  /** Folder with one sub-folder per case. */
  casesDir: string;
  /** Folder of the base (graph.json, campaigns.json, enriched.json, input.json, items.json, fixtures/, base.json). */
  outDir: string;
  /** No network: import-cases without lookups (RDAP, DNS, ASN only from the captures). */
  offline?: boolean;
  /** Weights file; without it the built-in `DEFAULT_LINK_CONFIG`. */
  config?: string;
  /** JSON `{ "<label>": ["<record id>", ...] }` with reference campaigns; labels are optional and only used by `evaluate`. */
  labels?: string;
  /** Media tool detection (replaceable in tests). */
  detect?: () => Promise<MediaAvailability>;
  log?: (message: string) => void;
}

export interface BaseResult {
  version: 1;
  generatedAt: string;
  offline: boolean;
  cases: number;
  steps: BaseStep[];
  /** Weights file in use, null = built-in defaults. */
  configFile: string | null;
  /** Reasons cases were left out of the base. */
  skippedCases: Array<{ id: string; reason: string }>;
}

/** Detects which media tools and models work here; the CLIP check loads the local model (no download when HF_HUB_OFFLINE=1). */
export async function detectMedia(): Promise<MediaAvailability> {
  const [ocr, asr, fpcalc, clip] = await Promise.all([detectOcr(), detectAsr(), detectFpcalc(), detectClip()]);
  return {
    ocr: { available: ocr.available, reason: ocr.reason },
    asr: { available: asr.available, reason: asr.reason },
    audio: { available: fpcalc.available, reason: fpcalc.available ? null : "fpcalc (chromaprint) unavailable" },
    clip: { available: clip.available, reason: clip.reason },
  };
}

/**
 * Turns tool availability into the enrich switches and the matching step records: an unavailable tool is
 * not enabled and is reported as `skipped` with its reason, never dropped silently.
 */
export function mediaPlan(av: MediaAvailability): { enrich: { ocr: boolean; asr: boolean; audio: boolean; clip: boolean }; steps: BaseStep[] } {
  const names = ["ocr", "asr", "audio", "clip"] as const;
  const steps = names.map((step): BaseStep => (av[step].available ? { step, status: "ok" } : { step, status: "skipped", reason: av[step].reason ?? "tool unavailable" }));
  return { enrich: { ocr: av.ocr.available, asr: av.asr.available, audio: av.audio.available, clip: av.clip.available }, steps };
}

/**
 * Adds `ref_label` to the records listed in a labels file (`{label: [id, ...]}`); keys starting with `_`
 * are notes. Records without a label are returned unchanged.
 */
export function applyLabels<T extends { id: string }>(rows: T[], labels: Record<string, string[]>): Array<T & { ref_label?: string }> {
  const byId = new Map<string, string>();
  for (const [label, ids] of Object.entries(labels)) {
    if (label.startsWith("_") || !Array.isArray(ids)) continue;
    for (const id of ids) byId.set(id, label);
  }
  return rows.map((r) => (byId.has(r.id) ? { ...r, ref_label: byId.get(r.id) } : r));
}

/** Runs the whole base build on disk and writes `base.json` with the status of every step. */
export async function runBase(o: BaseOptions): Promise<BaseResult> {
  const log = o.log ?? ((m: string) => console.log(m));
  const out = path.resolve(o.outDir);
  const p = (f: string) => path.join(out, f);
  const steps: BaseStep[] = [];

  const imp = await importCases({ casesDir: o.casesDir, outDir: out, lookups: o.offline ? undefined : liveLookups(false), log });
  if (!imp.cases.length) throw new Error(`no cases in ${o.casesDir} (each case is a subfolder with a saved page, a HAR, a screenshot or a video)`);
  steps.push({ step: "import-cases", status: "ok", detail: `cases: ${imp.cases.length}, skipped: ${imp.skipped.length}` });
  steps.push(
    o.offline
      ? { step: "lookups", status: "skipped", reason: "offline mode: no DNS, RDAP or ASN queries (only what the saved samples hold)" }
      : { step: "lookups", status: "ok", detail: imp.failedLookups.length ? `no answer: ${imp.failedLookups.join(", ")}` : "all answered" },
  );

  let input = p("input.json");
  let mapping = p("mapping.json");
  if (o.labels) {
    const rows = applyLabels(readJson<Array<{ id: string }>>(input), readJson<Record<string, string[]>>(o.labels));
    writeJson(p("input-labeled.json"), rows);
    writeJson(p("mapping-labeled.json"), { ...readJson<object>(mapping), label: "ref_label" });
    input = p("input-labeled.json");
    mapping = p("mapping-labeled.json");
  }
  runIngest({ input, mapping, out: p("items.json"), baseDir: out });
  steps.push({ step: "ingest", status: "ok" });

  const plan = mediaPlan(await (o.detect ?? detectMedia)());
  await runEnrich({ items: p("items.json"), out: p("enriched.json"), offline: true, fixtures: p("fixtures"), archive: p("archive"), ...plan.enrich });
  steps.push({ step: "enrich", status: "ok", detail: "from recorded responses (fixtures)" }, ...plan.steps);

  const configFile = o.config ?? (process.env.LINK_CONFIG || null);
  await runBuildGraph({ enriched: p("enriched.json"), graph: p("graph.json"), campaigns: p("campaigns.json"), config: configFile ?? undefined, text: "tfidf" });
  // The analysis of new material reads `<base>/linking.json`, so it uses the weights the base was built with.
  if (configFile && existsSync(configFile) && path.resolve(configFile) !== p("linking.json")) copyFileSync(configFile, p("linking.json"));
  steps.push({ step: "build-graph", status: "ok", detail: configFile ? `weights: ${configFile}` : "built-in weights (DEFAULT_LINK_CONFIG)" });
  // The CT watchers (ct:watch, ct:backfill, watch) read the brands of this base from <base>/ct-lexicon.json.
  const brands = lexiconFromGraph(readJson<EvidenceGraph>(p("graph.json"))).brands;
  writeJson(p("ct-lexicon.json"), ctLexiconFile(brands, new Date()));
  steps.push({ step: "ct-lexicon", status: "ok", detail: `brands and lander names from the base: ${brands.length}` });

  const result: BaseResult = { version: 1, generatedAt: new Date().toISOString(), offline: !!o.offline, cases: imp.cases.length, steps, configFile, skippedCases: imp.skipped };
  writeJson(p("base.json"), result);
  for (const s of steps) log(`[base] ${s.step}: ${s.status}${s.reason ? ` (${s.reason})` : s.detail ? ` (${s.detail})` : ""}`);
  return result;
}
