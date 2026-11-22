/**
 * Pure helpers that turn the evidence graph into what the viewer shows:
 * which nodes are visible for a filter, Cytoscape element definitions, and
 * per-node look-ups (who shares an entity, an item's links).
 */
import type { ElementDefinition } from "cytoscape";
import { isSimilarityEdge, type CampaignsFile, type EvidenceGraph, type GraphEdge, type GraphNode, type ItemLink } from "@/lib/graph/model";
import type { ReducedGraph } from "@/lib/viewer/reducedGraph";
import { campaignHasPersona } from "./compare";
import { campaignColor, TYPE_COLORS } from "./palette";

export interface GraphIndex {
  nodeById: Map<string, GraphNode>;
  out: Map<string, GraphEdge[]>;
  incoming: Map<string, GraphEdge[]>;
  linksByItem: Map<string, ItemLink[]>;
  campaignIndex: Map<string, { index: number; size: number }>;
  /** Entities that are shared (df >= 2) or lead from an item to a shared entity. */
  useful: Set<string>;
}

export function buildIndex(graph: EvidenceGraph, campaigns: CampaignsFile): GraphIndex {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    if (!out.has(e.source)) out.set(e.source, []);
    out.get(e.source)!.push(e);
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e);
  }
  const linksByItem = new Map<string, ItemLink[]>();
  for (const l of graph.links) {
    for (const id of [l.a, l.b]) {
      if (!linksByItem.has(id)) linksByItem.set(id, []);
      linksByItem.get(id)!.push(l);
    }
  }
  for (const list of linksByItem.values()) list.sort((x, y) => y.score - x.score);
  const campaignIndex = new Map(campaigns.campaigns.map((c, i) => [c.id, { index: i, size: c.size }]));

  // useful(node) = shared entity, or any descendant (along entity edges) is useful
  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const isUseful = (id: string): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    const node = nodeById.get(id);
    if (!node) return false;
    if (visiting.has(id)) return false;
    visiting.add(id);
    let result = node.type !== "item" && node.df >= 2;
    for (const e of out.get(id) ?? []) {
      if (isSimilarityEdge(e.type)) continue;
      if (nodeById.get(e.target)?.type === "item") continue;
      if (isUseful(e.target)) result = true;
    }
    visiting.delete(id);
    memo.set(id, result);
    return result;
  };
  const useful = new Set<string>();
  for (const n of graph.nodes) if (n.type !== "item" && isUseful(n.id)) useful.add(n.id);
  return { nodeById, out, incoming, linksByItem, campaignIndex, useful };
}

export interface ViewFilter {
  campaignId: string | null;
  sharedOnly: boolean;
  hideSingletons: boolean;
  /** Show only campaigns whose ads mention this persona (when no campaign is selected). */
  personaId?: string | null;
}

