/**
 * Output pruning: clustering uses every item pair, but the written graph keeps only each item's
 * strongest links (config `output`) so graph.json stays O(n·k) and the viewer stays responsive on
 * real datasets. Links inside a campaign are all kept, by default with all their premises: the campaign card and
 * the evidence pack read graph.json, and a campaign larger than the cap would lose its evidence.
 */
import { DEFAULT_LINK_CONFIG, type LinkConfig } from "./config";
import { isSimilarityEdge, type EvidenceGraph, type ItemLink } from "./model";

export type PruneOptions = Partial<LinkConfig["output"]>;

/**
 * Copy of the graph with the links of each item cut to its `topKPerItem` best by score (premises cut to
 * `maxEvidence`), every link between two items of the same campaign (item nodes' `campaignId`) kept
 * with up to `campaignMaxEvidence` premises (null = all), and the similarity edges of dropped pairs
 * removed. Defaults from DEFAULT_LINK_CONFIG.output.
 */
export function pruneGraphForOutput(graph: EvidenceGraph, opts: PruneOptions = {}): EvidenceGraph {
  const k = opts.topKPerItem ?? DEFAULT_LINK_CONFIG.output.topKPerItem;
  const maxEvidence = opts.maxEvidence ?? DEFAULT_LINK_CONFIG.output.maxEvidence;
  const campaignMaxEvidence = opts.campaignMaxEvidence === undefined ? DEFAULT_LINK_CONFIG.output.campaignMaxEvidence : opts.campaignMaxEvidence;
  const campaignOf = new Map(graph.nodes.filter((n) => n.type === "item" && n.campaignId).map((n) => [n.key, n.campaignId]));
  const inCampaign = (l: ItemLink) => !!campaignOf.get(l.a) && campaignOf.get(l.a) === campaignOf.get(l.b);
  const byItem = new Map<string, ItemLink[]>();
  for (const l of graph.links) {
    for (const id of [l.a, l.b]) {
      const list = byItem.get(id) ?? [];
      list.push(l);
      byItem.set(id, list);
    }
  }
  const keep = new Set<ItemLink>(graph.links.filter(inCampaign));
  for (const list of byItem.values()) {
    list.sort((x, y) => y.score - x.score);
    for (const l of list.slice(0, k)) keep.add(l);
  }
  const links = graph.links
    .filter((l) => keep.has(l))
    .map((l) => ({ ...l, evidence: inCampaign(l) ? l.evidence.slice(0, campaignMaxEvidence ?? undefined) : l.evidence.slice(0, maxEvidence) }));
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
