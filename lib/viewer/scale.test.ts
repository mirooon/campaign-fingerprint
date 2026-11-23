import { describe, expect, it } from "vitest";
import type { MaterialItemResult, MaterialLink } from "@/lib/pipeline/analyzeMaterial";
import { fmtNum } from "./format";
import { closestLink, familyThresholdFromRules, nearestCampaignOf, verdictScale } from "./scale";

const T = { campaign: 0.15, family: 0.3 };

function link(other: string, otherCampaign: string | null, score: number, rule: MaterialLink["rule"] = "below"): MaterialLink {
  return { other, otherCampaign, score, strong: false, rule, evidence: [] };
}
function item(over: Partial<MaterialItemResult>): MaterialItemResult {
  return { id: "n1", verdict: "new_campaign", verdictText: "", campaign: null, similarCampaigns: [], apart: [], withNew: [], links: [], features: {}, errors: [], ...over };
}

describe("closestLink", () => {
  it("the closest known sample is the link with the highest score, also below the threshold", () => {
    expect(closestLink(item({ links: [link("a", "K01", 0.05), link("b", "K02", 0.12)] }))?.other).toBe("b");
    expect(closestLink(item({}))).toBeNull();
  });
});

describe("verdictScale", () => {
  it("new pattern: the closest sample with its score and the campaign threshold", () => {
    const s = verdictScale(item({ links: [link("k2-03", "K02", 0.12)] }), T);
    expect(s.zone).toBe("new");
    expect(s.sentence).toBe(`The closest known sample (k2-03, campaign K02) has a score of ${fmtNum(0.12)}; the campaign linking threshold is ${fmtNum(0.15)}.`);
    expect(s.closest).toEqual({ id: "k2-03", score: 0.12 });
  });
  it("new pattern without any link", () => {
    expect(verdictScale(item({}), T).sentence).toBe("No known sample shares a trace with this sample.");
  });
  it("known campaign: the score exceeds the threshold", () => {
    const s = verdictScale(item({ verdict: "known_campaign", campaign: "K01", links: [link("a", "K01", 0.82, "campaign")] }), T);
    expect(s.zone).toBe("campaign");
    expect(s.sentence).toBe(`Score ${fmtNum(0.82)} with sample a exceeds the campaign linking threshold ${fmtNum(0.15)}.`);
  });
  it("score above the threshold, but a rule changed the result to a similar-campaign group", () => {
    const s = verdictScale(item({ verdict: "similar_campaigns", similarCampaigns: ["K01"], links: [link("a", "K01", 0.6, "account_conflict")] }), T);
    expect(s.zone).toBe("family");
    expect(s.sentence).toContain(`Score ${fmtNum(0.6)} is above the`);
    expect(s.sentence).toBe(`Score ${fmtNum(0.6)} is above the campaign linking threshold (${fmtNum(0.15)}), but these are different page-builder accounts, i.e. different operators, so this is a group of similar campaigns, not the same campaign.`);
    expect(s.sentence).toContain("group of similar campaigns");
  });
  it("a similar campaign with a score below the campaign threshold names the group threshold", () => {
    const s = verdictScale(item({ verdict: "similar_campaigns", similarCampaigns: ["K01"], links: [link("a", "K01", 0.35, "single_kind")] }), { campaign: 0.5, family: 0.3 });
    expect(s.sentence).toBe(`Score ${fmtNum(0.35)} is below the campaign linking threshold (${fmtNum(0.5)}), but above the similar-campaign group threshold (${fmtNum(0.3)}), so this is a group of similar campaigns, not the same campaign.`);
  });
});

describe("familyThresholdFromRules", () => {
  it("reads the group threshold from the base rule descriptions, and without it returns the default", () => {
    expect(familyThresholdFromRules(["campaign: …", "group of similar campaigns: remaining links … ≥ 0.35"])).toBe(0.35);
    expect(familyThresholdFromRules(undefined)).toBe(0.3);
    expect(familyThresholdFromRules(["nothing"])).toBe(0.3);
  });
});

describe("nearestCampaignOf", () => {
  const links = [
    { a: "s1", b: "x1", score: 0.22 },
    { a: "x2", b: "s1", score: 0.1 },
    { a: "s1", b: "same", score: 0.9 },
  ];
  const assignments = { s1: "K09", x1: "K02", x2: "K03", same: "K09" };
  it("the nearest other campaign with its sample and score, its own campaign skipped", () => {
    expect(nearestCampaignOf("s1", links, assignments)).toEqual({ campaign: "K02", material: "x1", score: 0.22 });
  });
  it("a sample without links to other campaigns has no nearest one", () => {
    expect(nearestCampaignOf("zz", links, assignments)).toBeNull();
  });
});
