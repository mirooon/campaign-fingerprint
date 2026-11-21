import { describe, expect, it } from "vitest";
import type { Campaign } from "@/lib/graph/model";
import { basisNote, campaignTitle, cohesionLabel, groupCampaigns } from "./campaignView";

function camp(id: string, over: Partial<Campaign> = {}): Campaign {
  return {
    id, size: 3, members: [], firstSeen: null, lastSeen: null, topEvidence: [], domains: ["a.example"], advertisers: [], cohesion: 0.8, strongComponents: 1,
    attributes: { personas: [{ id: "adam-testowy", name: "Adam Testowy", count: 2 }], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null }, ...over,
  };
}

describe("campaignTitle", () => {
  it("składa osobę i domenę z identyfikatorem", () => {
    expect(campaignTitle(camp("K03"))).toBe("Adam Testowy · a.example · K03");
  });
  it("bez persony i domeny zostaje sam identyfikator", () => {
    expect(campaignTitle(camp("K04", { domains: [], attributes: { personas: [], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null } }))).toBe("K04");
  });
});

describe("cohesionLabel", () => {
  it("opisuje siłę powiązań słowem i liczbą z przecinkiem", () => {
    expect(cohesionLabel(0.82)).toBe("wysoka (0,82)");
    expect(cohesionLabel(0.5)).toBe("średnia (0,50)");
    expect(cohesionLabel(0.2)).toBe("niska (0,20)");
  });
});

describe("basisNote", () => {
  it("tylko kampania z treści dostaje etykietę słabszej podstawy", () => {
    expect(basisNote(camp("K1", { attributes: { personas: [], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null, basis: "content" } }))).toBe("kampania z treści, bez infrastruktury");
    expect(basisNote(camp("K2", { attributes: { personas: [], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null, basis: "infrastructure" } }))).toBeNull();
    expect(basisNote(camp("K3"))).toBeNull();
  });
});

describe("groupCampaigns", () => {
  it("dzieli na grupy podobnych, pojedyncze kampanie i materiały bez powiązań", () => {
    const list = [camp("K1", { familyId: "R1" }), camp("K2", { familyId: "R1" }), camp("K3"), camp("K4", { size: 1 })];
    const g = groupCampaigns(list, [{ id: "R1", campaigns: ["K1", "K2"], members: [], size: 6, topEvidence: [], apart: [] }]);
    expect(g.families).toHaveLength(1);
    expect(g.families[0].campaigns.map((c) => c.id)).toEqual(["K1", "K2"]);
    expect(g.alone.map((c) => c.id)).toEqual(["K3"]);
    expect(g.singletons.map((c) => c.id)).toEqual(["K4"]);
  });
});
