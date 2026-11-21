import { describe, expect, it } from "vitest";
import { domainTemplate, LOREM_WORDS } from "./domainPattern";

describe("domainTemplate", () => {
  it("builds the CSIRT KNF style template with TLD-specific and agnostic variants", () => {
    const sbs = domainTemplate("finance23-voluptas94.sbs")!;
    expect(sbs).toEqual({
      specific: "finance<n>-<lorem><n>.sbs",
      agnostic: "finance<n>-<lorem><n>.*",
      label: "finance23-voluptas94",
      suffix: "sbs",
      placeholders: 3,
      literalChars: 7,
    });
    const pro = domainTemplate("finance95-praesentium23.pro")!;
    expect(pro.specific).toBe("finance<n>-<lorem><n>.pro");
    expect(pro.agnostic).toBe(sbs.agnostic);
  });

  it("handles brand+number labels and rejects labels without placeholders", () => {
    expect(domainTemplate("tradesynthiq47.example")).toMatchObject({
      specific: "tradesynthiq<n>.example",
      placeholders: 1,
      literalChars: 12,
    });
    expect(domainTemplate("opcoprox.example")).toBeNull();
    expect(domainTemplate("zwrot24-dolorem51.test")?.specific).toBe("zwrot<n>-<lorem><n>.test");
  });

  it("only replaces Lorem Ipsum words of at least minLoremLength characters", () => {
    expect(domainTemplate("ad-sit-amet.test")).toMatchObject({ specific: "ad-sit-<lorem>.test", placeholders: 1, literalChars: 5 });
    expect(domainTemplate("ad-sit-amet.test", { minLoremLength: 2 })?.specific).toBe("<lorem>-<lorem>-<lorem>.test");
  });

  it("uses the registrable label of hostnames and multi-label public suffixes", () => {
    expect(domainTemplate("WWW.Finance23-Voluptas94.SBS.")?.specific).toBe("finance<n>-<lorem><n>.sbs");
    const pl = domainTemplate("finance23-voluptas94.com.pl")!;
    expect(pl.suffix).toBe("com.pl");
    expect(pl.specific).toBe("finance<n>-<lorem><n>.com.pl");
    expect(pl.agnostic).toBe("finance<n>-<lorem><n>.*");
    expect(domainTemplate("sklep.example.com.pl")).toBeNull(); // label "example" has no placeholder
  });

  it("returns null for IPs, bare suffixes and punycode labels", () => {
    expect(domainTemplate("203.0.113.5")).toBeNull();
    expect(domainTemplate("sbs")).toBeNull();
    expect(domainTemplate("")).toBeNull();
    expect(domainTemplate("xn--bcher-kva2026.example")).toBeNull();
  });

  it("ships a Lorem Ipsum word list", () => {
    expect(LOREM_WORDS.size).toBeGreaterThanOrEqual(150);
    for (const w of ["voluptas", "praesentium", "dolorem", "lorem", "ipsum"]) expect(LOREM_WORDS.has(w)).toBe(true);
    expect(LOREM_WORDS.has("finance")).toBe(false);
  });
});
