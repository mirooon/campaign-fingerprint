import { describe, expect, it } from "vitest";
import { advertiserMismatch } from "./advertiserMismatch";

// Synthetic advertiser names: fictional businesses and people.
describe("advertiser name that does not fit an investment ad (advertiserMismatch)", () => {
  it("a guest house or a private person running an investment ad is a likely taken-over account", () => {
    expect(advertiserMismatch("Pensjonat Pod Testową Górą", true)).toEqual({ kind: "business", word: "pensjonat" });
    expect(advertiserMismatch("Szkoła Jazdy Przykład", true)).toEqual({ kind: "business", word: "szkola jazdy" });
    expect(advertiserMismatch("Jan Testowy", true)).toEqual({ kind: "person" });
  });

  it("no mismatch for a financial name, for non-investment content or without a name", () => {
    expect(advertiserMismatch("Kapitał Plus Testowy", true)).toBeNull();
    expect(advertiserMismatch("Anna Inwestorka", true)).toBeNull();
    expect(advertiserMismatch("Pensjonat Pod Testową Górą", false)).toBeNull();
    expect(advertiserMismatch(null, true)).toBeNull();
    // a brand shaped like a name is no private person
    expect(advertiserMismatch("Daily Stream", true)).toBeNull();
  });
});
