import { describe, expect, it } from "vitest";
import type { Campaign, EdgeType, EntityType, EvidenceGraph, GraphEdge, GraphNode } from "@/lib/graph/model";
import { reducedGraph } from "./reducedGraph";

type G = Pick<EvidenceGraph, "nodes" | "edges">;

const node = (type: EntityType, key: string, over: Partial<GraphNode> = {}): GraphNode => ({ id: `${type}:${key}`, type, key, label: key, df: 0, weight: 0.5, strong: false, discounts: [], data: {}, campaignId: null, ...over });
const edge = (source: string, target: string, type: EdgeType): GraphEdge => ({ id: `${type}|${source}|${target}`, source, target, type, weight: 1, evidence: "" });
const camp = (id: string, members: string[]): Campaign => ({ id, size: members.length, members, firstSeen: null, lastSeen: null, topEvidence: [], domains: [], advertisers: [], cohesion: 0.5, strongComponents: 1, attributes: { personas: [], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null } });

/** Items hold traces directly (item → pivot): K01 = a1, a2; K02 = b1, b2; K03 = c1 alone. Tracker T1 is in K01 and K02, T2 only in K01, domain D in K02. */
function fixture(): { graph: G; campaigns: Campaign[] } {
  const nodes: GraphNode[] = [
    ...["a1", "a2"].map((k) => node("item", k, { campaignId: "K01" })),
    ...["b1", "b2"].map((k) => node("item", k, { campaignId: "K02" })),
    node("item", "c1", { campaignId: "K03" }),
    node("tracker", "T1", { weight: 0.4 }),
    node("tracker", "T2", { weight: 0.9, strong: true }),
    node("domain", "D", { weight: 0.7 }),
  ];
  const own = (item: string, pivots: string[]) => pivots.map((p) => edge(`item:${item}`, p, "uses_tracker"));
  const edges = [...own("a1", ["tracker:T1", "tracker:T2"]), ...own("a2", ["tracker:T1", "tracker:T2"]), ...own("b1", ["tracker:T1", "domain:D"]), ...own("b2", ["domain:D"])];
  return { graph: { nodes, edges }, campaigns: [camp("K01", ["a1", "a2"]), camp("K02", ["b1", "b2"]), camp("K03", ["c1"])] };
}

const ids = (nodes: Array<{ id: string }>) => nodes.map((n) => n.id).sort();

describe("reducedGraph", () => {
  it("przegląd: kampanie i wspólne ślady, reklamy zwinięte", () => {
    const { graph, campaigns } = fixture();
    const r = reducedGraph(graph, campaigns, { expanded: new Set() });
    expect(ids(r.nodes.filter((n) => n.kind === "campaign"))).toEqual(["campaign:K01", "campaign:K02"]);
    expect(r.nodes.some((n) => n.kind === "item")).toBe(false);
    expect(ids(r.nodes.filter((n) => n.kind === "trace"))).toEqual(["domain:D", "tracker:T1", "tracker:T2"]);
    const t1 = r.edges.filter((e) => e.target === "tracker:T1").map((e) => e.source).sort();
    expect(t1).toEqual(["campaign:K01", "campaign:K02"]);
  });
  it("rozwinięcie kampanii pokazuje jej materiały i które z nich mają ślad", () => {
    const { graph, campaigns } = fixture();
    const r = reducedGraph(graph, campaigns, { expanded: new Set(["campaign:K02"]) });
    expect(ids(r.nodes.filter((n) => n.kind === "item"))).toEqual(["item:b1", "item:b2"]);
    expect(r.edges.some((e) => e.source === "item:b2" && e.target === "domain:D")).toBe(true);
    expect(r.edges.some((e) => e.source === "campaign:K02" && e.target === "item:b1")).toBe(true);
  });
  it("graf od jednego materiału: jego kampania i jej ślady, kolejne kampanie po rozwinięciu śladu", () => {
    const { graph, campaigns } = fixture();
    const start = reducedGraph(graph, campaigns, { expanded: new Set(), seed: "a1" });
    expect(ids(start.nodes.filter((n) => n.kind === "campaign"))).toEqual(["campaign:K01"]);
    expect(start.nodes.find((n) => n.id === "tracker:T1")?.expandable).toBe(true);
    const grown = reducedGraph(graph, campaigns, { expanded: new Set(["tracker:T1"]), seed: "a1" });
    expect(ids(grown.nodes.filter((n) => n.kind === "campaign"))).toEqual(["campaign:K01", "campaign:K02"]);
  });
  it("limit śladów na kampanię zostawia najsilniejsze", () => {
    const { graph, campaigns } = fixture();
    const r = reducedGraph(graph, campaigns, { expanded: new Set(), seed: "a1", maxTraces: 1 });
    expect(ids(r.nodes.filter((n) => n.kind === "trace"))).toEqual(["tracker:T2"]);
  });
  it("kampania jednego materiału bez wspólnych śladów nie pojawia się w przeglądzie", () => {
    const { graph, campaigns } = fixture();
    expect(reducedGraph(graph, campaigns, { expanded: new Set() }).nodes.some((n) => n.id === "campaign:K03")).toBe(false);
  });
});
