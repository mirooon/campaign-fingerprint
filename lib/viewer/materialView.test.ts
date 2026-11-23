import { describe, expect, it } from "vitest";
import type { MaterialItemResult, MaterialResult } from "@/lib/pipeline/analyzeMaterial";
import { batchSummary, filterItems, resultConfidence, resultRows, shownConfidence, sortItems, unreadHints, unreadMaterials, unreadVisible, variantNote } from "./materialView";

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
    item("b", { verdict: "similar_campaigns", similarCampaigns: ["K01", "K02"], links: [weakLink] }),
    item("c"),
    item("d", { verdict: "duplicate", campaign: "K01", duplicateOf: { id: "a", reason: "ten sam plik" } }),
    item("e", { verdict: "insufficient", missing: ["zrzut z paskiem adresu"] }),
    item("f", { verdict: "known_campaign", campaign: "K01", campaignBasis: "content_variant", links: [{ ...weakLink, variant: true }] }),
  ],
  skipped: [],
  notes: [],
};

describe("batchSummary", () => {
  it("the funnel numbers add up: samples = duplicates + known + new + insufficient data", () => {
    const s = batchSummary(result, 9);
    expect(s.files).toBe(9);
    expect(s.materials).toBe(6);
    expect(s.duplicates).toBe(1);
    expect(s.known).toBe(2);
    expect(s.fresh).toBe(2);
    expect(s.insufficient).toBe(1);
    expect(s.duplicates + s.known + s.fresh + s.insufficient).toBe(s.materials);
    expect(s.linkedToBase).toBe(3);
    expect(s.unread).toBe(0);
    expect(s.withErrors).toBe(0);
  });
  it("a case the import could not read counts as an “insufficient data” sample and as an error", () => {
    // HTML without a URL as a separate sample: 3 files, 2 records, 1 case in skipped
    const s = batchSummary({ items: [item("m1"), item("m2")], skipped: [{ id: "strona", reason: "brak adresu strony (ani komentarza „saved from url”, ani dokumentu w HAR)" }] }, 3);
    expect(s.materials).toBe(3);
    expect(s.unread).toBe(1);
    expect(s.insufficient).toBe(1);
    expect(s.withErrors).toBe(1);
    expect(s.duplicates + s.known + s.fresh + s.insufficient).toBe(s.materials);
  });
  it("a skipped file of a case that gave a record is not a separate sample", () => {
    const s = batchSummary({ items: [item("m1", { caseId: "sprawa-1" })], skipped: [{ id: "sprawa-1/kopia.html", reason: "brak adresu strony" }] }, 2);
    expect(s.materials).toBe(1);
    expect(s.unread).toBe(0);
  });
});

describe("unreadMaterials", () => {
  const res = {
    items: [item("m1", { caseId: "sprawa-1" })],
    skipped: [
      { id: "sprawa-2/strona.html", reason: "no page URL (no “saved from url” comment and no document in a HAR)" },
      { id: "sprawa-2/stara.har", reason: "HAR without document content and no saved page" },
      { id: "sprawa-2/druga.html", reason: "no page URL (no “saved from url” comment and no document in a HAR)" },
      { id: "sprawa-1/kopia.html", reason: "no page URL (no “saved from url” comment and no document in a HAR)" },
      { id: "sprawa-3", reason: "no page, screenshot or video in the folder" },
    ],
  };
  it("one entry per case without a record, with reasons without repeats and advice on what to add", () => {
    const list = unreadMaterials(res);
    expect(list.map((u) => u.id)).toEqual(["sprawa-2", "sprawa-3"]);
    expect(list[0].reasons).toHaveLength(2);
    expect(list[0].hints.join(" ")).toMatch(/HAR/);
    expect(list[1].hints.join(" ")).toMatch(/ad screenshot/);
  });
  it("the same cases as the “insufficient” rows of the export", () => {
    const rows = resultRows(res);
    expect(rows.map((r) => r.material_id)).toEqual(["m1", "sprawa-2", "sprawa-3"]);
    expect(rows[1].verdict).toBe("insufficient");
    expect(rows[1].confidence).toBe("uncertain");
  });
  it("the advice for a missing page URL mentions a HAR; a reason without advice gives no empty lines", () => {
    expect(unreadHints(["no page URL (no “saved from url” comment and no document in a HAR)"]).join(" ")).toMatch(/add a HAR/i);
    expect(unreadHints(["something else"])).toEqual([]);
    expect(unreadHints(["no page URL", "no page URL"])).toHaveLength(2);
  });
  it("rows of unread cases show for “all” and “insufficient data”", () => {
    expect(unreadVisible("all")).toBe(true);
    expect(unreadVisible("insufficient")).toBe(true);
    expect(unreadVisible("known")).toBe(false);
    expect(unreadVisible("uncertain")).toBe(false);
  });
});

