import { describe, expect, it } from "vitest";
import { completeness, plainError } from "./completeness";

describe("completeness (§8.9)", () => {
  it("full case: screenshot, page from HAR, address", () => {
    const c = completeness({
      provenance: { screenshot: "a.png", bodySource: "har", har: "a.har", landingUrl: "https://a.test/", video: null },
      lookups: true,
    });
    expect(c.items.find((i) => i.id === "page")?.label).toBe("page (from HAR)");
    expect(c.items.find((i) => i.id === "video")?.optional).toBe(true);
    expect(c.complete).toBe(true);
  });
  it("a page that stands in as an archived copy is named with its source, not shown as a live or saved page", () => {
    const c = completeness({ provenance: { screenshot: "a.png", bodySource: "none", landingUrl: "https://a.test/" }, features: { bodySource: "urlscan" } });
    const page = c.items.find((i) => i.id === "page");
    expect(page).toMatchObject({ status: "warn", label: "page (archived copy: urlscan)" });
    expect(page?.effect).toMatch(/not a live fetch/);
  });
  it("missing page: effect explains what will not be compared", () => {
    const c = completeness({ provenance: { screenshot: "a.png", bodySource: "none", landingUrl: null } });
    const page = c.items.find((i) => i.id === "page");
    expect(page?.status).toBe("missing");
    expect(page?.effect).toMatch(/cannot compare the template/);
    expect(c.items.find((i) => i.id === "address")?.status).toBe("missing");
    expect(c.complete).toBe(false);
    expect(c.summary).toMatch(/^incomplete data/);
  });
  it("failed lookups of the material's domains become warnings", () => {
    const c = completeness({ provenance: { screenshot: "a.png", bodySource: "har", har: "a.har", landingUrl: "https://a.test/" }, failedLookups: ["rdap:a.test", "rdap:b.test"], domains: ["a.test"] });
    const warns = c.items.filter((i) => i.status === "warn");
    expect(warns.map((w) => w.label)).toEqual(["The domain registry (RDAP) did not respond for domain a.test"]);
  });
  it("a failed DNS lookup of the analysis warns for the material's domain with the reason from its error line, which is not listed twice", () => {
    const c = completeness({
      features: { landingUrl: "https://www.a.test/" },
      errors: ["DNS nie odpowiedział dla www.a.test: A, AAAA: brak odpowiedzi w limicie czasu", "RDAP nie odpowiedział dla kontakt.test: odpowiedź HTTP 503"],
      failedLookups: ["dns:a.test", "rdap:b.test"],
      domains: ["a.test"],
      lookups: true,
    });
    expect(c.items.filter((i) => i.status === "warn").map((w) => [w.label, w.effect])).toEqual([
      ["DNS servers did not respond for domain a.test", "Reason: A, AAAA: brak odpowiedzi w limicie czasu. The comparison has no IP addresses or name servers for this domain; the rest of the analysis went on"],
      ["The domain registry (RDAP) did not respond for domain kontakt.test: no registration date or registrar", undefined],
    ]);
  });
  it("a material without domains gets no failed lookup of the batch; an IDN domain matches by its ASCII name", () => {
    expect(completeness({ features: { ocrText: "x" }, failedLookups: ["rdap:a.test"], domains: [] }).items.some((i) => i.id.startsWith("lookup:"))).toBe(false);
    const idn = completeness({ features: { ocrText: "x" }, failedLookups: ["rdap:xn--w-uga1v8h.test"], domains: ["żółw.test (xn--w-uga1v8h.test)"] });
    expect(idn.items.find((i) => i.id === "lookup:rdap:xn--w-uga1v8h.test")?.label).toBe("The domain registry (RDAP) did not respond for domain xn--w-uga1v8h.test");
  });
  it("offline run, errors, skipped and backend 'missing'", () => {
    const c = completeness({ features: { landingUrl: "https://a.test/", ocrText: "x" }, lookups: false, errors: ["rdap a.test: timeout"], skipped: [{ id: "x/notatka.txt", reason: "unsupported file" }], missing: ["HAR file of a page visit"] });
    expect(c.items.some((i) => i.id === "lookups")).toBe(true);
    expect(c.items.some((i) => i.label.startsWith("The domain registry (RDAP) did not respond"))).toBe(true);
    expect(c.items.some((i) => i.label === "add: HAR file of a page visit")).toBe(true);
    expect(c.items.some((i) => i.label.startsWith("Skipped x/notatka.txt"))).toBe(true);
  });
  it("base material from node data", () => {
    const c = completeness({ features: { imagePath: "images/a.png", landingUrl: "https://a.test/", domSimhash: "abc" } });
    expect(c.complete).toBe(true);
  });
  it("plain errors", () => {
    expect(plainError("tesseract: failed")).toMatch(/OCR/);
    expect(plainError("something else")).toBe("something else");
    expect(plainError("DNS nie odpowiedział dla www.a.test: A: SERVFAIL")).toBe("DNS servers did not respond for www.a.test: no IP address or name servers");
    expect(plainError("RDAP nie odpowiedział dla a.test: brak połączenia z siecią")).toBe("The domain registry (RDAP) did not respond for domain a.test: no registration date or registrar");
  });
});
