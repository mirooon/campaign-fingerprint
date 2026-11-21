import { describe, expect, it } from "vitest";
import { campaignLinkVerdict, campaignScore } from "./cluster";
import { DEFAULT_LINK_CONFIG } from "./config";
import type { ItemLink, PairEvidence } from "./model";

const pivot = (type: PairEvidence["pivotType"], weight: number): PairEvidence => ({
  kind: "pivot",
  pivot: `${type}:x`,
  pivotType: type,
  edgeType: null,
  weight,
  strong: false,
  discounted: false,
  evidence: "",
  pathA: [],
  pathB: [],
});
const link = (evidence: PairEvidence[], score: number): ItemLink => ({ a: "a", b: "b", score, strong: false, evidence });

describe("family-only evidence (page techniques, personas)", () => {
  it("is left out of the campaign score and of the evidence kinds", () => {
    // a persona plus a shared technique: two kinds and score above the minimum, but both only for the family
    const l = link([pivot("technique", 0.2), pivot("persona", 0.1)], 0.28);
    expect(campaignScore(l, DEFAULT_LINK_CONFIG)).toBe(0);
    expect(campaignLinkVerdict(l, DEFAULT_LINK_CONFIG)).toBe("below");
    // a persona does not corroborate a campaign link either
    const withKit = link([pivot("comment_block", 0.45), pivot("persona", 0.1)], 0.505);
    expect(campaignScore(withKit, DEFAULT_LINK_CONFIG)).toBeCloseTo(0.45);
    expect(campaignLinkVerdict(withKit, DEFAULT_LINK_CONFIG)).toBe("single_kind");
    // a template trace with a technique is still one kind of campaign evidence
    const kit = link([pivot("comment_block", 0.45), pivot("technique", 0.2)], 0.56);
    expect(campaignLinkVerdict(kit, DEFAULT_LINK_CONFIG)).toBe("single_kind");
    // a link without techniques is unchanged
    const plain = link([pivot("comment_block", 0.45), pivot("asset", 0.3)], 0.615);
    expect(campaignScore(plain, DEFAULT_LINK_CONFIG)).toBe(0.615);
    expect(campaignLinkVerdict(plain, DEFAULT_LINK_CONFIG)).toBe("campaign");
  });
});
