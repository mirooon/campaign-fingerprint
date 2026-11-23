import { describe, expect, it } from "vitest";
import { ENTITY_TYPES, SIMILARITY_EDGE_TYPES } from "@/lib/graph/model";
import { TYPE_FAMILY } from "./families";
import { cleanEvidence, featureInfo, GLOSSARY, premiseFamily, premiseSentence, TECHNIQUE_INFO, TECHNIQUE_LABEL, TYPE_INFO } from "./plain";

describe("plain dictionary", () => {
  it("every entity and similarity type has a name, explanation, example, sentence and family", () => {
    for (const t of [...ENTITY_TYPES, ...SIMILARITY_EDGE_TYPES]) {
      const i = TYPE_INFO[t];
      expect(i.name && i.what && i.why && i.example && i.sentence, t).toBeTruthy();
      if (t !== "item") expect(TYPE_FAMILY[t], t).toBeTruthy();
    }
  });
  it("premise sentence from the type, cleaned description otherwise", () => {
    expect(premiseSentence({ evidence: "x", pivotType: "platform_account" })).toBe("Both pages belong to the same page-builder account");
    expect(premiseSentence({ evidence: "same registrar X — discounted: popular registrar (×0.6)" })).toBe("Same registrar X");
    expect(premiseSentence({ evidence: "ten sam rejestrator X — zdyskontowane: popularny rejestrator (×0.6)" })).toBe("Ten sam rejestrator X");
    expect(premiseFamily({ evidence: "", edgeType: "similar_dom" })).toBe("page");
    expect(premiseFamily({ evidence: "" })).toBeNull();
  });
  it("premise of the same creative file is not worded as a similar picture", () => {
    expect(premiseSentence({ evidence: "ten sam plik kreacji (plik obrazu, SHA-256 abc…)", pivotType: "imagehash", pivot: "imagehash:sha256:abc" })).toBe("The ads have the same ad file (byte-for-byte identical)");
    expect(premiseSentence({ evidence: "identyczny obraz (dHash 1)", pivotType: "imagehash", pivot: "imagehash:8084ac1a1e0ca1a4" })).toBe("The ads have an identical image");
  });
  it("cleans jargon from descriptions", () => {
    expect(cleanEvidence("near-identical creative (dHash, Hamming distance 3/64)")).toBe("near-identical creative");
    expect(cleanEvidence("same page structure (simhash DOM, distance 3/64)")).toBe("same page structure");
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

describe("signals of investigative practice in the GUI dictionary (I28)", () => {
  it("names every new page technique with a plain explanation and a label", () => {
    for (const t of ["fake_security_alert", "remote_access_tool", "clickfix_paste"]) {
      expect(TECHNIQUE_LABEL[t]).toBeTruthy();
      expect(TECHNIQUE_INFO[t].why.length).toBeGreaterThan(20);
    }
    expect(TECHNIQUE_INFO.fake_security_alert.sentence).toContain("remote desktop");
  });

  it("shows a ClickFix command only as kind and a short hash", () => {
    const lines = featureInfo("clickfix").format!({ kind: "powershell", sha256: "a".repeat(64) });
    expect(lines).toEqual(["kind: powershell", `SHA-256: ${"a".repeat(16)}…`]);
  });

  it("reads the two domains, the phone line types and the narrative labels", () => {
    expect(featureInfo("displayedDomainMismatch").format!({ displayed: "onet.pl", landing: "losowa-strona.test" })).toEqual(["onet.pl", "losowa-strona.test"]);
    expect(featureInfo("phoneLines").format!([{ phone: "+48800000000", lineType: "toll_free", country: "PL" }])).toEqual(["+48800000000: toll-free, PL"]);
    expect(featureInfo("narrative").format!({ topics: [{ id: "tech_support" }], hooks: ["secrecy"] })).toEqual([
      "topic: fake tech support (virus, locked computer)",
      "hook: secrecy (don't tell the bank or your family)",
    ]);
  });

  it("has a plain entry for the new kinds of evidence", () => {
    for (const t of ["shared_doc", "onion", "messenger_invite"] as const) expect(TYPE_INFO[t].sentence).toMatch(/^The samples /);
  });
});
