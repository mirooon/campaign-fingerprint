import { describe, expect, it } from "vitest";
import { DEFAULT_LINK_CONFIG } from "@/lib/graph/config";
import type { EvidenceGraph, GraphNode, ItemLink, PairEvidence } from "@/lib/graph/model";
import { previewThresholds, thresholdSteps } from "./thresholdPreview";

const node = (key: string): GraphNode => ({ id: `item:${key}`, type: "item", key, label: key, df: 1, weight: null, strong: false, discounts: [], data: {}, campaignId: null });
const ev = (weight: number): PairEvidence => ({ kind: "pivot", pivot: "tracker:t", pivotType: "tracker", edgeType: null, weight, strong: false, discounted: false, evidence: "wspólny tracker", pathA: [], pathB: [] });
const link = (a: string, b: string, score: number): ItemLink => ({ a, b, score, strong: false, evidence: [ev(score)] });

/** Four ads in a chain a–b, b–c, c–d with scores 0,5, 0,1 and 0,2: the threshold decides which links still join ads. */
function graph(): EvidenceGraph {
  const nodes = ["a", "b", "c", "d"].map(node);
  const links = [link("a", "b", 0.5), link("b", "c", 0.1), link("c", "d", 0.2)];
  return { version: 1, generatedAt: "2026-01-01T00:00:00.000Z", mode: "offline", baseDir: ".", textMethod: "none", stats: { items: 4, nodes: 4, edges: 0, links: 3, strongLinks: 0, byType: {} }, nodes, edges: [], links };
}

describe("previewThresholds", () => {
  it("wyższy próg łączy mniej: liczba kampanii liczona regułami backendu", () => {
    const rows = previewThresholds(graph(), DEFAULT_LINK_CONFIG, [0.15, 0.3, 0.6]);
    expect(rows.map((r) => r.value)).toEqual([0.15, 0.3, 0.6]);
    expect(rows[0]).toMatchObject({ campaigns: 2, singletons: 0, largest: 2 });
    expect(rows[1]).toMatchObject({ campaigns: 1, singletons: 2, largest: 2 });
    expect(rows[2]).toMatchObject({ campaigns: 0, singletons: 4, largest: 1 });
  });
  it("próg zgodny z obliczeniem backendu dla tego samego grafu i konfiguracji", async () => {
    const { clusterCampaigns } = await import("@/lib/graph/cluster");
    const direct = clusterCampaigns(graph(), { config: { ...DEFAULT_LINK_CONFIG, minLinkScore: 0.15 } }).campaigns.campaigns.filter((c) => c.size > 1).length;
    expect(previewThresholds(graph(), DEFAULT_LINK_CONFIG, [0.15])[0].campaigns).toBe(direct);
  });
});

describe("thresholdSteps", () => {
  it("kroki podglądu obejmują aktualny próg, posortowane i bez powtórzeń", () => {
    expect(thresholdSteps(0.15)).toContain(0.15);
    const s = thresholdSteps(0.17);
    expect(s).toEqual([...s].sort((x, y) => x - y));
    expect(new Set(s).size).toBe(s.length);
    expect(s).toContain(0.17);
  });
});
