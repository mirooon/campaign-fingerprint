/**
 * Weight-sensitivity run: builds the campaign graph of one enriched file for the base configuration
 * and for perturbed ones (all weights at once with a seed; one weight or threshold at a time), scores
 * each against the reference labels and writes `sensitivity.json` and `sensitivity.md`.
 * The graph is built in the process by the same function as `build-graph` (runBuildGraph), so the
 * numbers are those of the real pipeline. The rules for finding and perturbing the weights are the
 * pure functions of lib/graph/sensitivity.ts.
 */
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { evaluateClustering } from "../graph/eval";
import type { LinkConfig } from "../graph/config";
import { newLabelMerges, partitionDistance, perturbWeights, scalePath, thresholdPaths, weightPaths, getPath } from "../graph/sensitivity";
import { formatSensitivityMarkdown, type RandomRun, type RunMetrics, type SensitivityResult, type ShiftRun } from "./sensitivityReport";
import type { CampaignsFile } from "../graph/model";
import type { EnrichedDataset } from "./types";
import { loadLinkConfig, readJson, runBuildGraph, writeJson } from "./steps";

export interface SensitivityOptions {
  /** Enriched file of the run (items, with their `label` as the reference campaign). */
  enriched: string;
  /** Linking-weights file (as `build-graph --config`); undefined = built-in defaults. */
  config?: string;
  /** Reference labels (case → label) laid over the items' own `label`; undefined = items' labels only. */
  labels?: Record<string, string>;
  /** Runs per spread, seeds are `seed … seed + runs − 1`. */
  runs: number;
  spreads: number[];
  seed: number;
  /** Factors for the one-at-a-time weight experiment (B). */
  factors: number[];
  /** Factors for the threshold experiment (C). */
  thresholdFactors: number[];
  /** Text similarity method, as `build-graph --text`. */
  text?: "tfidf" | "embedding" | "none";
  outDir: string;
}

/** Current short commit of the repository the process runs in, or "unknown" when git is not available. */
function currentCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (e) {
    return `unknown (${(e as Error).message.split("\n")[0]})`;
  }
}

/** Reference label of every item: its own `label`, overlaid with the labels file (case → label, or label → cases). */
export function truthOf(ds: EnrichedDataset, labels: Record<string, string> | undefined): Record<string, string> {
  const truth: Record<string, string> = {};
  for (const it of ds.items) if (it.label) truth[it.id] = it.label;
  const ids = new Set(ds.items.map((it) => it.id));
  for (const [id, label] of Object.entries(labels ?? {})) if (ids.has(id)) truth[id] = label;
  return truth;
}

/** Scores of a partition against the labels (see RunMetrics). */
function metricsOf(assignments: Record<string, string>, truth: Record<string, string>): RunMetrics {
  const r = evaluateClustering(assignments, truth);
  return { precision: r.pairwise.precision, recall: r.pairwise.recall, f1: r.pairwise.f1, bcubedF1: r.bcubed.f1, ari: r.ari, clusters: r.predictedClusters };
}

/**
 * Runs the analysis (see the module comment) and writes `sensitivity.json` and `sensitivity.md` to
 * `outDir`; returns the same result. Intermediate graphs go to `<outDir>/tmp` and are removed.
 */
export async function runSensitivity(o: SensitivityOptions): Promise<SensitivityResult> {
  const started = Date.now();
  const ds = readJson<EnrichedDataset>(o.enriched);
  const truth = truthOf(ds, o.labels);
  const base = loadLinkConfig(o.config);
  const tmp = path.join(o.outDir, "tmp");
  mkdirSync(tmp, { recursive: true });

  /** Builds the graph for `config` (the pipeline step logs a page of text per run; silenced) and returns item → campaign. */
  async function partitionFor(config: LinkConfig): Promise<Record<string, string>> {
    const file = path.join(tmp, "config.json");
    // replaceLists: the file holds the complete configuration, so its lists must replace the defaults, not extend them
    writeJson(file, { ...config, replaceLists: true }, false);
    const log = console.log;
    console.log = () => undefined;
    let built: { campaigns: CampaignsFile };
    try {
      built = await runBuildGraph({ enriched: o.enriched, graph: path.join(tmp, "graph.json"), campaigns: path.join(tmp, "campaigns.json"), config: file, text: o.text });
    } finally {
      console.log = log;
    }
    return built.campaigns.assignments;
  }

  const basePartition = await partitionFor(base);
  const baseMetrics = metricsOf(basePartition, truth);
  const cache = new Map<string, { metrics: RunMetrics; partition: Record<string, string> }>();

  /** Compares a partition with the base one. */
  const compare = (partition: Record<string, string>) => ({
    distance: partitionDistance(basePartition, partition),
    newMerges: newLabelMerges(basePartition, partition, truth),
  });

  /** One-at-a-time run for each path and factor; a factor that leaves the value unchanged is not run (the result would equal the base). */
  async function shiftRuns(paths: string[], factors: number[]): Promise<ShiftRun[]> {
    const out: ShiftRun[] = [];
    for (const p of paths) {
      for (const factor of factors) {
        const config = scalePath(base, p, factor);
        const from = getPath(base, p);
        const to = getPath(config, p);
        if (to === from) {
          out.push({ path: p, factor, from, to, metrics: baseMetrics, deltaF1: 0, distance: 0, newMerges: [] });
          continue;
        }
        const key = `${p}=${to}`;
        let hit = cache.get(key);
        if (!hit) {
          const partition = await partitionFor(config);
          hit = { metrics: metricsOf(partition, truth), partition };
          cache.set(key, hit);
        }
        out.push({ path: p, factor, from, to, metrics: hit.metrics, deltaF1: hit.metrics.f1 - baseMetrics.f1, ...compare(hit.partition) });
      }
    }
    return out;
  }

  const random: RandomRun[] = [];
  for (const spread of o.spreads) {
    for (let seed = o.seed; seed < o.seed + o.runs; seed++) {
      const partition = await partitionFor(perturbWeights(base, { spread, seed }));
      const cmp = compare(partition);
      random.push({ spread, seed, metrics: metricsOf(partition, truth), distance: cmp.distance, newMerges: cmp.newMerges, identical: cmp.distance === 0 });
    }
  }
  const oneAtATime = await shiftRuns(weightPaths(base), o.factors);
  const thresholds = await shiftRuns(thresholdPaths(base), o.thresholdFactors);

  const result: SensitivityResult = {
    meta: {
      commit: currentCommit(),
      date: new Date().toISOString(),
      items: ds.items.length,
      labeled: ds.items.filter((it) => it.id in truth).length,
      seconds: (Date.now() - started) / 1000,
      seed: o.seed,
      runs: o.runs,
      spreads: o.spreads,
      factors: o.factors,
      thresholdFactors: o.thresholdFactors,
    },
    base: baseMetrics,
    random,
    oneAtATime,
    thresholds,
  };
  rmSync(tmp, { recursive: true, force: true });
  writeJson(path.join(o.outDir, "sensitivity.json"), result);
  writeFileSync(path.join(o.outDir, "sensitivity.md"), formatSensitivityMarkdown(result), "utf8");
  return result;
}
