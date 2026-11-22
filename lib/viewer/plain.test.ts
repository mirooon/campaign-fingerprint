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
  it("premise of the same creative file is not worded as a similar picture", () => {
    expect(premiseSentence({ evidence: "ten sam plik kreacji (plik obrazu, SHA-256 abc…)", pivotType: "imagehash", pivot: "imagehash:sha256:abc" })).toBe("Reklamy mają ten sam plik reklamy (identyczny co do bajtu)");
    expect(premiseSentence({ evidence: "identyczny obraz (dHash 1)", pivotType: "imagehash", pivot: "imagehash:8084ac1a1e0ca1a4" })).toBe("Reklamy mają identyczny obraz");
  });
  it("cleans jargon from descriptions", () => {
    expect(cleanEvidence("prawie identyczna kreacja (dHash, odległość Hamminga 3/64)")).toBe("prawie identyczna kreacja");
  });
  it("glossary has the terms outside the P0 list used on screen (B-034)", () => {
    for (const k of ["sprawa", "strona_przyneta", "lejek", "transkrypcja", "biblioteka_reklam", "baza_osob", "rozbrojony_adres", "znizka", "odcisk_obrazu", "odcisk_budowy"] as const) {
      expect(GLOSSARY[k].term.length).toBeGreaterThan(2);
      expect(GLOSSARY[k].text.length).toBeGreaterThan(40);
    }
  });
  it("glossary has the P0 terms", () => {
    for (const k of ["material", "cecha", "wspolny_slad", "przeslanka", "sila_przeslanki", "sila_powiazania", "pewnosc", "prog_laczenia", "kampania", "grupa_podobnych", "duplikat", "pominiety_slad", "persona", "za_malo_danych", "har", "ocr", "trasa_klikniecia"] as const) {
      expect(GLOSSARY[k].text.length).toBeGreaterThan(20);
    }
  });
});
