import { describe, expect, it } from "vitest";
import { tlsSignals, type TlsDetails } from "./tlsSignals";

const tls = (over: Partial<TlsDetails> = {}): TlsDetails => ({ issuer: "Let's Encrypt R10", validFrom: "2026-10-01T00:00:00Z", validTo: "2027-01-01T00:00:00Z", sanList: ["sklep.test", "www.sklep.test"], subjectName: "sklep.test", ...over });

describe("tlsSignals", () => {
  it("raises no flag for a valid certificate that covers the host, and names the issuer as context", () => {
    expect(tlsSignals(tls(), "www.sklep.test", "2026-11-01T00:00:00Z")).toEqual({ issuer: "Let's Encrypt R10", certMismatch: false, certExpired: false });
  });
  it("flags a certificate whose names do not cover the host", () => {
    expect(tlsSignals(tls({ sanList: ["inny.test"], subjectName: "inny.test" }), "sklep.test", "2026-11-01T00:00:00Z").certMismatch).toBe(true);
  });
  it("covers a host with a wildcard name, one label deep", () => {
    expect(tlsSignals(tls({ sanList: ["*.sklep.test"] }), "www.sklep.test", "2026-11-01T00:00:00Z").certMismatch).toBe(false);
    expect(tlsSignals(tls({ sanList: ["*.sklep.test"] }), "a.b.sklep.test", "2026-11-01T00:00:00Z").certMismatch).toBe(true);
  });
  it("flags a certificate that expired before the page was saved", () => {
    expect(tlsSignals(tls({ validTo: "2026-09-01T00:00:00Z" }), "sklep.test", "2026-11-01T00:00:00Z").certExpired).toBe(true);
  });
  it("reads validity given as epoch seconds (Chrome HAR)", () => {
    expect(tlsSignals(tls({ validTo: Date.parse("2026-09-01T00:00:00Z") / 1000 }), "sklep.test", "2026-11-01T00:00:00Z").certExpired).toBe(true);
  });
  it("gives no verdict on dates or names it does not have", () => {
    expect(tlsSignals({ issuer: null, validFrom: null, validTo: null, sanList: [], subjectName: null }, "sklep.test", null)).toEqual({ issuer: null, certMismatch: false, certExpired: false });
  });
});
