import { describe, expect, it } from "vitest";
import type { Campaign } from "@/lib/graph/model";
import { baseCounts, basisNote, campaignAnchorId, campaignIdInQuery, campaignMatchesFilter, campaignTitle, cohesionLabel, groupCampaigns, narrativeOptions, platformOptions, singlesInFamilyFrames, singleToReveal } from "./campaignView";

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
    expect(cohesionLabel(0.82)).toBe("wysoka (0.82)");
    expect(cohesionLabel(0.5)).toBe("średnia (0.50)");
    expect(cohesionLabel(0.2)).toBe("niska (0.20)");
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

describe("liczby bazy w nagłówku", () => {
  const list = [camp("K1"), camp("K2"), camp("K3", { size: 1 }), camp("K4", { size: 1 }), camp("K5", { size: 1 })];
  const families = [{ id: "R1", campaigns: ["K2", "K3"], members: [], size: 4, topEvidence: [], apart: [] }];

  it("kampanie z co najmniej dwoma materiałami, pojedyncze materiały (też w ramkach grup) i grupy dają razem wszystkie numery K", () => {
    const c = baseCounts(list, families);
    expect(c).toEqual({ campaigns: 2, singles: 3, singlesInFamilies: 1, families: 1 });
    expect(c.campaigns + c.singles).toBe(list.length);
  });

  it("zwinięta sekcja zakładki Kampanie to pojedyncze materiały poza ramkami grup: razem z ramkami daje liczbę z nagłówka", () => {
    const g = groupCampaigns(list, families);
    expect(g.singletons.length + singlesInFamilyFrames(g)).toBe(baseCounts(list, families).singles);
    expect(singlesInFamilyFrames(g)).toBe(1);
  });
});

describe("pojedynczy materiał otwarty z zewnątrz", () => {
  const singles = [camp("K50", { size: 1 }), camp("K51", { size: 1 })];

  it("rozwija zwiniętą sekcję tylko dla otwartego pojedynczego materiału z tej sekcji", () => {
    expect(singleToReveal(singles, "K50")).toBe("K50");
    expect(singleToReveal(singles, "K03")).toBeNull();
    expect(singleToReveal(singles, null)).toBeNull();
    expect(singleToReveal([], "K50")).toBeNull();
  });

  it("dokładny numer kampanii w wyszukiwarce wskazuje kartę do otwarcia, bez względu na wielkość liter i spacje", () => {
    const all = [camp("K03"), ...singles];
    expect(campaignIdInQuery(all, "K50")).toBe("K50");
    expect(campaignIdInQuery(all, " k50 ")).toBe("K50");
    expect(campaignIdInQuery(all, "K5")).toBeNull();
    expect(campaignIdInQuery(all, "")).toBeNull();
    expect(campaignIdInQuery(all, "a.example")).toBeNull();
  });

  it("karta ma stały identyfikator elementu do przewinięcia", () => {
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

describe("nazwa i filtry kampanii z narracją (B-033)", () => {
  it("nazwa kampanii zawiera główny temat narracji między osobą a domeną", () => {
    expect(campaignTitle(withNarrative("K05", "investment", "aio", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z"))).toBe("inwestycje · a.example · K05");
    expect(campaignTitle(camp("K03", { attributes: { personas: [{ id: "a", name: "Adam Testowy", count: 1 }], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null, narrative: { topics: [{ id: "health", count: 1, firstSeen: null, lastSeen: null, subtopics: ["joints"] }], hooks: [], labels: [], switches: [] } } }))).toBe("Adam Testowy · zdrowie (stawy) · a.example · K03");
  });
  const list = [withNarrative("K1", "investment", "aio", "2026-09-01T00:00:00Z", "2026-09-05T00:00:00Z"), withNarrative("K2", "subsidy", "builder-x", "2026-10-01T00:00:00Z", "2026-10-09T00:00:00Z"), camp("K3")];
  it("opcje filtra to narracje i platformy obecne w kampaniach, z liczbą kampanii", () => {
    expect(narrativeOptions(list)).toEqual([{ id: "subsidy", label: "dotacje i świadczenia", campaigns: 1 }, { id: "investment", label: "inwestycje", campaigns: 1 }]);
    expect(platformOptions(list)).toEqual([{ id: "aio", campaigns: 1 }, { id: "builder-x", campaigns: 1 }]);
  });
  it("filtr narracji, platformy i okresu zawęża listę; pusty filtr nie zawęża", () => {
    const ids = (f: Parameters<typeof campaignMatchesFilter>[1]) => list.filter((c) => campaignMatchesFilter(c, f)).map((c) => c.id);
    expect(ids({})).toEqual(["K1", "K2", "K3"]);
    expect(ids({ topic: "subsidy" })).toEqual(["K2"]);
    expect(ids({ platform: "aio" })).toEqual(["K1"]);
    expect(ids({ from: "2026-09-20" })).toEqual(["K2"]);
    expect(ids({ to: "2026-09-10" })).toEqual(["K1"]);
  });
});
