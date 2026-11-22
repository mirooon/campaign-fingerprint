import { describe, expect, it } from "vitest";
import type { CampaignsFile, EvidenceGraph, GraphNode } from "../graph/model";
import { parseRecipes } from "./recipes";
import { seedRecipes } from "./seed";

const node = (type: GraphNode["type"], key: string, discounts: GraphNode["discounts"] = []): GraphNode => ({ id: `${type}:${key}`, type, key, label: key, df: 3, weight: 0.8, strong: true, discounts, data: {}, campaignId: null });
const graph = {
  nodes: [
    node("ip", "192.0.2.10"),
    node("ip", "198.51.100.7", [{ reason: "CDN", factor: 0.02, rule: "ipCidrs:x" }]),
    node("asset", "/static/kit-form.abc123.js"),
    node("path_id", "0123456789abcdef"),
    node("cert", "aaaa"),
  ],
} as unknown as EvidenceGraph;
const ev = (n: GraphNode, count = 3) => ({ key: n.id, type: n.type, label: n.label, count, weight: 0.8 });
const campaigns = {
  campaigns: [
    { id: "K01", size: 3, members: [], topEvidence: [ev(graph.nodes[0]), ev(graph.nodes[1]), ev(graph.nodes[2]), ev(graph.nodes[3]), ev(graph.nodes[4])] },
    { id: "K02", size: 1, members: [], topEvidence: [ev(graph.nodes[0])] },
    { id: "K03", size: 2, members: [], topEvidence: [ev(graph.nodes[0], 1)] },
  ],
} as unknown as CampaignsFile;

describe("przepisy rozszerzania od ziarna", () => {
  const recipes = seedRecipes(graph, campaigns);

  it("z silnych pivotów kampanii (adres IP spoza CDN, plik, identyfikator ścieżki) robi zapytania urlscan; zdyskontowane i certyfikaty pomija", () => {
    expect(recipes.map((r) => r.query)).toEqual(['page.ip:"192.0.2.10"', 'filename:"/static/kit-form.abc123.js"', "page.url:*0123456789abcdef*"]);
    expect(recipes.every((r) => r.source === "urlscan" && r.description?.includes("K01"))).toBe(true);
  });

  it("pomija kampanie jednoosobowe i pivoty trzymane przez jednego członka, a wynik przechodzi walidację formatu przepisów", () => {
    expect(recipes.some((r) => r.description?.includes("K02") || r.description?.includes("K03"))).toBe(false);
    expect(parseRecipes(recipes)).toHaveLength(3);
  });
});
