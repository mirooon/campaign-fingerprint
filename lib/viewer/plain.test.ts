import { describe, expect, it } from "vitest";
import { ENTITY_TYPES, SIMILARITY_EDGE_TYPES } from "@/lib/graph/model";
import { TYPE_FAMILY } from "./families";
import { cleanEvidence, GLOSSARY, premiseFamily, premiseSentence, TYPE_INFO } from "./plain";

describe("plain dictionary", () => {
  it("every entity and similarity type has a name, explanation, example, sentence and family", () => {
    for (const t of [...ENTITY_TYPES, ...SIMILARITY_EDGE_TYPES]) {
      const i = TYPE_INFO[t];
      expect(i.name && i.what && i.why && i.example && i.sentence, t).toBeTruthy();
      if (t !== "item") expect(TYPE_FAMILY[t], t).toBeTruthy();
    }
  });
  it("premise sentence from the type, cleaned description otherwise", () => {
    expect(premiseSentence({ evidence: "x", pivotType: "platform_account" })).toBe("Obie strony należą do tego samego konta na platformie stron");
    expect(premiseSentence({ evidence: "ten sam rejestrator X — zdyskontowane: popularny rejestrator (×0.6)" })).toBe("Ten sam rejestrator X");
    expect(premiseFamily({ evidence: "", edgeType: "similar_dom" })).toBe("page");
    expect(premiseFamily({ evidence: "" })).toBeNull();
  });
  it("cleans jargon from descriptions", () => {
    expect(cleanEvidence("prawie identyczna kreacja (dHash, odległość Hamminga 3/64)")).toBe("prawie identyczna kreacja");
  });
  it("glossary has the P0 terms", () => {
    for (const k of ["material", "cecha", "wspolny_slad", "przeslanka", "sila_przeslanki", "sila_powiazania", "pewnosc", "prog_laczenia", "kampania", "grupa_podobnych", "duplikat", "pominiety_slad", "persona", "za_malo_danych", "har", "ocr"] as const) {
      expect(GLOSSARY[k].text.length).toBeGreaterThan(20);
    }
  });
});
