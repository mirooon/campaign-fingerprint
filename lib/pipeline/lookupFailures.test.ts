import { describe, expect, it } from "vitest";
import { belongsToDomain, dnsErrorReason, lookupErrorLine, lookupReason, lookupsOffReason, lookupsOutcome, parseLookupErrorLine } from "./lookupFailures";

describe("lookupsOutcome: the lookups step of one case", () => {
  it("is skipped with the reason in an offline run, which is the container default and not a failure", () => {
    const container = lookupsOutcome([{ domains: ["a.example"], failed: [] }], lookupsOffReason({ ANALYZE_OFFLINE: "1" }));
    expect(container).toEqual({ status: "skipped", detail: lookupsOffReason({ ANALYZE_OFFLINE: "1" }) });
    expect(container.detail).toMatch(/^offline mode \(ANALYZE_OFFLINE=1/);
    const noFlag = lookupsOutcome([], lookupsOffReason({}));
    expect(noFlag.status).toBe("skipped");
    expect(noFlag.detail).toMatch(/^offline mode: .*--live/);
  });

  it("is done when every lookup answered", () => {
    expect(lookupsOutcome([{ domains: ["a.example", "b.example"], failed: [] }], null)).toEqual({ status: "done", detail: "RDAP and DNS answered for 2 of 2 domains" });
  });

  it("is done with how many domains got no answer when part of the lookups failed", () => {
    const records = [
      { domains: ["a.example", "b.example", "c.example"], failed: ["rdap:a.example", "rdap:c.example"] },
      { domains: ["c.example", "d.example", "e.example"], failed: ["dns:e.example"] },
      undefined,
    ];
    expect(lookupsOutcome(records, null)).toEqual({
      status: "done",
      detail: "RDAP did not answer for 2 of 5 domains: a.example, c.example; DNS did not answer for 1 of 5 domains: e.example",
    });
  });

  it("is an error only when neither RDAP nor DNS answered for any domain, and skipped when there is no domain", () => {
    expect(lookupsOutcome([{ domains: ["a.example"], failed: ["dns:a.example", "rdap:a.example"] }], null)).toEqual({
      status: "error",
      detail: "RDAP did not answer for 1 of 1 domain: a.example; DNS did not answer for 1 of 1 domain: a.example",
    });
    expect(lookupsOutcome([undefined], null)).toMatchObject({ status: "skipped", detail: expect.stringMatching(/^no domain to look up/) });
  });
});

describe("lookup error lines and reasons", () => {
  it("writes and reads back the line of a record", () => {
    const line = lookupErrorLine("rdap", "a.example", "HTTP 503 response");
    expect(line).toBe("RDAP did not answer for a.example: HTTP 503 response");
    expect(parseLookupErrorLine(line)).toEqual({ kind: "rdap", name: "a.example", reason: "HTTP 503 response" });
    expect(parseLookupErrorLine("DNS did not answer for www.a.example: A: SERVFAIL")).toEqual({ kind: "dns", name: "www.a.example", reason: "A: SERVFAIL" });
    expect(parseLookupErrorLine("page: timeout")).toBeNull();
    expect(belongsToDomain("www.a.example", "a.example")).toBe(true);
    expect(belongsToDomain("xa.example", "a.example")).toBe(false);
  });

  it("names the reason: HTTP status, timeout, no network, else the message", () => {
    expect(lookupReason(new Error("RDAP lookup for a.example failed: HTTP 503"))).toBe("HTTP 503 response");
    expect(lookupReason(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))).toBe("no answer within the time limit");
    expect(lookupReason(new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } }))).toBe("no network connection");
    expect(lookupReason(new Error("Invalid domain for RDAP: -"))).toBe("Invalid domain for RDAP: -");
    expect(dnsErrorReason({ A: "timeout", AAAA: "timeout", MX: "SERVFAIL" })).toBe("A, AAAA: no answer within the time limit; MX: SERVFAIL");
    expect(dnsErrorReason({})).toBe("");
  });
});