/** Visible node ids: chosen items plus the entities reachable from them. */
export function visibleNodes(graph: EvidenceGraph, campaigns: CampaignsFile, idx: GraphIndex, f: ViewFilter): Set<string> {
  const items = new Set<string>();
  if (f.campaignId) {
    const c = campaigns.campaigns.find((x) => x.id === f.campaignId);
    for (const m of c?.members ?? []) items.add(`item:${m}`);
  } else {
    const withPersona = f.personaId
      ? new Set(campaigns.campaigns.filter((c) => campaignHasPersona(c, f.personaId ?? null)).map((c) => c.id))
      : null;
    for (const n of graph.nodes) {
      if (n.type !== "item") continue;
      const size = n.campaignId ? (idx.campaignIndex.get(n.campaignId)?.size ?? 1) : 1;
      if (f.hideSingletons && size < 2) continue;
      if (withPersona && !(n.campaignId && withPersona.has(n.campaignId))) continue;
      items.add(n.id);
    }
  }
  const visible = new Set(items);
  const stack = [...items];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of idx.out.get(id) ?? []) {
      if (isSimilarityEdge(e.type)) continue;
      const t = e.target;
      if (visible.has(t)) continue;
      const tn = idx.nodeById.get(t);
      if (!tn || tn.type === "item") continue;
      if (f.sharedOnly && !idx.useful.has(t)) continue;
      visible.add(t);
      stack.push(t);
    }
  }
  return visible;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function toElements(
  graph: EvidenceGraph,
  idx: GraphIndex,
  visible: Set<string>,
  colorBy: "type" | "campaign",
): ElementDefinition[] {
  const els: ElementDefinition[] = [];
  for (const id of visible) {
    const n = idx.nodeById.get(id)!;
    const camp = n.campaignId ? idx.campaignIndex.get(n.campaignId) : undefined;
    const color =
      colorBy === "campaign" && n.type === "item"
        ? campaignColor(camp?.index ?? 0, camp?.size ?? 1)
        : colorBy === "campaign"
          ? "#cbd5e1"
          : TYPE_COLORS[n.type];
    const classes = [n.type === "item" ? "item" : "entity"];
    if (n.discounts.length) classes.push("discounted");
    if (n.strong) classes.push("strong");
    els.push({
      group: "nodes",
      data: {
        id,
        label: n.type === "item" ? n.key : truncate(n.label, 34),
        color,
        type: n.type,
        size: n.type === "item" ? 26 : Math.min(30, 12 + Math.sqrt(Math.max(1, n.df)) * 4),
      },
      classes: classes.join(" "),
    });
  }
  for (const e of graph.edges) {
    if (!visible.has(e.source) || !visible.has(e.target)) continue;
    const t = idx.nodeById.get(e.target);
    const classes: string[] = [e.type];
    if (t?.discounts.length) classes.push("to-discounted");
    els.push({
      group: "edges",
      data: { id: e.id, source: e.source, target: e.target, weight: e.weight },
      classes: classes.join(" "),
    });
  }
  return els;
}

/**
 * Cytoscape elements of the reduced graph (campaigns, shared traces, unfolded materials). `campaignIndex` gives the
 * colour of a campaign; campaigns are drawn larger than traces, and the nodes a click unfolds carry the class `expandable`.
 */
export function reducedToElements(r: ReducedGraph, campaignIndex: Map<string, { index: number; size: number }>): ElementDefinition[] {
  const color = (campaignId: string | undefined) => {
    const c = campaignId ? campaignIndex.get(campaignId) : undefined;
    return campaignColor(c?.index ?? 0, c?.size ?? 1);
  };
  const els: ElementDefinition[] = r.nodes.map((n) => {
    const classes: string[] = [n.kind === "item" ? "item" : "entity", n.kind];
    if (n.strong) classes.push("strong");
    if (n.expandable) classes.push("expandable");
    return {
      group: "nodes",
      data: {
        id: n.id,
        label: n.kind === "trace" ? truncate(n.label, 34) : n.label,
        color: n.kind === "trace" ? (n.type ? TYPE_COLORS[n.type] : "#cbd5e1") : color(n.campaignId),
        type: n.type ?? n.kind,
        size: n.kind === "campaign" ? Math.min(60, 22 + Math.sqrt(n.size) * 8) : n.kind === "trace" ? Math.min(30, 12 + Math.sqrt(Math.max(1, n.size)) * 3) : 22,
      },
      classes: classes.join(" "),
    };
  });
  for (const e of r.edges) els.push({ group: "edges", data: { id: e.id, source: e.source, target: e.target, weight: e.weight }, classes: "reduced" });
  return els;
}

/** Items that reach an entity through the graph (reverse walk to item nodes). */
export function holdersOf(idx: GraphIndex, entityId: string): string[] {
  const seen = new Set<string>([entityId]);
  const items = new Set<string>();
  const stack = [entityId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of idx.incoming.get(id) ?? []) {
      if (seen.has(e.source)) continue;
      seen.add(e.source);
      const n = idx.nodeById.get(e.source);
      if (!n) continue;
      if (n.type === "item") items.add(n.key);
      else stack.push(e.source);
    }
  }
  return [...items].sort();
}

export function pathLabel(idx: GraphIndex, path: string[]): string {
  return path
    .map((id) => {
      const n = idx.nodeById.get(id);
      if (!n) return id;
      return n.type === "item" ? `reklama ${n.key}` : truncate(n.label, 40);
    })
    .join(" → ");
}
