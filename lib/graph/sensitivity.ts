/**
 * Weight sensitivity analysis: pure helpers that find the weights and thresholds of a linking
 * configuration by the NAMES of its fields (so weights added later are covered without edits),
 * perturb them (all at once with a seeded generator, or one at a time) and compare two partitions
 * into campaigns. Building the graph and reading files stay in lib/pipeline/sensitivity.ts.
 *
 * Weights are set by hand as priorities from research and are not learned from labels (too few
 * labels, and some were assigned from the very traces the tool uses). This module therefore only
 * measures how far the result moves when the numbers move; it never tunes them.
 */
import type { LinkConfig } from "./config";

/** A path to a number in the configuration, keys joined with dots ("similarity.dom.weight"). */
export type ConfigPath = string;

/** Fields of the configuration that are thresholds, by key name (they are tested separately from weights). */
const THRESHOLD_KEY = /^(strongThreshold|minLinkScore|minCosine|clipMinCosine|minSimilarity|tfidfThreshold|embeddingThreshold|hamming|imageHamming)$/;

/** Distances counted in whole bits: a scaled value is rounded, since a fractional Hamming distance means nothing. */
const INTEGER_KEY = /hamming$/i;

type Tree = { [key: string]: unknown };

/** True for a plain object (not null, not an array): the only kind of node the walker descends into. */
function isTree(v: unknown): v is Tree {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Every numeric leaf of the configuration as [path, value]; arrays (rule lists) are not entered. */
function numericLeaves(node: Tree, prefix: string[] = []): Array<[string[], number]> {
  const out: Array<[string[], number]> = [];
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === "number") out.push([[...prefix, k], v]);
    else if (isTree(v)) out.push(...numericLeaves(v, [...prefix, k]));
  }
  return out;
}

/**
 * Whether a path names a weight: an entry of `typeWeights`, or a field called `weight` or ending in
 * `Weight`, except minimum levels (the name contains "Min", e.g. `discountedMinWeight`): those are
 * thresholds on a weight, not weights. A rule by name, so a weight added to the config later is found too.
 */
function isWeightPath(path: string[]): boolean {
  const key = path[path.length - 1];
  if (key.includes("Min")) return false;
  return path.length === 2 && path[0] === "typeWeights" ? true : key === "weight" || key.endsWith("Weight");
}

/** Whether a path names a threshold (see THRESHOLD_KEY). */
function isThresholdPath(path: string[]): boolean {
  return THRESHOLD_KEY.test(path[path.length - 1]);
}

/**
 * Paths of the weights to perturb: every `typeWeights.<type>` greater than 0 and every other numeric
 * field called `weight` or ending in `Weight` (greater than 0), except minimum levels (see isWeightPath).
 * A zero weight is left out: scaling it changes nothing.
 */
export function weightPaths(config: LinkConfig): ConfigPath[] {
  return numericLeaves(config as unknown as Tree)
    .filter(([p, v]) => v > 0 && isWeightPath(p))
    .map(([p]) => p.join("."));
}

/**
 * Paths of the thresholds for the separate experiment: `strongThreshold`, `minLinkScore` and the
 * similarity cut-offs (`minCosine`, `clipMinCosine`, `minSimilarity`, `tfidfThreshold`,
 * `embeddingThreshold`, `hamming`, `imageHamming`), found by name anywhere in the configuration.
 */
export function thresholdPaths(config: LinkConfig): ConfigPath[] {
  return numericLeaves(config as unknown as Tree)
    .filter(([p]) => isThresholdPath(p))
    .map(([p]) => p.join("."));
}

/** The number at `path`, or throws when the path does not lead to a number (a typo must not pass silently). */
export function getPath(config: LinkConfig, path: ConfigPath): number {
  let node: unknown = config;
  for (const k of path.split(".")) node = isTree(node) ? node[k] : undefined;
  if (typeof node !== "number") throw new Error(`path ${path} does not point to a number in the configuration`);
  return node;
}

/** Copy of the configuration with the number at `path` replaced (the original stays untouched). */
function withValue(config: LinkConfig, path: ConfigPath, value: number): LinkConfig {
  getPath(config, path);
  const copy = structuredClone(config);
  const keys = path.split(".");
  let node = copy as unknown as Tree;
  for (const k of keys.slice(0, -1)) node = node[k] as Tree;
  node[keys[keys.length - 1]] = value;
  return copy;
}

