import { describe, expect, it } from "vitest";
import { emptyAdLibraryInfo, type AdLibraryInfo } from "../osint/adLibrary";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset } from "./testkit";

const lib = (id: string, over: Partial<AdLibraryInfo>): AdLibraryInfo => ({ ...emptyAdLibraryInfo(id, null), ...over });
const pairOf = (graph: ReturnType<typeof buildEvidenceGraph>, a: string, b: string) =>
  graph.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));

describe("Meta Ad Library payer pivot", () => {
  it("links two ads with the same DSA payer and puts the takedown on the item", () => {
    const graph = buildEvidenceGraph(
      makeDataset([
        { id: "a", adLibrary: [lib("1000000000000101", { payers: ["Testowa Spolka"], beneficiaries: ["Testowa Spolka"], takenDown: true, violations: ["Prohibited Commercial Practices"], euReach: 123456 })] },
        { id: "b", adLibrary: [lib("1000000000000202", { payers: ["testowa  spolka"], beneficiaries: ["Brand X"] })] },
        { id: "c", adLibrary: [lib("1000000000000303", { payers: ["ABC"], beneficiaries: ["ABC"] })] },
      ]),
      { textMethod: "none" },
    );
    const ab = pairOf(graph, "a", "b")!;
    expect(ab.evidence.map((e) => e.pivotType)).toEqual(["ad_payer"]);
    expect(ab.evidence[0].evidence).toContain("Testowa Spolka");
    expect(pairOf(graph, "a", "c")).toBeUndefined();
    const payer = graph.nodes.find((n) => n.type === "ad_payer" && n.label === "Testowa Spolka")!;
    expect(graph.edges.filter((e) => e.target === payer.id && e.type === "paid_by")).toHaveLength(2);
    expect(payer.data.adLibraryIds).toEqual(["1000000000000101", "1000000000000202"]);
    const itemA = graph.nodes.find((n) => n.id === "item:a")!;
    expect(itemA.data.adTakenDown).toBe(true);
    expect((itemA.data.adLibrary as Array<{ euReach: number }>)[0].euReach).toBe(123456);
    const { campaigns } = clusterCampaigns(graph);
    expect(campaigns.assignments.a).toBe(campaigns.assignments.b);
  });

  it("ignores records that failed to load", () => {
    const graph = buildEvidenceGraph(
      makeDataset([
        { id: "a", adLibrary: [{ ...lib("1", { payers: ["X"] }), error: "timeout" }] },
        { id: "b", adLibrary: [{ ...lib("2", { payers: ["X"] }), error: "timeout" }] },
      ]),
      { textMethod: "none" },
    );
    expect(graph.links).toEqual([]);
    expect(graph.nodes.some((n) => n.type === "ad_payer")).toBe(false);
  });
});

describe("speaker similarity", () => {
  it("adds similar_voice above the cosine threshold, but never forms a campaign alone", () => {
    const graph = buildEvidenceGraph(
      makeDataset([
        { id: "v1", speakerEmbedding: [1, 0, 0] },
        { id: "v2", speakerEmbedding: [0.9, 0.4359, 0] }, // cos 0.9
        { id: "v3", speakerEmbedding: [0.3, 0.9539, 0] }, // cos 0.3 to v1
      ]),
      { textMethod: "none" },
    );
    const v12 = pairOf(graph, "v1", "v2")!;
    expect(v12.evidence.map((e) => e.edgeType)).toEqual(["similar_voice"]);
    expect(v12.evidence[0].evidence).toContain("SpeechBrain");
    expect(pairOf(graph, "v1", "v3")).toBeUndefined();
    const { campaigns } = clusterCampaigns(graph);
    expect(campaigns.assignments.v1).not.toBe(campaigns.assignments.v2);
  });

  it("joins a campaign together with other evidence", () => {
    const graph = buildEvidenceGraph(
      makeDataset([
        { id: "v1", speakerEmbedding: [1, 0, 0], advertiser: "Inwestor Testowy" },
        { id: "v2", speakerEmbedding: [0.95, 0.3122, 0], advertiser: "Inwestor Testowy" },
      ]),
      { textMethod: "none" },
    );
    expect(pairOf(graph, "v1", "v2")!.evidence.map((e) => e.pivotType ?? e.edgeType).sort()).toEqual(["advertiser", "similar_voice"]);
    const { campaigns } = clusterCampaigns(graph);
    expect(campaigns.assignments.v1).toBe(campaigns.assignments.v2);
  });
});
