import { describe, expect, it } from "vitest";
import { CONFIDENCE_INFO, DEFAULT_KIT_ONLY, evidenceStrength, kitOnlyFromRules, ruleText, sortByStrength, STRENGTH_INFO } from "./strength";

const ev = (o: Partial<Parameters<typeof evidenceStrength>[0]>) => ({ strong: false, discounted: false, weight: 0.4, ...o });

describe("evidenceStrength (§6.1)", () => {
  it("strong and not discounted -> high", () => {
    expect(evidenceStrength(ev({ strong: true, pivotType: "platform_account", weight: 0.9 }))).toBe("high");
  });
  it("discounted -> discounted, even when strong", () => {
    expect(evidenceStrength(ev({ discounted: true, pivotType: "registrar" }))).toBe("skipped");
    expect(evidenceStrength(ev({ discounted: true, strong: true, pivotType: "domain" }))).toBe("skipped");
  });
  it("non-kit type with weight >= 0.1 -> medium", () => {
    expect(evidenceStrength(ev({ pivotType: "ip", weight: 0.1 }))).toBe("medium");
    expect(evidenceStrength(ev({ edgeType: "similar_text", weight: 0.48 }))).toBe("medium");
  });
  it("kit-only type or weight < 0.1 -> needs corroboration", () => {
    expect(evidenceStrength(ev({ pivotType: "page_template", weight: 0.6 }))).toBe("confirm");
    expect(evidenceStrength(ev({ edgeType: "similar_dom", weight: 0.45 }))).toBe("confirm");
    expect(evidenceStrength(ev({ pivotType: "asn", weight: 0.027 }))).toBe("confirm");
    expect(evidenceStrength(ev({ pivotType: "persona", weight: 0.07 }))).toBe("confirm");
  });
  it("without the type (older backend) only high, medium and discounted", () => {
    expect(evidenceStrength(ev({ weight: 0.02 }))).toBe("medium");
    expect(evidenceStrength(ev({ strong: true }))).toBe("high");
    expect(evidenceStrength(ev({ discounted: true }))).toBe("skipped");
  });
  it("modus operandi is a description, not linking evidence", () => {
    expect(evidenceStrength(ev({ pivotType: "technique", weight: 0.2 }))).toBe("descriptive");
  });
  it("sorts strongest first", () => {
    const list = [ev({ discounted: true, weight: 0.9 }), ev({ pivotType: "ip", weight: 0.3 }), ev({ strong: true, weight: 0.7 }), ev({ pivotType: "ip", weight: 0.5 })];
    expect(sortByStrength(list).map((e) => e.weight)).toEqual([0.7, 0.5, 0.3, 0.9]);
  });
});

describe("kitOnlyFromRules", () => {
  it("reads the list from method.rules", () => {
    const rules = ["kampania: silny dowód albo wynik pary ≥ 0.15; sama cecha zestawu stron lub persona (similar_dom, comment, asset, comment_block) wymaga drugiego rodzaju dowodu albo wyniku ≥ 0.5"];
    expect([...kitOnlyFromRules(rules)]).toEqual(["similar_dom", "comment", "asset", "comment_block"]);
  });
  it("falls back to the default list", () => {
    expect([...kitOnlyFromRules(undefined)]).toEqual([...DEFAULT_KIT_ONLY]);
    expect([...kitOnlyFromRules(["inna reguła"])]).toEqual([...DEFAULT_KIT_ONLY]);
  });
});

describe("words", () => {
  it("strength and confidence never share words", () => {
    const s = Object.values(STRENGTH_INFO).map((x) => x.label.toLowerCase());
    const c = Object.values(CONFIDENCE_INFO).map((x) => x.label.toLowerCase());
    for (const w of c) for (const l of s) expect(l.split(/[^a-z]+/).includes(w.split(" ")[0])).toBe(false);
    expect(s.some((l) => l.includes("certain") || l.includes("likely"))).toBe(false);
  });
  it("rule verdicts in plain English", () => {
    expect(ruleText("campaign", 0.15)).toBe("links into a campaign");
    expect(ruleText("below", 0.15)).toBe("too weak: below the linking threshold (0.15)");
    expect(ruleText("single_kind", 0.15)).toMatch(/similar campaign/);
    expect(ruleText("account_conflict", 0.15)).toMatch(/different operators/);
  });
});
