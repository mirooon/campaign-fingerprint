/**
 * Reduced graph for the analyst (B-031): nodes are campaigns and the traces they share, ads are folded into their
 * campaign and unfold on a click; a trace unfolds into the other campaigns that hold it. It can also start from one
 * material and grow: material → its campaign and traces → other campaigns → ... Pure: returns plain nodes and edges
 * (no colours, no Cytoscape), the component draws them.
 */
import type { Campaign, EntityType, EvidenceGraph } from "@/lib/graph/model";
import { adjacency, MATRIX_SKIP_TYPES, reachable } from "./evolution";

type Graph = Pick<EvidenceGraph, "nodes" | "edges">;

/** Traces drawn per campaign when no limit is given: enough to read, few enough not to bury the campaigns. */
export const DEFAULT_MAX_TRACES = 6;

export interface ReducedNode {
  id: string;
  kind: "campaign" | "trace" | "item";
  label: string;
  /** Materials of a campaign, holders of a trace, 1 for a material: the node's size. */
  size: number;
  /** Entity type of a trace; absent for campaigns and materials. */
  type?: EntityType;
  campaignId?: string;
  weight: number | null;
  strong: boolean;
  /** A click unfolds it: a campaign into its materials, a trace into the other campaigns that hold it. */
  expandable: boolean;
}

export interface ReducedEdge {
  id: string;
  source: string;
  target: string;
  /** Share of the campaign's materials that hold the trace (campaign–trace), 1 for the others. */
  weight: number;
}

export interface ReducedGraph {
  nodes: ReducedNode[];
  edges: ReducedEdge[];
}

export interface ReducedOptions {
  /** Ids of unfolded nodes: `campaign:K01` shows its materials, `tracker:…` brings in the other campaigns holding the trace. */
  expanded: Set<string>;
  /** Material (item key) the graph grows from; without it every campaign of two or more materials is drawn. */
  seed?: string;
  /** Traces drawn per campaign (strongest first). */
  maxTraces?: number;
}

interface TraceIndex {
  /** trace node id → item keys that hold it. */
  holders: Map<string, Set<string>>;
  /** item key → campaign id. */
  campaignOf: Map<string, string | null>;
}

const cache = new WeakMap<Graph["nodes"], TraceIndex>();

/** Which materials hold which trace (cached per graph): a trace is a non-item node reachable from the material, outbound links aside. */
function traceIndex(graph: Graph): TraceIndex {
  const hit = cache.get(graph.nodes);
  if (hit) return hit;
  const out = adjacency(graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const holders = new Map<string, Set<string>>();
  const campaignOf = new Map<string, string | null>();
  for (const n of graph.nodes) {
    if (n.type !== "item") continue;
    campaignOf.set(n.key, n.campaignId);
    for (const id of reachable(n.id, out)) {
      const t = byId.get(id);
      if (!t || MATRIX_SKIP_TYPES.has(t.type) || t.discounts.length > 0) continue;
      const set = holders.get(id) ?? new Set<string>();
      set.add(n.key);
      holders.set(id, set);
    }
  }
  const built = { holders, campaignOf };
  cache.set(graph.nodes, built);
  return built;
}

/** Campaigns (ids) that hold a trace. */
function campaignsHolding(idx: TraceIndex, traceId: string): Set<string> {
  const ids = new Set<string>();
  for (const item of idx.holders.get(traceId) ?? []) {
    const c = idx.campaignOf.get(item);
    if (c) ids.add(c);
  }
  return ids;
}

/**
 * The reduced graph for the given unfolding state. Drawn campaigns: those of two or more materials (or, with a
 * seed, the seed's campaign), plus the campaigns holding an unfolded trace. Per campaign the strongest shared
 * traces (held by two of its materials or by another campaign too; discounted traces never) up to `maxTraces`, and
 * every unfolded trace. An unfolded campaign adds its materials with an edge to each trace they hold.
 */
export function reducedGraph(graph: Graph, campaigns: Campaign[], opts: ReducedOptions): ReducedGraph {
  const idx = traceIndex(graph);
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
  const maxTraces = opts.maxTraces ?? DEFAULT_MAX_TRACES;

  const visible = new Set<string>();
  if (opts.seed) {
    const own = idx.campaignOf.get(opts.seed);
    if (own) visible.add(own);
  } else {
    for (const c of campaigns) if (c.size >= 2) visible.add(c.id);
  }
  for (const id of opts.expanded) if (idx.holders.has(id)) for (const c of campaignsHolding(idx, id)) visible.add(c);

  const nodes = new Map<string, ReducedNode>();
  const edges: ReducedEdge[] = [];
  for (const cid of visible) {
    const c = campaignById.get(cid);
    if (!c) continue;
    const members = new Set(c.members);
    // candidate traces of this campaign, strongest first
    const candidates = [...idx.holders]
      .map(([id, holders]) => {
        const inside = [...holders].filter((m) => members.has(m)).length;
        const outside = holders.size - inside;
        return { id, inside, outside };
      })
      .filter((t) => t.inside > 0 && (t.inside >= 2 || t.outside > 0))
      .sort((a, b) => {
        const na = nodeById.get(a.id)!;
        const nb = nodeById.get(b.id)!;
        return Number(nb.strong) - Number(na.strong) || (nb.weight ?? 0) - (na.weight ?? 0) || b.inside - a.inside || na.label.localeCompare(nb.label);
      });
    const shown = candidates.slice(0, maxTraces);
    for (const t of candidates.slice(maxTraces)) if (opts.expanded.has(t.id)) shown.push(t);
    nodes.set(`campaign:${cid}`, { id: `campaign:${cid}`, kind: "campaign", label: cid, size: c.size, campaignId: cid, weight: null, strong: false, expandable: true });
    for (const t of shown) {
      const tn = nodeById.get(t.id)!;
      const all = idx.holders.get(t.id)!;
      nodes.set(t.id, { id: t.id, kind: "trace", label: tn.label, size: all.size, type: tn.type, weight: tn.weight, strong: tn.strong, expandable: campaignsHolding(idx, t.id).size > 1 });
      edges.push({ id: `campaign:${cid}|${t.id}`, source: `campaign:${cid}`, target: t.id, weight: Math.min(1, t.inside / Math.max(1, c.size)) });
    }
    if (opts.expanded.has(`campaign:${cid}`)) {
      for (const m of c.members) {
        nodes.set(`item:${m}`, { id: `item:${m}`, kind: "item", label: m, size: 1, campaignId: cid, weight: null, strong: false, expandable: false });
        edges.push({ id: `campaign:${cid}|item:${m}`, source: `campaign:${cid}`, target: `item:${m}`, weight: 1 });
        for (const t of shown) if (idx.holders.get(t.id)?.has(m)) edges.push({ id: `item:${m}|${t.id}`, source: `item:${m}`, target: t.id, weight: 1 });
      }
    }
  }
  return { nodes: [...nodes.values()], edges };
}
