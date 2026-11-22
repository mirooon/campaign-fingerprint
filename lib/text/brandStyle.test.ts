import { describe, expect, it } from "vitest";
import { advertiserNameKind, brandStyle } from "./brandStyle";

describe("brandStyle", () => {
  it("flags two pseudo-Polish words with a financial second word", () => {
    expect(brandStyle("Fikcyjnol Zyskownia")).toBe("pseudo_polish_compound");
    expect(brandStyle("Testowy Kapitalnia")).toBe("pseudo_polish_compound");
  });
  it("leaves ordinary names", () => {
    expect(brandStyle("Piekarnia Kowalski")).toBeNull();
    expect(brandStyle("Zyskownia")).toBeNull();
  });
});

describe("advertiserNameKind", () => {
  it("tells the three kinds apart", () => {
    expect(advertiserNameKind("NovaFlux Studio")).toBe("generated_brand");
    expect(advertiserNameKind("Jan Kowalski")).toBe("person");
    expect(advertiserNameKind("Pensjonat Leśny Zakątek")).toBe("business");
    expect(advertiserNameKind("")).toBeNull();
  });
});