describe("filterItems", () => {
  it("filters by verdict; new = new campaign + similar to known ones", () => {
    expect(filterItems(result.items, "all")).toHaveLength(6);
    expect(filterItems(result.items, "fresh").map((i) => i.id)).toEqual(["b", "c"]);
    expect(filterItems(result.items, "duplicate").map((i) => i.id)).toEqual(["d"]);
    expect(filterItems(result.items, "insufficient").map((i) => i.id)).toEqual(["e"]);
  });
});

describe("resultConfidence", () => {
  it("a variant by the creative is not “certain”", () => {
    expect(resultConfidence(result.items[0])).toBe("certain");
    expect(resultConfidence(result.items[5])).not.toBe("certain");
  });
  it("no confidence for “insufficient data”", () => {
    expect(resultConfidence(result.items[4])).toBeNull();
  });
});

describe("variantNote", () => {
  it("describes the variant and names the sample the creative is similar to", () => {
    expect(variantNote(result.items[5])).toContain("lower confidence");
    expect(variantNote(result.items[0])).toBeNull();
  });
});

describe("resultRows", () => {
  it("export rows have their columns in a fixed order", () => {
    const rows = resultRows(result);
    expect(Object.keys(rows[0])).toEqual(["material_id", "case", "verdict", "campaign_id", "similar_campaigns", "new_campaign_id", "duplicate_of", "confidence", "score", "top_premise", "missing_data", "near_misses"]);
    expect(rows[3].duplicate_of).toBe("a");
  });
});

describe("filterItems: uncertain to check", () => {
  it("the “uncertain” filter keeps only samples shown as uncertain, without “insufficient data” and without “no shared traces”", () => {
    const rows = filterItems(result.items, "uncertain");
    expect(rows.map((i) => i.id)).toEqual(["b", "f"]);
    expect(rows.every((i) => resultConfidence(i) === "uncertain")).toBe(true);
  });
});

describe("shownConfidence", () => {
  it("a new sample without any link to the base: “no shared traces”, not “close to the threshold”; the export stays “uncertain”", () => {
    const c = result.items[2];
    expect(shownConfidence(c)).toBe("no_traces");
    expect(resultConfidence(c)).toBe("uncertain");
    expect(resultRows(result)[2].confidence).toBe("uncertain");
  });
  it("a link below the threshold stays “uncertain”", () => {
    expect(shownConfidence(result.items[1])).toBe("uncertain");
    expect(shownConfidence(item("g", { links: [{ ...weakLink, otherCampaign: "K03", score: 0.1, rule: "below" }] }))).toBe("uncertain");
  });
  it("a duplicate without links does not get “no shared traces” (it is a copy of another sample)", () => {
    expect(shownConfidence(item("h", { verdict: "duplicate", duplicateOf: { id: "c", reason: "ten sam plik" } }))).toBe("uncertain");
  });
  it("the other levels are unchanged", () => {
    expect(shownConfidence(result.items[0])).toBe("certain");
    expect(shownConfidence(result.items[4])).toBeNull();
  });
});

describe("sortItems", () => {
  it("by verdict: known, similar, new, duplicates, insufficient data", () => {
    expect(sortItems(result.items, "verdict").map((i) => i.id)).toEqual(["a", "f", "b", "c", "d", "e"]);
  });
  it("by confidence: certain, likely, uncertain, no shared traces, no confidence last", () => {
    expect(sortItems(result.items, "confidence").map((i) => i.id)).toEqual(["a", "d", "b", "f", "c", "e"]);
  });
});
