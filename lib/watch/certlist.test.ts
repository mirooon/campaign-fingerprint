import { describe, expect, it } from "vitest";
import { parseCertlist } from "./certlist";

describe("parseCertlist", () => {
  it("reads a JSON array of names, of objects with a domain field, and plain lines; lower-cases and de-duplicates", () => {
    expect(parseCertlist(JSON.stringify(["A.example", "b.example", "a.example"]))).toEqual(["a.example", "b.example"]);
    expect(parseCertlist(JSON.stringify([{ DomainAddress: "C.test", InsertTime: "2026-11-21" }, { domain: "d.test" }, { other: 1 }]))).toEqual(["c.test", "d.test"]);
    expect(parseCertlist("e.test\n# komentarz\n\nf.test\r\n")).toEqual(["e.test", "f.test"]);
  });

  it("strips a URL scheme, a path and a leading wildcard, and drops entries that are not host names", () => {
    expect(parseCertlist(JSON.stringify(["https://g.test/path?x=1", "*.h.test", "not a host", ""]))).toEqual(["g.test", "h.test"]);
  });
});
