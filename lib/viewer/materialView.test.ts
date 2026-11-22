import { describe, expect, it } from "vitest";
import type { MaterialItemResult, MaterialResult } from "@/lib/pipeline/analyzeMaterial";
import { batchSummary, filterItems, resultConfidence, resultRows, variantNote } from "./materialView";

function item(id: string, over: Partial<MaterialItemResult> = {}): MaterialItemResult {
  return { id, caseId: id, verdict: "new_campaign", verdictText: "", campaign: null, similarCampaigns: [], apart: [], withNew: [], links: [], features: {}, errors: [], ...over };
}

const strongLink = { other: "x", otherCampaign: "K01", score: 0.8, strong: true, rule: "campaign" as const, evidence: [{ evidence: "to samo konto", weight: 0.9, strong: true, discounted: false }] };
const weakLink = { ...strongLink, strong: false, score: 0.3, evidence: [{ evidence: "podobny obraz", weight: 0.3, strong: false, discounted: false }] };

const result: MaterialResult = {
  mode: "offline",
  steps: [],
  items: [
    item("a", { verdict: "known_campaign", campaign: "K01", links: [strongLink] }),
    item("b", { verdict: "similar_campaigns", similarCampaigns: ["K01", "K02"] }),
    item("c"),
    item("d", { verdict: "duplicate", campaign: "K01", duplicateOf: { id: "a", reason: "ten sam plik" } }),
    item("e", { verdict: "insufficient", missing: ["zrzut z paskiem adresu"] }),
    item("f", { verdict: "known_campaign", campaign: "K01", campaignBasis: "content_variant", links: [{ ...weakLink, variant: true }] }),
  ],
  skipped: [],
  notes: [],
};

describe("batchSummary", () => {
  it("liczby lejka sumują się: materiały = duplikaty + znane + nowe + za mało danych", () => {
    const s = batchSummary(result, 9);
    expect(s.files).toBe(9);
    expect(s.materials).toBe(6);
    expect(s.duplicates).toBe(1);
    expect(s.known).toBe(2);
    expect(s.fresh).toBe(2);
    expect(s.insufficient).toBe(1);
    expect(s.duplicates + s.known + s.fresh + s.insufficient).toBe(s.materials);
    expect(s.linkedToBase).toBe(3);
  });
});

describe("filterItems", () => {
  it("filtruje po werdykcie; nowe = nowa kampania + podobna do znanych", () => {
    expect(filterItems(result.items, "all")).toHaveLength(6);
    expect(filterItems(result.items, "fresh").map((i) => i.id)).toEqual(["b", "c"]);
    expect(filterItems(result.items, "duplicate").map((i) => i.id)).toEqual(["d"]);
    expect(filterItems(result.items, "insufficient").map((i) => i.id)).toEqual(["e"]);
  });
});

describe("resultConfidence", () => {
  it("wariant po kreacji nie jest „pewny”", () => {
    expect(resultConfidence(result.items[0])).toBe("certain");
    expect(resultConfidence(result.items[5])).not.toBe("certain");
  });
  it("brak pewności dla „za mało danych”", () => {
    expect(resultConfidence(result.items[4])).toBeNull();
  });
});

describe("variantNote", () => {
  it("opisuje wariant i wskazuje materiał, do którego kreacja jest podobna", () => {
    expect(variantNote(result.items[5])).toContain("niższa pewność");
    expect(variantNote(result.items[0])).toBeNull();
  });
});

describe("resultRows", () => {
  it("wiersze eksportu mają kolumny w ustalonej kolejności", () => {
    const rows = resultRows(result);
    expect(Object.keys(rows[0])).toEqual(["material_id", "case", "verdict", "campaign_id", "similar_campaigns", "new_campaign_id", "duplicate_of", "confidence", "score", "top_premise", "missing_data", "blisko_bez_polaczenia"]);
    expect(rows[3].duplicate_of).toBe("a");
  });
});
