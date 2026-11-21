import { describe, expect, it } from "vitest";
import { sponsoredPost, stripUiChrome } from "./uiChrome";

describe("stripUiChrome (platform interface text in ad screenshots)", () => {
  it("recognises an ad-library detail view, reads the library ID and removes interface phrases", () => {
    const r = stripUiChrome(
      "Szczegóły reklamy x Aktywna Identyfikator biblioteki: 1234567890123456 Data zamieszczenia: 8 paź 2026 Sponsorowane Wyjątkowa oferta dla seniorów Dowiedz się więcej Transparentność według lokalizacji",
    );
    expect(r).toEqual({ text: "Wyjątkowa oferta dla seniorów", view: "ad_library", adLibraryIds: ["1234567890123456"] });
  });

  it("handles the English interface", () => {
    const r = stripUiChrome("Ad details Active Library ID: 9876543210987654 Started running on Oct 8, 2026 Sponsored Miracle cure Learn more");
    expect(r).toEqual({ text: "Miracle cure", view: "ad_library", adLibraryIds: ["9876543210987654"] });
  });

  it("flags a sponsored feed post and keeps the advertiser name and ad copy", () => {
    const r = stripUiChrome("Marka Testowa Sponsorowane Dowiedz się więcej Lekarze nie chcą, żebyś o tym wiedział");
    expect(r).toEqual({ text: "Marka Testowa Lekarze nie chcą, żebyś o tym wiedział", view: "sponsored_post", adLibraryIds: [] });
  });

  it("leaves ordinary text alone, including status words outside an ad-library view", () => {
    expect(stripUiChrome("Aktywna zima: nowa kolekcja butów już w sklepie")).toEqual({
      text: "Aktywna zima: nowa kolekcja butów już w sklepie",
      view: null,
      adLibraryIds: [],
    });
  });
});

describe("sponsoredPost (the sponsored post inside a feed screenshot)", () => {
  it("drops the end of the post above and reads the page name from the line above the tag", () => {
    const r = sponsoredPost("Q 1234 567 890\njantestowy_oficjalny Nie wiem czy to prawda... więcej\nPracownia Testowa\nSponsorowane\nDowiedz się więcej >\n1 wyświetlenie");
    expect(r.advertiser).toBe("Pracownia Testowa");
    expect(r.text).toBe("Pracownia Testowa\nSponsorowane\nDowiedz się więcej >\n1 wyświetlenie");
  });

  it("still cuts at a page name read with OCR debris, without reporting that name", () => {
    const r = sponsoredPost("jantestowy_oficjalny Nie wiem czy to prawda... więcej\n4%) Prac Testowa\n=. Sponsorowane\nDowiedz się więcej >");
    expect(r.advertiser).toBeNull();
    expect(r.text).not.toContain("jantestowy_oficjalny");
  });

  it("reads the name after the tag in a Google ad and keeps the headline above it", () => {
    const r = sponsoredPost("Sekret sławnych dla każdego :\nNowe fakty poruszyły media\nSponsorowane - Blaskomat");
    expect(r).toEqual({ text: "Sekret sławnych dla każdego :\nNowe fakty poruszyły media\nSponsorowane - Blaskomat", advertiser: "Blaskomat" });
  });

  it("leaves an ad-library view whole: its header carries the library ID", () => {
    const raw = "Szczegóły reklamy X\nAktywna\nIdentyfikator biblioteki: 1234123412341234\nOwocowy Bęben\nSponsorowane\nTESTEX Dywaniki";
    const r = sponsoredPost(raw);
    expect(r.text).toBe(raw);
    expect(r.advertiser).toBe("Owocowy Bęben");
    expect(stripUiChrome(r.text).adLibraryIds).toEqual(["1234123412341234"]);
  });

  it("returns the text unchanged when there is no sponsored tag", () => {
    expect(sponsoredPost("Zagraj w grę >\nPobierz aplikację")).toEqual({ text: "Zagraj w grę >\nPobierz aplikację", advertiser: null });
  });
});
