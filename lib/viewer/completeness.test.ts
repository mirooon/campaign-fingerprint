import { describe, expect, it } from "vitest";
import { completeness, plainError } from "./completeness";

describe("completeness (§8.9)", () => {
  it("full case: screenshot, page from HAR, address", () => {
    const c = completeness({
      provenance: { screenshot: "a.png", bodySource: "har", har: "a.har", landingUrl: "https://a.test/", video: null },
      lookups: true,
    });
    expect(c.items.find((i) => i.id === "page")?.label).toBe("strona (z HAR)");
    expect(c.items.find((i) => i.id === "video")?.optional).toBe(true);
    expect(c.complete).toBe(true);
  });
  it("a page that stands in as an archived copy is named with its source, not shown as a live or saved page", () => {
    const c = completeness({ provenance: { screenshot: "a.png", bodySource: "none", landingUrl: "https://a.test/" }, features: { bodySource: "urlscan" } });
    const page = c.items.find((i) => i.id === "page");
    expect(page).toMatchObject({ status: "warn", label: "strona (kopia archiwalna: urlscan)" });
    expect(page?.effect).toMatch(/nie jest pobraniem na żywo/);
  });
  it("missing page: effect explains what will not be compared", () => {
    const c = completeness({ provenance: { screenshot: "a.png", bodySource: "none", landingUrl: null } });
    const page = c.items.find((i) => i.id === "page");
    expect(page?.status).toBe("missing");
    expect(page?.effect).toMatch(/nie porównamy szablonu/);
    expect(c.items.find((i) => i.id === "address")?.status).toBe("missing");
    expect(c.complete).toBe(false);
    expect(c.summary).toMatch(/^dane niepełne/);
  });
  it("failed lookups of the material's domains become warnings", () => {
    const c = completeness({ provenance: { screenshot: "a.png", bodySource: "har", har: "a.har", landingUrl: "https://a.test/" }, failedLookups: ["rdap:a.test", "rdap:b.test"], domains: ["a.test"] });
    const warns = c.items.filter((i) => i.status === "warn");
    expect(warns.map((w) => w.label)).toEqual(["Rejestr domen (RDAP) nie odpowiedział dla domeny a.test"]);
  });
  it("offline run, errors, skipped and backend 'missing'", () => {
    const c = completeness({ features: { landingUrl: "https://a.test/", ocrText: "x" }, lookups: false, errors: ["rdap a.test: timeout"], skipped: [{ id: "x/notatka.txt", reason: "nieobsługiwany plik" }], missing: ["plik HAR z wizyty na stronie"] });
    expect(c.items.some((i) => i.id === "lookups")).toBe(true);
    expect(c.items.some((i) => i.label.startsWith("Rejestr domen (RDAP) nie odpowiedział"))).toBe(true);
    expect(c.items.some((i) => i.label === "dorzuć: plik HAR z wizyty na stronie")).toBe(true);
    expect(c.items.some((i) => i.label.startsWith("Pominięto x/notatka.txt"))).toBe(true);
  });
  it("base material from node data", () => {
    const c = completeness({ features: { imagePath: "images/a.png", landingUrl: "https://a.test/", domSimhash: "abc" } });
    expect(c.complete).toBe(true);
  });
  it("plain errors", () => {
    expect(plainError("tesseract: failed")).toMatch(/OCR/);
    expect(plainError("coś innego")).toBe("coś innego");
  });
});
