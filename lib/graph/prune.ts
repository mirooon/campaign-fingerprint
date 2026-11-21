/**
 * Output pruning: clustering uses every item pair, but the written graph keeps only
 * each item's strongest links (plus all strong links inside the item's campaign, up to
 * the cap) so graph.json stays O(n·k) and the viewer stays responsive on real datasets.
 */
import { isSimilarityEdge, type EvidenceGraph, type ItemLink } from "./model";

export interface PruneOptions {
  /** Links kept per item (by score). */
  topKPerItem?: number;
  /** Evidence entries kept per link. */
  maxEvidence?: number;
}

export function pruneGraphForOutput(graph: EvidenceGraph, opts: PruneOptions = {}): EvidenceGraph {
  const k = opts.topKPerItem ?? 12;
  const maxEvidence = opts.maxEvidence ?? 6;
  const byItem = new Map<string, ItemLink[]>();
  for (const l of graph.links) {
    for (const id of [l.a, l.b]) {
      const list = byItem.get(id) ?? [];
      list.push(l);
      byItem.set(id, list);
    }
  }
  const keep = new Set<ItemLink>();
  for (const list of byItem.values()) {
    list.sort((x, y) => y.score - x.score);
    for (const l of list.slice(0, k)) keep.add(l);
  }
  const links = graph.links
    .filter((l) => keep.has(l))
    .map((l) => ({ ...l, evidence: l.evidence.slice(0, maxEvidence) }));
  const keptPairs = new Set(links.map((l) => `${l.a}|${l.b}`));
  // Drop similarity edges whose item pair was pruned (entity edges are always kept).
  const edges = graph.edges.filter((e) => {
    if (!isSimilarityEdge(e.type)) return true;
    const a = e.source.slice("item:".length);
    const b = e.target.slice("item:".length);
    return keptPairs.has(`${a}|${b}`) || keptPairs.has(`${b}|${a}`);
  });
  return {
    ...graph,
    edges,
    links,
    stats: { ...graph.stats, edges: edges.length, links: links.length, strongLinks: links.filter((l) => l.strong).length },
  };
}
