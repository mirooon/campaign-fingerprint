/**
 * Result of the weight-sensitivity analysis (types of `sensitivity.json`), its summaries and the
 * Markdown report (`sensitivity.md`). Pure: building the graphs and writing files is lib/pipeline/sensitivity.ts.
 */

/** Scores of one run against the reference labels. */
export interface RunMetrics {
  /** Pairwise precision, recall and F1 (pairs of ads in one campaign), 0–1. */
  precision: number;
  recall: number;
  f1: number;
  /** B-cubed F1, 0–1. */
  bcubedF1: number;
  /** Adjusted Rand Index (1 = identical to the labels). */
  ari: number;
  /** Number of campaigns (clusters, singletons included). */
  clusters: number;
}

/** One run with all weights perturbed at once. */
export interface RandomRun {
  spread: number;
  seed: number;
  metrics: RunMetrics;
  /** Pairs of ads whose "together / apart" state differs from the base run. */
  distance: number;
  /** Pairs of true labels the run newly glued into one campaign ("A|B"). */
  newMerges: string[];
  /** The partition is identical to the base one. */
  identical: boolean;
}

/** One run with a single value (weight or threshold) multiplied by `factor`. */
export interface ShiftRun {
  path: string;
  factor: number;
  from: number;
  to: number;
  metrics: RunMetrics;
  /** Pairwise F1 of the run minus the base F1. */
  deltaF1: number;
  distance: number;
  newMerges: string[];
}

/** Everything that goes to `sensitivity.json`. */
export interface SensitivityResult {
  meta: {
    commit: string;
    date: string;
    /** Items in the enriched file and how many of them were scored (have a reference label). */
    items: number;
    labeled: number;
    seconds: number;
    seed: number;
    runs: number;
    spreads: number[];
    factors: number[];
    thresholdFactors: number[];
  };
  base: RunMetrics;
  random: RandomRun[];
  oneAtATime: ShiftRun[];
  thresholds: ShiftRun[];
}

export interface Range {
  min: number;
  median: number;
  max: number;
}

/** Summary of the runs of one spread (table A). */
export interface SpreadSummary {
  spread: number;
  runs: number;
  precision: Range;
  recall: Range;
  f1: Range;
  bcubedF1: Range;
  ari: Range;
  /** Runs whose partition equals the base one. */
  identical: number;
  maxDistance: number;
  /** Runs that glued at least one new pair of true labels. */
  runsWithNewMerge: number;
}

/** Minimum, median (mean of the two middle values for an even count) and maximum of a non-empty list. */
function range(values: number[]): Range {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return { min: s[0], median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2, max: s[s.length - 1] };
}

/** Table A: min / median / max of each score, per spread (ascending), plus how many runs kept the partition and glued new labels. */
export function summarizeRandom(runs: RandomRun[]): SpreadSummary[] {
  const spreads = [...new Set(runs.map((r) => r.spread))].sort((a, b) => a - b);
  return spreads.map((spread) => {
    const rs = runs.filter((r) => r.spread === spread);
    return {
      spread,
      runs: rs.length,
      precision: range(rs.map((r) => r.metrics.precision)),
      recall: range(rs.map((r) => r.metrics.recall)),
      f1: range(rs.map((r) => r.metrics.f1)),
      bcubedF1: range(rs.map((r) => r.metrics.bcubedF1)),
      ari: range(rs.map((r) => r.metrics.ari)),
      identical: rs.filter((r) => r.identical).length,
      maxDistance: Math.max(...rs.map((r) => r.distance)),
      runsWithNewMerge: rs.filter((r) => r.newMerges.length > 0).length,
    };
  });
}

/**
 * Tables B and C: runs that changed anything, strongest first (most changed pairs, then largest
 * |ΔF1|, then path), and the paths none of whose runs changed a pair or the F1 (listed in one row).
 */
