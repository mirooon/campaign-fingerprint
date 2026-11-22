import { describe, expect, it } from "vitest";
import { belongsToDomain, dnsErrorReason, lookupErrorLine, lookupReason, lookupsOffReason, lookupsOutcome, parseLookupErrorLine } from "./lookupFailures";

describe("lookupsOutcome: the lookups step of one case", () => {
  it("is skipped with the reason in an offline run, which is the container default and not a failure", () => {
    const container = lookupsOutcome([{ domains: ["a.example"], failed: [] }], lookupsOffReason({ ANALYZE_OFFLINE: "1" }));
    expect(container).toEqual({ status: "skipped", detail: lookupsOffReason({ ANALYZE_OFFLINE: "1" }) });
    expect(container.detail).toMatch(/^tryb offline \(ANALYZE_OFFLINE=1/);
    const noFlag = lookupsOutcome([], lookupsOffReason({}));
    expect(noFlag.status).toBe("skipped");
    expect(noFlag.detail).toMatch(/^tryb offline: .*--live/);
  });

  it("is done when every lookup answered", () => {
    expect(lookupsOutcome([{ domains: ["a.example", "b.example"], failed: [] }], null)).toEqual({ status: "done", detail: "RDAP i DNS odpowiedziały dla 2 z 2 domen" });
  });

  it("is done with how many domains got no answer when part of the lookups failed", () => {
    const records = [
      { domains: ["a.example", "b.example", "c.example"], failed: ["rdap:a.example", "rdap:c.example"] },
      { domains: ["c.example", "d.example", "e.example"], failed: ["dns:e.example"] },
      undefined,
    ];
    expect(lookupsOutcome(records, null)).toEqual({
      status: "done",
      detail: "RDAP nie odpowiedział dla 2 z 5 domen: a.example, c.example; DNS nie odpowiedział dla 1 z 5 domen: e.example",
    });
  });

  it("is an error only when neither RDAP nor DNS answered for any domain, and skipped when there is no domain", () => {
    expect(lookupsOutcome([{ domains: ["a.example"], failed: ["dns:a.example", "rdap:a.example"] }], null)).toEqual({
      status: "error",
      detail: "RDAP nie odpowiedział dla 1 z 1 domeny: a.example; DNS nie odpowiedział dla 1 z 1 domeny: a.example",
    });
    expect(lookupsOutcome([undefined], null)).toMatchObject({ status: "skipped", detail: expect.stringMatching(/^brak domeny/) });
  });
});

describe("lookup error lines and reasons", () => {
  it("writes and reads back the line of a record", () => {
    const line = lookupErrorLine("rdap", "a.example", "odpowiedź HTTP 503");
    expect(line).toBe("RDAP nie odpowiedział dla a.example: odpowiedź HTTP 503");
    expect(parseLookupErrorLine(line)).toEqual({ kind: "rdap", name: "a.example", reason: "odpowiedź HTTP 503" });
    expect(parseLookupErrorLine("DNS nie odpowiedział dla www.a.example: A: SERVFAIL")).toEqual({ kind: "dns", name: "www.a.example", reason: "A: SERVFAIL" });
    expect(parseLookupErrorLine("page: timeout")).toBeNull();
    expect(belongsToDomain("www.a.example", "a.example")).toBe(true);
    expect(belongsToDomain("xa.example", "a.example")).toBe(false);
  });

  it("names the reason in Polish: HTTP status, timeout, no network, else the message", () => {
    expect(lookupReason(new Error("RDAP lookup for a.example failed: HTTP 503"))).toBe("odpowiedź HTTP 503");
    expect(lookupReason(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))).toBe("brak odpowiedzi w limicie czasu");
    expect(lookupReason(new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } }))).toBe("brak połączenia z siecią");
    expect(lookupReason(new Error("Invalid domain for RDAP: -"))).toBe("Invalid domain for RDAP: -");
    expect(dnsErrorReason({ A: "timeout", AAAA: "timeout", MX: "SERVFAIL" })).toBe("A, AAAA: brak odpowiedzi w limicie czasu; MX: SERVFAIL");
    expect(dnsErrorReason({})).toBe("");
  });
});
