import { describe, expect, it } from "vitest";
import { parseAddressBar } from "./addressBar";

describe("parseAddressBar (top strip of a screenshot, OCR text)", () => {
  it("reads a bare landing host in an in-app browser, with the padlock read as '8'", () => {
    expect(parseAddressBar("10:15 LTE)\n8 traf-77spin.example.com\nX Instagram e")).toEqual([
      { url: "https://traf-77spin.example.com/", host: "traf-77spin.example.com", line: "8 traf-77spin.example.com", inAppBrowser: "Instagram", platform: false, confidence: "high" },
    ]);
  });

  it("marks a platform's own page (ad library) so it is never taken for a landing page", () => {
    const [hit] = parseAddressBar("8 www.facebook.com\nX Wczytywanie... a");
    expect(hit).toMatchObject({ host: "www.facebook.com", platform: true, inAppBrowser: null, confidence: "high" });
  });

  it("keeps a path, rejects version numbers, unknown suffixes and feed text without a domain", () => {
    expect(parseAddressBar("oferta-fikcyjna.pl/rejestracja?x=1 ")[0]).toMatchObject({ url: "https://oferta-fikcyjna.pl/rejestracja?x=1", confidence: "medium" });
    expect(parseAddressBar("tesseract 5.5.3\nplik.qwertyzz\nQ 1234 567 890\njan_test Nie wiem czy to prawda... więcej")).toEqual([]);
  });
});
