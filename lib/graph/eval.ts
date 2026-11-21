/**
 * Clustering evaluation against ground-truth labels:
 * pairwise precision/recall/F1, B-cubed precision/recall/F1 and the
 * Adjusted Rand Index (Hubert & Arabie). Only items present in both maps are scored.
 */

export interface PairwiseMetrics {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
}

export interface BCubedMetrics {
  precision: number;
  recall: number;
  f1: number;
}

export interface EvalResult {
  n: number;
  predictedClusters: number;
  trueClusters: number;
  pairwise: PairwiseMetrics;
  bcubed: BCubedMetrics;
  ari: number;
}

const choose2 = (k: number) => (k * (k - 1)) / 2;

function f1(p: number, r: number): number {
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}

function groupsOf(labels: Map<string, string>): Map<string, string[]> {
  const g = new Map<string, string[]>();
  for (const [item, label] of labels) {
    const list = g.get(label) ?? [];
    list.push(item);
    g.set(label, list);
  }
  return g;
}

/**
 * @param predicted item id -> predicted cluster id
 * @param truth item id -> ground-truth label (items without a label should be omitted)
 */
export function evaluateClustering(
  predicted: Record<string, string> | Map<string, string>,
  truth: Record<string, string> | Map<string, string>,
): EvalResult {
  const P = predicted instanceof Map ? predicted : new Map(Object.entries(predicted));
  const T = truth instanceof Map ? truth : new Map(Object.entries(truth));
  const pred = new Map<string, string>();
  const gold = new Map<string, string>();
  for (const [item, label] of T) {
    const p = P.get(item);
    if (p === undefined) continue;
    pred.set(item, p);
    gold.set(item, label);
  }
  const n = pred.size;

  // Contingency table
  const contingency = new Map<string, number>();
  const predSizes = new Map<string, number>();
  const goldSizes = new Map<string, number>();
  for (const [item, p] of pred) {
    const t = gold.get(item)!;
    const key = `${p}\u0000${t}`;
    contingency.set(key, (contingency.get(key) ?? 0) + 1);
    predSizes.set(p, (predSizes.get(p) ?? 0) + 1);
    goldSizes.set(t, (goldSizes.get(t) ?? 0) + 1);
  }

  let tp = 0;
  for (const c of contingency.values()) tp += choose2(c);
  let predPairs = 0;
  for (const s of predSizes.values()) predPairs += choose2(s);
  let goldPairs = 0;
  for (const s of goldSizes.values()) goldPairs += choose2(s);
  const fp = predPairs - tp;
  const fn = goldPairs - tp;
  const precision = predPairs === 0 ? 1 : tp / predPairs;
  const recall = goldPairs === 0 ? 1 : tp / goldPairs;

  // B-cubed
  let bp = 0;
  let br = 0;
  const predGroups = groupsOf(pred);
  const goldGroups = groupsOf(gold);
  for (const [item, p] of pred) {
    const t = gold.get(item)!;
    const overlap = contingency.get(`${p}\u0000${t}`)!;
    bp += overlap / predGroups.get(p)!.length;
    br += overlap / goldGroups.get(t)!.length;
  }
  const bcP = n ? bp / n : 1;
  const bcR = n ? br / n : 1;

  // Adjusted Rand Index
  const totalPairs = choose2(n);
  let ari = 1;
  if (totalPairs > 0) {
    const expected = (predPairs * goldPairs) / totalPairs;
    const maxIndex = (predPairs + goldPairs) / 2;
    const denom = maxIndex - expected;
    ari = denom === 0 ? 1 : (tp - expected) / denom;
  }

  return {
    n,
    predictedClusters: predSizes.size,
    trueClusters: goldSizes.size,
    pairwise: { precision, recall, f1: f1(precision, recall), tp, fp, fn },
    bcubed: { precision: bcP, recall: bcR, f1: f1(bcP, bcR) },
    ari,
  };
}

export function formatEval(r: EvalResult): string {
  const pct = (x: number) => x.toFixed(4);
  return [
    `Ocenione reklamy: ${r.n} | kampanie przewidziane: ${r.predictedClusters} | prawdziwe: ${r.trueClusters}`,
    `Pairwise  P=${pct(r.pairwise.precision)} R=${pct(r.pairwise.recall)} F1=${pct(r.pairwise.f1)}  (TP=${r.pairwise.tp} FP=${r.pairwise.fp} FN=${r.pairwise.fn})`,
    `B-cubed   P=${pct(r.bcubed.precision)} R=${pct(r.bcubed.recall)} F1=${pct(r.bcubed.f1)}`,
    `ARI       ${pct(r.ari)}`,
  ].join("\n");
}