/** Brings a scaled value back into its range: weights into [0, 1], Hamming distances to whole bits, other thresholds only above 0. */
function fit(path: string[], value: number): number {
  if (isWeightPath(path)) return Math.min(1, Math.max(0, value));
  return Math.max(0, INTEGER_KEY.test(path[path.length - 1]) ? Math.round(value) : value);
}

/**
 * Configuration with one value multiplied by `factor` (the one-at-a-time experiment). A weight is
 * clamped to [0, 1]; a threshold is not clamped to 1 (above 1 a cosine cut-off simply never fires),
 * and a Hamming distance is rounded to whole bits. Throws when `path` is not a number.
 */
export function scalePath(config: LinkConfig, path: ConfigPath, factor: number): LinkConfig {
  return withValue(config, path, fit(path.split("."), getPath(config, path) * factor));
}

/** Deterministic uniform generator in [0, 1) from a 32-bit seed (mulberry32); the same seed always gives the same sequence. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Configuration with every weight (see weightPaths) multiplied by its own factor drawn uniformly from
 * [1 − spread, 1 + spread] and clamped to [0, 1]. Thresholds, lists and zero weights stay as they were.
 * The same seed gives the same configuration (the order of paths follows the configuration), so a run
 * can be reproduced from `seed` and `spread` alone; spread 0 returns an equal copy.
 */
export function perturbWeights(config: LinkConfig, o: { spread: number; seed: number }): LinkConfig {
  const rand = seededRandom(o.seed);
  let out = structuredClone(config);
  for (const path of weightPaths(config)) {
    const factor = 1 - o.spread + 2 * o.spread * rand();
    out = withValue(out, path, fit(path.split("."), getPath(config, path) * factor));
  }
  return out;
}

/** Number of unordered pairs in a group of `k`. */
const pairs = (k: number) => (k * (k - 1)) / 2;

/** Sum of `pairs` over the sizes in a count map. */
function pairTotal(counts: Map<string, number>): number {
  let s = 0;
  for (const c of counts.values()) s += pairs(c);
  return s;
}

/**
 * Number of pairs of items whose state "together / apart" differs between two partitions into
 * campaigns (item → campaign id; ids may be named differently in the two). Only items present in
 * both are compared. 0 means the same partition. Computed as pairs(a) + pairs(b) − 2·pairs(a∩b).
 */
export function partitionDistance(a: Record<string, string>, b: Record<string, string>): number {
  const inA = new Map<string, number>();
  const inB = new Map<string, number>();
  const both = new Map<string, number>();
  for (const [item, ca] of Object.entries(a)) {
    const cb = b[item];
    if (cb === undefined) continue;
    inA.set(ca, (inA.get(ca) ?? 0) + 1);
    inB.set(cb, (inB.get(cb) ?? 0) + 1);
    const cell = `${ca}\u0000${cb}`;
    both.set(cell, (both.get(cell) ?? 0) + 1);
  }
  return pairTotal(inA) + pairTotal(inB) - 2 * pairTotal(both);
}

/** Pairs of distinct true labels that share at least one cluster of the partition, as "X|Y" with X < Y. */
function gluedLabels(partition: Record<string, string>, truth: Record<string, string>): Set<string> {
  const byCluster = new Map<string, Set<string>>();
  for (const [item, cluster] of Object.entries(partition)) {
    const label = truth[item];
    if (label === undefined) continue;
    const set = byCluster.get(cluster) ?? new Set<string>();
    set.add(label);
    byCluster.set(cluster, set);
  }
  const out = new Set<string>();
  for (const labels of byCluster.values()) {
    const sorted = [...labels].sort();
    for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) out.add(`${sorted[i]}|${sorted[j]}`);
  }
  return out;
}

/**
 * Pairs of true labels (campaigns of the reference labelling) that `other` puts in one cluster and
 * `base` does not: a new wrong merge of two campaigns caused by the changed configuration. Sorted
 * "X|Y"; empty when `other` merges nothing new (splits do not count).
 */
export function newLabelMerges(base: Record<string, string>, other: Record<string, string>, truth: Record<string, string>): string[] {
  const before = gluedLabels(base, truth);
  return [...gluedLabels(other, truth)].filter((p) => !before.has(p)).sort();
}
