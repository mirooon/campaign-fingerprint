import { describe, expect, it } from "vitest";
import type { Campaign } from "@/lib/graph/model";
import { baseCounts, basisNote, campaignAnchorId, campaignIdInQuery, campaignMatchesFilter, campaignTitle, cohesionLabel, groupCampaigns, narrativeOptions, platformOptions, singlesInFamilyFrames, singleToReveal } from "./campaignView";
import { fmtNum } from "./format";

function camp(id: string, over: Partial<Campaign> = {}): Campaign {
  return {
    id, size: 3, members: [], firstSeen: null, lastSeen: null, topEvidence: [], domains: ["a.example"], advertisers: [], cohesion: 0.8, strongComponents: 1,
    attributes: { personas: [{ id: "adam-testowy", name: "Adam Testowy", count: 2 }], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null }, ...over,
  };
}

describe("campaignTitle", () => {
  it("puts the person and the domain together with the ID", () => {
    expect(campaignTitle(camp("K03"))).toBe("Adam Testowy · a.example · K03");
  });
  it("without a persona and a domain only the ID is left", () => {
    expect(campaignTitle(camp("K04", { domains: [], attributes: { personas: [], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null } }))).toBe("K04");
  });
});

describe("cohesionLabel", () => {
  it("describes the link strength with a word and a number", () => {
    expect(cohesionLabel(0.82)).toBe(`high (${fmtNum(0.82)})`);
    expect(cohesionLabel(0.5)).toBe(`medium (${fmtNum(0.5)})`);
    expect(cohesionLabel(0.2)).toBe(`low (${fmtNum(0.2)})`);
  });
});

describe("basisNote", () => {
  it("only a campaign built on content gets the weaker-basis label", () => {
    expect(basisNote(camp("K1", { attributes: { personas: [], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null, basis: "content" } }))).toBe("campaign built on content, without infrastructure");
    expect(basisNote(camp("K2", { attributes: { personas: [], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null, basis: "infrastructure" } }))).toBeNull();
    expect(basisNote(camp("K3"))).toBeNull();
  });
});

describe("groupCampaigns", () => {
  it("splits into similar-campaign groups, single campaigns and samples without links", () => {
    const list = [camp("K1", { familyId: "R1" }), camp("K2", { familyId: "R1" }), camp("K3"), camp("K4", { size: 1 })];
    const g = groupCampaigns(list, [{ id: "R1", campaigns: ["K1", "K2"], members: [], size: 6, topEvidence: [], apart: [] }]);
    expect(g.families).toHaveLength(1);
    expect(g.families[0].campaigns.map((c) => c.id)).toEqual(["K1", "K2"]);
    expect(g.alone.map((c) => c.id)).toEqual(["K3"]);
    expect(g.singletons.map((c) => c.id)).toEqual(["K4"]);
  });
});

describe("base numbers in the header", () => {
  const list = [camp("K1"), camp("K2"), camp("K3", { size: 1 }), camp("K4", { size: 1 }), camp("K5", { size: 1 })];
  const families = [{ id: "R1", campaigns: ["K2", "K3"], members: [], size: 4, topEvidence: [], apart: [] }];

  it("campaigns with at least two samples, single samples (also in group frames) and groups together give all K numbers", () => {
    const c = baseCounts(list, families);
    expect(c).toEqual({ campaigns: 2, singles: 3, singlesInFamilies: 1, families: 1 });
    expect(c.campaigns + c.singles).toBe(list.length);
  });

  it("the collapsed section of the Campaigns tab holds the single samples outside group frames: with the frames it gives the number in the header", () => {
    const g = groupCampaigns(list, families);
    expect(g.singletons.length + singlesInFamilyFrames(g)).toBe(baseCounts(list, families).singles);
    expect(singlesInFamilyFrames(g)).toBe(1);
  });
});

describe("a single sample opened from outside", () => {
  const singles = [camp("K50", { size: 1 }), camp("K51", { size: 1 })];

  it("expands the collapsed section only for an open single sample of that section", () => {
    expect(singleToReveal(singles, "K50")).toBe("K50");
    expect(singleToReveal(singles, "K03")).toBeNull();
    expect(singleToReveal(singles, null)).toBeNull();
    expect(singleToReveal([], "K50")).toBeNull();
  });

  it("an exact campaign number in the search points to the card to open, whatever the case and spaces", () => {
    const all = [camp("K03"), ...singles];
    expect(campaignIdInQuery(all, "K50")).toBe("K50");
    expect(campaignIdInQuery(all, " k50 ")).toBe("K50");
    expect(campaignIdInQuery(all, "K5")).toBeNull();
    expect(campaignIdInQuery(all, "")).toBeNull();
    expect(campaignIdInQuery(all, "a.example")).toBeNull();
  });

  it("a card has a fixed element ID to scroll to", () => {
    expect(campaignAnchorId("K50")).toBe("kampania-K50");
  });
});

const withNarrative = (id: string, topic: string, platform: string, first: string, last: string) =>
  camp(id, {
    firstSeen: first,
    lastSeen: last,
    attributes: {
      personas: [], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null,
      narrative: { topics: [{ id: topic, count: 2, firstSeen: first, lastSeen: last }], hooks: [], labels: [], switches: [] },
      platforms: [{ id: platform, count: 2 }],
    },
  });

describe("campaign name and filters with a narrative (B-033)", () => {
  it("the campaign name holds the main narrative topic between the person and the domain", () => {
    expect(campaignTitle(withNarrative("K05", "investment", "aio", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z"))).toBe("investment · a.example · K05");
    expect(campaignTitle(camp("K03", { attributes: { personas: [{ id: "a", name: "Adam Testowy", count: 1 }], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null, narrative: { topics: [{ id: "health", count: 1, firstSeen: null, lastSeen: null, subtopics: ["joints"] }], hooks: [], labels: [], switches: [] } } }))).toBe("Adam Testowy · health (joints) · a.example · K03");
  });
  const list = [withNarrative("K1", "investment", "aio", "2026-09-01T00:00:00Z", "2026-09-05T00:00:00Z"), withNarrative("K2", "subsidy", "builder-x", "2026-10-01T00:00:00Z", "2026-10-09T00:00:00Z"), camp("K3")];
  it("the filter options are the narratives and platforms present in the campaigns, with the number of campaigns", () => {
    expect(narrativeOptions(list)).toEqual([{ id: "investment", label: "investment", campaigns: 1 }, { id: "subsidy", label: "subsidies and benefits", campaigns: 1 }]);
    expect(platformOptions(list)).toEqual([{ id: "aio", campaigns: 1 }, { id: "builder-x", campaigns: 1 }]);
  });
  it("the narrative, platform and period filter narrows the list; an empty filter does not", () => {
    const ids = (f: Parameters<typeof campaignMatchesFilter>[1]) => list.filter((c) => campaignMatchesFilter(c, f)).map((c) => c.id);
    expect(ids({})).toEqual(["K1", "K2", "K3"]);
    expect(ids({ topic: "subsidy" })).toEqual(["K2"]);
    expect(ids({ platform: "aio" })).toEqual(["K1"]);
    expect(ids({ from: "2026-09-20" })).toEqual(["K2"]);
    expect(ids({ to: "2026-09-10" })).toEqual(["K1"]);
  });
});
