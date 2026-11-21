import { describe, expect, it } from "vitest";
import { DEFAULT_LINK_CONFIG } from "./config";
import type { EvidenceGraph, GraphNode, ItemLink, PairEvidence } from "./model";
import { pruneGraphForOutput } from "./prune";

const node = (key: string, campaignId: string | null): GraphNode => ({ id: `item:${key}`, type: "item", key, label: key, df: 1, weight: null, strong: false, discounts: [], data: {}, campaignId });
const ev = (i: number): PairEvidence => ({ kind: "pivot", pivot: `tracker:t${i}`, pivotType: "tracker", edgeType: null, weight: 0.3, strong: false, discounted: false, evidence: `wspólny tracker ${i}`, pathA: [], pathB: [] });
const link = (a: string, b: string, score: number, evidence = 1): ItemLink => ({ a, b, score, strong: false, evidence: Array.from({ length: evidence }, (_, i) => ev(i)) });

/** A campaign of 15 ads linked pair by pair (8 premises each), and 30 loose ads linked to each campaign ad with a higher score. */
function graph(): EvidenceGraph {
  const members = Array.from({ length: 15 }, (_, i) => `k${String(i + 1).padStart(2, "0")}`);
  const loose = Array.from({ length: 30 }, (_, i) => `x${String(i + 1).padStart(2, "0")}`);
  const links: ItemLink[] = [];
  for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) links.push(link(members[i], members[j], 0.4, 8));
  for (const m of members) for (const x of loose) links.push(link(m, x, 0.5));
  const nodes = [...members.map((m) => node(m, "K01")), ...loose.map((x) => node(x, null))];
  return {
    version: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    mode: "offline",
    baseDir: ".",
    textMethod: "none",
    stats: { items: nodes.length, nodes: nodes.length, edges: 0, links: links.length, strongLinks: 0, byType: {} },
    nodes,
    edges: [],
    links,
  };
}

describe("pruneGraphForOutput", () => {
  it("keeps every link inside a campaign of 15 ads, with all its premises", () => {
    const out = pruneGraphForOutput(graph(), DEFAULT_LINK_CONFIG.output);
    const inside = out.links.filter((l) => l.a.startsWith("k") && l.b.startsWith("k"));
    expect(inside).toHaveLength(105);
    expect(inside.every((l) => l.evidence.length === 8)).toBe(true);
  });

  it("can cap the premises of links inside a campaign too", () => {
    const out = pruneGraphForOutput(graph(), { ...DEFAULT_LINK_CONFIG.output, campaignMaxEvidence: 3 });
    const inside = out.links.filter((l) => l.a.startsWith("k") && l.b.startsWith("k"));
    expect(inside).toHaveLength(105);
    expect(inside.every((l) => l.evidence.length === 3)).toBe(true);
  });

  it("caps the other links of an ad at topKPerItem", () => {
    const out = pruneGraphForOutput(graph(), { ...DEFAULT_LINK_CONFIG.output, topKPerItem: 3 });
    const outside = out.links.filter((l) => l.b.startsWith("x"));
    // every ad keeps its 3 best outside links; the loose ads keep 3 each, so at most 15 * 3 + 30 * 3
    expect(outside.length).toBeLessThanOrEqual(15 * 3 + 30 * 3);
    expect(out.links.filter((l) => l.a.startsWith("k") && l.b.startsWith("k"))).toHaveLength(105);
  });
});
