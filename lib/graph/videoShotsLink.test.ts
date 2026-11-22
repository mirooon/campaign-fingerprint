import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset, type TestItemSpec } from "./testkit";

function pair(a: TestItemSpec, b: TestItemSpec) {
  const res = clusterCampaigns(buildEvidenceGraph(makeDataset([a, b]), { textMethod: "tfidf" }));
  return res.graph.links.find((l) => (l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id));
}

describe("shared video shots (B-329)", () => {
  it("links two videos that share a shot in a different montage", () => {
    const l = pair(
      { id: "a", videoShots: ["f0f0f0f0f0f0f0f0", "123456789abcdef0"] },
      { id: "b", videoShots: ["0f0f0f0f0f0f0f0f", "f0f0f0f0f0f0f0f1"] },
    );
    expect((l?.evidence ?? []).map((e) => e.edgeType)).toContain("similar_image");
  });

  it("does not link videos without a common shot", () => {
    const l = pair({ id: "a", videoShots: ["f0f0f0f0f0f0f0f0"] }, { id: "b", videoShots: ["0f0f0f0f0f0f0f0f"] });
    expect(l).toBeUndefined();
  });
});
