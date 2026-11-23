/**
 * explain(a, b): why two ads are (or are not) in the same campaign.
 * Pure and dependency-free (no graphology), so the viewer can run it in the browser.
 */
import { DEFAULT_LINK_CONFIG, type LinkConfig } from "./config";
import type { EvidenceGraph, ItemLink, PairEvidence } from "./model";

export interface ExplainStep {
  from: string;
  to: string;
  score: number;
  evidence: PairEvidence[];
}

export interface Explanation {
  a: string;
  b: string;
  sameCampaign: boolean;
  /** Direct evidence between a and b (shared entities, similarity). */
  direct: PairEvidence[];
  directScore: number;
  /** Strongest chain of item-item links connecting a and b (when not directly linked). */
  path: ExplainStep[];
  summary: string;
}

/**
 * Explains why two items are (or are not) in the same campaign: direct shared
 * evidence with node paths, otherwise the strongest chain of links (maximises the
 * product of link scores, i.e. Dijkstra on -log(score)).
 */
export function explain(graph: EvidenceGraph, a: string, b: string, config: LinkConfig = DEFAULT_LINK_CONFIG): Explanation {
  const nodeA = graph.nodes.find((nd) => nd.id === `item:${a}`);
  const nodeB = graph.nodes.find((nd) => nd.id === `item:${b}`);
  const sameCampaign = !!nodeA?.campaignId && nodeA.campaignId === nodeB?.campaignId;
  const directLink = graph.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
  const direct = directLink?.evidence ?? [];
  let path: ExplainStep[] = [];
  if (!directLink || directLink.score < config.minLinkScore) {
    path = strongestPath(graph.links, a, b, config.minLinkScore);
  }
  const summary = directLink
    ? `Direct evidence (score ${directLink.score.toFixed(2)}): ${direct
        .slice(0, 3)
        .map((e) => e.evidence)
        .join("; ")}`
    : path.length
      ? `No direct evidence; a chain of ${path.length} link${path.length === 1 ? "" : "s"} through: ${path.map((s) => s.to).slice(0, -1).join(", ") || "—"}`
      : "No evidence links these ads.";
  return { a, b, sameCampaign, direct, directScore: directLink?.score ?? 0, path, summary };
}

function strongestPath(links: ItemLink[], a: string, b: string, minScore: number): ExplainStep[] {
  const adj = new Map<string, ItemLink[]>();
  for (const l of links) {
    if (l.score < minScore && !l.strong) continue;
    for (const x of [l.a, l.b]) {
      const list = adj.get(x) ?? [];
      list.push(l);
      adj.set(x, list);
    }
  }
  const dist = new Map<string, number>([[a, 0]]);
  const prev = new Map<string, ItemLink>();
  const done = new Set<string>();
  while (true) {
    let cur: string | null = null;
    let best = Infinity;
    for (const [node, d] of dist) if (!done.has(node) && d < best) [cur, best] = [node, d];
    if (cur === null || cur === b) break;
    done.add(cur);
    for (const l of adj.get(cur) ?? []) {
      const other = l.a === cur ? l.b : l.a;
      const w = -Math.log(Math.max(1e-6, Math.min(1, l.score)));
      if (best + w < (dist.get(other) ?? Infinity)) {
        dist.set(other, best + w);
        prev.set(other, l);
      }
    }
  }
  if (!prev.has(b)) return [];
  const steps: ExplainStep[] = [];
  let cur = b;
  while (cur !== a) {
    const l = prev.get(cur)!;
    const from = l.a === cur ? l.b : l.a;
    steps.unshift({ from, to: cur, score: l.score, evidence: l.evidence.slice(0, 3) });
    cur = from;
  }
  return steps;
}
