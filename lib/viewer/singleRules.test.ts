/**
 * Reason of a material left alone, computed on the server for pairs cut from near-misses.json: the backend's
 * own decision (campaignLinkDecision) on the stored link of the nearest campaign. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_LINK_CONFIG } from "@/lib/graph/config";
import type { Campaign, CampaignsFile, EvidenceGraph, GraphNode, ItemLink, PairEvidence } from "@/lib/graph/model";
import { combineScores } from "@/lib/graph/weights";
import { singleMaterialRules } from "./singleRules";

const item = (key: string, data: Record<string, unknown> = {}): GraphNode => ({ id: `item:${key}`, type: "item", key, label: key, df: 1, weight: null, strong: false, discounts: [], data, campaignId: null });
const pivot = (type: NonNullable<PairEvidence["pivotType"]>, weight: number): PairEvidence => ({ kind: "pivot", pivot: `${type}:x`, pivotType: type, edgeType: null, weight, strong: false, discounted: false, evidence: "trace", pathA: [], pathB: [] });
const link = (a: string, b: string, ev: PairEvidence[]): ItemLink => ({ a, b, score: combineScores(ev.map((e) => e.weight)), strong: false, evidence: ev });
const camp = (id: string, members: string[]): Campaign => ({ id, size: members.length, members, firstSeen: null, lastSeen: null, topEvidence: [], domains: [], advertisers: [], cohesion: 0, strongComponents: 1, attributes: { personas: [], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null } });

/** Campaign K01 of k1 and k2; singles s1 (page kit only), s2 (weak), s3 (rules allow), s4 (other platform account). */
function base(): { graph: EvidenceGraph; campaigns: CampaignsFile } {
  const nodes = [item("k1", { platformAccount: "11111111-aaaa" }), item("k2"), item("s1"), item("s2"), item("s3"), item("s4", { platformAccount: "22222222-bbbb" })];
  const links = [
    link("k1", "k2", [pivot("ip", 0.6), pivot("nameserver", 0.5)]),
    link("s1", "k1", [pivot("asset", 0.55), pivot("hidden_fields", 0.6)]),
    link("s1", "k2", [pivot("asset", 0.2)]),
    link("s2", "k2", [pivot("asn", 0.05)]),
    link("s3", "k2", [pivot("ip", 0.6), pivot("nameserver", 0.5)]),
    link("s4", "k1", [pivot("ip", 0.6), pivot("nameserver", 0.5)]),
  ];
  const graph = { version: 1, generatedAt: "", mode: "offline", baseDir: "", textMethod: "none", stats: { items: 6, nodes: 6, edges: 0, links: links.length, strongLinks: 0, byType: {} }, nodes, edges: [], links } as EvidenceGraph;
  const campaigns: CampaignsFile = {
    version: 1,
    generatedAt: "",
    method: { unionFind: "", louvain: { resolution: 1, seed: 1, modularity: 0 }, minLinkScore: DEFAULT_LINK_CONFIG.minLinkScore },
    campaigns: [camp("K01", ["k1", "k2"]), camp("K02", ["s1"]), camp("K03", ["s2"]), camp("K04", ["s3"]), camp("K05", ["s4"])],
    assignments: { k1: "K01", k2: "K01", s1: "K02", s2: "K03", s3: "K04", s4: "K05" },
  } as CampaignsFile;
  return { graph, campaigns };
}

describe("singleMaterialRules", () => {
  const { graph, campaigns } = base();
  const rules = singleMaterialRules(graph, campaigns, DEFAULT_LINK_CONFIG);

  it("names the rule of the strongest link to another campaign, with the material of that campaign", () => {
    expect(rules.s1).toEqual({ other: "k1", rule: "kit-only" });
    expect(rules.s4).toEqual({ other: "k1", rule: "account-conflict" });
  });

  it("a link the rules allow but the clustering split reads 'split-by-clustering', as in findNearMisses", () => {
    expect(rules.s3).toEqual({ other: "k2", rule: "split-by-clustering" });
  });

  it("leaves out a nearest campaign below the link threshold and campaigns of two or more materials", () => {
    expect(rules.s2).toBeUndefined();
    expect(rules.k1).toBeUndefined();
    expect(Object.keys(rules).sort()).toEqual(["s1", "s3", "s4"]);
  });
});
