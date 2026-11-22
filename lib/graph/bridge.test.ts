/**
 * Bridge and weakest link of a campaign (B-123): a strong pivot that alone ties two subgroups of a campaign
 * is flagged as a candidate for lists.pivots; minInternalScore shows the member hanging on the weakest
 * link. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset, type TestItemSpec } from "./testkit";

const run = (specs: TestItemSpec[]) => clusterCampaigns(buildEvidenceGraph(makeDataset(specs), { textMethod: "none" }));
const ga = (id: string) => ({ kind: "ga4" as const, id });

describe("bridge of a campaign", () => {
  it("flags the one strong pivot that alone ties two subgroups of two ads each", () => {
    const res = run([
      { id: "a1", url: "https://alfa-portal.example/1", trackers: [ga("G-ALFA0001")] },
      { id: "a2", url: "https://alfa-portal.example/2", trackers: [ga("G-ALFA0001")], emails: ["kontakt@wspolny.example"] },
      { id: "b1", url: "https://beta-portal.test/1", trackers: [ga("G-BETA0002")], emails: ["kontakt@wspolny.example"] },
      { id: "b2", url: "https://beta-portal.test/2", trackers: [ga("G-BETA0002")] },
    ]);
    const c = res.campaigns.campaigns.find((k) => k.members.includes("a1"))!;
    expect(c.members).toEqual(["a1", "a2", "b1", "b2"]);
    expect(c.bridge?.pivot).toBe("email:kontakt@wspolny.example");
    expect(c.bridge?.parts).toEqual([["a1", "a2"], ["b1", "b2"]]);
  });

  it("does not flag a pivot when the subgroups share other evidence too", () => {
    const res = run([
      { id: "a1", url: "https://alfa-portal.example/1", trackers: [ga("G-ALFA0001"), ga("G-WSPOL003")] },
      { id: "a2", url: "https://alfa-portal.example/2", trackers: [ga("G-ALFA0001")], emails: ["kontakt@wspolny.example"] },
      { id: "b1", url: "https://beta-portal.test/1", trackers: [ga("G-BETA0002"), ga("G-WSPOL003")], emails: ["kontakt@wspolny.example"] },
      { id: "b2", url: "https://beta-portal.test/2", trackers: [ga("G-BETA0002")] },
    ]);
    const c = res.campaigns.campaigns.find((k) => k.members.includes("a1"))!;
    expect(c.size).toBe(4);
    expect(c.bridge).toBeUndefined();
  });

  it("gives the weakest member's best link as minInternalScore", () => {
    const res = run([
      { id: "a1", url: "https://alfa-portal.example/1", trackers: [ga("G-ALFA0001")] },
      { id: "a2", url: "https://alfa-portal.example/2", trackers: [ga("G-ALFA0001")] },
    ]);
    const c = res.campaigns.campaigns[0];
    expect(c.minInternalScore).toBeGreaterThan(0.9);
    expect(c.weakestMember?.id).toBeDefined();
  });
});
