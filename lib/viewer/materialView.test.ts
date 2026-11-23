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
    expect(s.unread).toBe(0);
    expect(s.withErrors).toBe(0);
  });
  it("sprawa, której import nie odczytał, liczy się jako materiał „za mało danych” i jako błąd", () => {
    // HTML bez adresu jako osobny materiał: 3 pliki, 2 rekordy, 1 sprawa w skipped
    const s = batchSummary({ items: [item("m1"), item("m2")], skipped: [{ id: "strona", reason: "brak adresu strony (ani komentarza „saved from url”, ani dokumentu w HAR)" }] }, 3);
    expect(s.materials).toBe(3);
    expect(s.unread).toBe(1);
    expect(s.insufficient).toBe(1);
    expect(s.withErrors).toBe(1);
    expect(s.duplicates + s.known + s.fresh + s.insufficient).toBe(s.materials);
  });
  it("pominięty plik sprawy, która dała rekord, nie jest osobnym materiałem", () => {
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
  it("jedna pozycja na sprawę bez rekordu, z powodami bez powtórzeń i radą, co dorzucić", () => {
    const list = unreadMaterials(res);
    expect(list.map((u) => u.id)).toEqual(["sprawa-2", "sprawa-3"]);
    expect(list[0].reasons).toHaveLength(2);
    expect(list[0].hints.join(" ")).toMatch(/HAR/);
    expect(list[1].hints.join(" ")).toMatch(/zrzut reklamy/);
  });
  it("te same sprawy co wiersze „insufficient” w eksporcie", () => {
    const rows = resultRows(res);
    expect(rows.map((r) => r.material_id)).toEqual(["m1", "sprawa-2", "sprawa-3"]);
    expect(rows[1].verdict).toBe("insufficient");
    expect(rows[1].confidence).toBe("uncertain");
  });
  it("rada dla braku adresu strony mówi o HAR; powód bez rady nie daje pustych linii", () => {
    expect(unreadHints(["no page URL (no “saved from url” comment and no document in a HAR)"]).join(" ")).toMatch(/dołącz HAR/i);
    expect(unreadHints(["coś innego"])).toEqual([]);
    expect(unreadHints(["no page URL", "no page URL"])).toHaveLength(2);
  });
  it("wiersze nieodczytanych spraw widać przy „wszystkie” i „za mało danych”", () => {
    expect(unreadVisible("all")).toBe(true);
    expect(unreadVisible("insufficient")).toBe(true);
    expect(unreadVisible("known")).toBe(false);
    expect(unreadVisible("uncertain")).toBe(false);
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
    expect(Object.keys(rows[0])).toEqual(["material_id", "case", "verdict", "campaign_id", "similar_campaigns", "new_campaign_id", "duplicate_of", "confidence", "score", "top_premise", "missing_data", "near_misses"]);
    expect(rows[3].duplicate_of).toBe("a");
  });
});

describe("filterItems: niepewne do sprawdzenia", () => {
  it("filtr „uncertain” zostawia tylko materiały pokazane jako niepewne, bez „za mało danych” i bez „brak wspólnych śladów”", () => {
    const rows = filterItems(result.items, "uncertain");
    expect(rows.map((i) => i.id)).toEqual(["b", "f"]);
    expect(rows.every((i) => resultConfidence(i) === "uncertain")).toBe(true);
  });
});

describe("shownConfidence", () => {
  it("nowy materiał bez żadnego powiązania z bazą: „brak wspólnych śladów”, nie „blisko progu”; eksport zostaje „uncertain”", () => {
    const c = result.items[2];
    expect(shownConfidence(c)).toBe("no_traces");
    expect(resultConfidence(c)).toBe("uncertain");
    expect(resultRows(result)[2].confidence).toBe("uncertain");
  });
  it("powiązanie poniżej progu zostaje „niepewne”", () => {
    expect(shownConfidence(result.items[1])).toBe("uncertain");
    expect(shownConfidence(item("g", { links: [{ ...weakLink, otherCampaign: "K03", score: 0.1, rule: "below" }] }))).toBe("uncertain");
  });
  it("duplikat bez powiązań nie dostaje „brak wspólnych śladów” (to kopia innego materiału)", () => {
    expect(shownConfidence(item("h", { verdict: "duplicate", duplicateOf: { id: "c", reason: "ten sam plik" } }))).toBe("uncertain");
  });
  it("pozostałe poziomy bez zmian", () => {
    expect(shownConfidence(result.items[0])).toBe("certain");
    expect(shownConfidence(result.items[4])).toBeNull();
  });
});

describe("sortItems", () => {
  it("po werdykcie: znane, podobne, nowe, duplikaty, za mało danych", () => {
    expect(sortItems(result.items, "verdict").map((i) => i.id)).toEqual(["a", "f", "b", "c", "d", "e"]);
  });
  it("po pewności: pewne, prawdopodobne, niepewne, brak wspólnych śladów, bez pewności na końcu", () => {
    expect(sortItems(result.items, "confidence").map((i) => i.id)).toEqual(["a", "d", "b", "f", "c", "e"]);
  });
});
