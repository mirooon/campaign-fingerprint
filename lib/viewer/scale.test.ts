import { describe, expect, it } from "vitest";
import type { MaterialItemResult, MaterialLink } from "@/lib/pipeline/analyzeMaterial";
import { closestLink, familyThresholdFromRules, nearestCampaignOf, verdictScale } from "./scale";

const T = { campaign: 0.15, family: 0.3 };

function link(other: string, otherCampaign: string | null, score: number, rule: MaterialLink["rule"] = "below"): MaterialLink {
  return { other, otherCampaign, score, strong: false, rule, evidence: [] };
}
function item(over: Partial<MaterialItemResult>): MaterialItemResult {
  return { id: "n1", verdict: "new_campaign", verdictText: "", campaign: null, similarCampaigns: [], apart: [], withNew: [], links: [], features: {}, errors: [], ...over };
}

describe("closestLink", () => {
  it("najbliższy znany materiał to powiązanie o najwyższym wyniku, także poniżej progu", () => {
    expect(closestLink(item({ links: [link("a", "K01", 0.05), link("b", "K02", 0.12)] }))?.other).toBe("b");
    expect(closestLink(item({}))).toBeNull();
  });
});

describe("verdictScale", () => {
  it("nowy wzorzec: najbliższy materiał z wynikiem i progiem kampanii", () => {
    const s = verdictScale(item({ links: [link("k2-03", "K02", 0.12)] }), T);
    expect(s.zone).toBe("new");
    expect(s.sentence).toBe("Najbliższy znany materiał (k2-03, kampania K02) ma wynik 0,12, próg łączenia w kampanię to 0,15.");
    expect(s.closest).toEqual({ id: "k2-03", score: 0.12 });
  });
  it("nowy wzorzec bez żadnego powiązania", () => {
    expect(verdictScale(item({}), T).sentence).toBe("Żaden znany materiał nie ma wspólnego śladu z tym materiałem.");
  });
  it("znana kampania: wynik przekracza próg", () => {
    const s = verdictScale(item({ verdict: "known_campaign", campaign: "K01", links: [link("a", "K01", 0.82, "campaign")] }), T);
    expect(s.zone).toBe("campaign");
    expect(s.sentence).toBe("Wynik 0,82 z materiałem a przekracza próg łączenia w kampanię 0,15.");
  });
  it("wynik ponad progiem, ale reguła zmieniła rezultat na grupę podobnych", () => {
    const s = verdictScale(item({ verdict: "similar_campaigns", similarCampaigns: ["K01"], links: [link("a", "K01", 0.6, "account_conflict")] }), T);
    expect(s.zone).toBe("family");
    expect(s.sentence).toContain("Wynik 0,60 jest ponad progiem");
    expect(s.sentence).toBe("Wynik 0,60 jest ponad progiem łączenia w kampanię (0,15), ale to różne konta na platformie stron, czyli różni operatorzy, więc to grupa podobnych kampanii, nie ta sama kampania.");
    expect(s.sentence).toContain("grupa podobnych kampanii");
  });
  it("podobna kampania z wynikiem poniżej progu kampanii nazywa próg grupy", () => {
    const s = verdictScale(item({ verdict: "similar_campaigns", similarCampaigns: ["K01"], links: [link("a", "K01", 0.35, "single_kind")] }), { campaign: 0.5, family: 0.3 });
    expect(s.sentence).toBe("Wynik 0,35 jest poniżej progu łączenia w kampanię (0,50), ale ponad progiem grupy podobnych (0,30), więc to grupa podobnych kampanii, nie ta sama kampania.");
  });
});

describe("familyThresholdFromRules", () => {
  it("czyta próg grupy z opisu reguł bazy, a bez niego zwraca domyślny", () => {
    expect(familyThresholdFromRules(["kampania: …", "grupa podobnych kampanii: pozostałe powiązania … ≥ 0.35"])).toBe(0.35);
    expect(familyThresholdFromRules(undefined)).toBe(0.3);
    expect(familyThresholdFromRules(["nic"])).toBe(0.3);
  });
});

describe("nearestCampaignOf", () => {
  const links = [
    { a: "s1", b: "x1", score: 0.22 },
    { a: "x2", b: "s1", score: 0.1 },
    { a: "s1", b: "same", score: 0.9 },
  ];
  const assignments = { s1: "K09", x1: "K02", x2: "K03", same: "K09" };
  it("najbliższa inna kampania z materiałem i wynikiem, własna pominięta", () => {
    expect(nearestCampaignOf("s1", links, assignments)).toEqual({ campaign: "K02", material: "x1", score: 0.22 });
  });
  it("materiał bez powiązań z innymi kampaniami nie ma najbliższej", () => {
    expect(nearestCampaignOf("zz", links, assignments)).toBeNull();
  });
});