export function impactRows(runs: ShiftRun[]): { ranked: ShiftRun[]; noImpact: string[] } {
  const changed = (r: ShiftRun) => r.distance > 0 || Math.abs(r.deltaF1) > 1e-12;
  const paths = [...new Set(runs.map((r) => r.path))];
  const noImpact = paths.filter((p) => !runs.some((r) => r.path === p && changed(r)));
  const ranked = runs
    .filter(changed)
    .sort((a, b) => b.distance - a.distance || Math.abs(b.deltaF1) - Math.abs(a.deltaF1) || a.path.localeCompare(b.path) || a.factor - b.factor);
  return { ranked, noImpact };
}

/** Score with 4 decimals ("0.8434"). */
const f4 = (x: number) => x.toFixed(4);
/** Factor or weight value without trailing zeros ("0.7"). */
const fx = (x: number) => String(Number(x.toFixed(4)));
/** "min / median / max" cell of table A. */
const triple = (r: Range) => `${f4(r.min)} / ${f4(r.median)} / ${f4(r.max)}`;

/** Markdown table of one-at-a-time runs (B or C); paths without effect go to one closing row. `what` names the first column ("weight", "threshold"). */
function shiftTable(runs: ShiftRun[], what: string, noEffectNote: string): string[] {
  if (!runs.length) return ["No values to examine in this configuration."];
  const { ranked, noImpact } = impactRows(runs);
  const lines = [`| ${what} | value | ΔF1 | changed pairs | new label merges |`, "|---|---|---|---|---|"];
  for (const r of ranked) {
    const sign = r.deltaF1 > 0 ? "+" : "";
    lines.push(`| ${r.path} (×${fx(r.factor)}) | ${fx(r.from)} → ${fx(r.to)} | ${sign}${f4(r.deltaF1)} | ${r.distance} | ${r.newMerges.length} |`);
  }
  if (noImpact.length) lines.push(`| ${noEffectNote}: ${noImpact.length} (${noImpact.join(", ")}) | | 0 | 0 | 0 |`);
  return lines;
}

/** `sensitivity.md`: header (commit, date, number of materials, time) and tables A, B, C. */
export function formatSensitivityMarkdown(r: SensitivityResult): string {
  const { meta } = r;
  const out = [
    "# Weight sensitivity",
    "",
    `- commit: ${meta.commit}`,
    `- date: ${meta.date}`,
    `- samples: ${meta.items} (labelled: ${meta.labeled})`,
    `- time: ${meta.seconds.toFixed(1)} s`,
    `- seed: ${meta.seed}, runs per spread: ${meta.runs}`,
    "",
    `Base run: pair precision ${f4(r.base.precision)}, recall ${f4(r.base.recall)}, F1 ${f4(r.base.f1)}, B-cubed F1 ${f4(r.base.bcubedF1)}, ARI ${f4(r.base.ari)}, campaigns ${r.base.clusters}.`,
    "",
    "## A. Random perturbation of all weights at once",
    "",
    "Each weight × a factor from [1 − s, 1 + s] (clipped to [0, 1]). Cells: min / median / max.",
    "",
    "| spread | runs | pair precision | pair recall | pair F1 | B-cubed F1 | ARI | partition as in base | max. changed pairs | runs with a new merge |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const s of summarizeRandom(r.random)) {
    out.push(`| ±${fx(s.spread)} | ${s.runs} | ${triple(s.precision)} | ${triple(s.recall)} | ${triple(s.f1)} | ${triple(s.bcubedF1)} | ${triple(s.ari)} | ${s.identical} of ${s.runs} | ${s.maxDistance} | ${s.runsWithNewMerge} of ${s.runs} |`);
  }
  out.push("", "## B. One weight at a time", "", `Factors: ${meta.factors.map((f) => `×${fx(f)}`).join(", ")}. Sorted by impact (changed pairs, then |ΔF1|).`, "", ...shiftTable(r.oneAtATime, "weight", "weights without effect"));
  out.push("", "## C. Thresholds one at a time", "", `Factors: ${meta.thresholdFactors.map((f) => `×${fx(f)}`).join(", ") || "—"}.`, "", ...shiftTable(r.thresholds, "threshold", "thresholds without effect"), "");
  return out.join("\n");
}
