import { describe, expect, it } from "vitest";
import { continuationAfterNotice, parseReports, pendingReports, REPORT_WAIT_DAYS, type ReportEntry } from "./reports";

const entry = (over: Partial<ReportEntry> = {}): ReportEntry => ({
  campaign_id: "K07",
  recipient: "facebook (art. 16 DSA)",
  reported_utc: "2026-10-01T09:00:00.000Z",
  category: "podszywanie się",
  status: "wysłane",
  response_utc: null,
  reference: null,
  ...over,
});

describe("parseReports", () => {
  it("reads JSON lines and reports each unreadable line with its number instead of skipping it silently", () => {
    const text = `${JSON.stringify(entry())}\n\n{"bad":\n${JSON.stringify({ campaign_id: "K07", recipient: "CERT", reported_utc: "2026-10-02", category: "oszustwo", status: "przyjęte" })}\n${JSON.stringify({ campaign_id: "K07" })}\n`;
    const { entries, errors } = parseReports(text);
    expect(entries.map((e) => e.recipient)).toEqual(["facebook (art. 16 DSA)", "CERT"]);
    expect(entries[1].reported_utc).toBe("2026-10-02T00:00:00.000Z");
    expect(errors.map((e) => e.line)).toEqual([3, 5]);
  });
  it("accepts a JSON array as well (the --prior format of the pack)", () => {
    expect(parseReports(JSON.stringify([entry(), entry({ recipient: "TikTok" })])).entries).toHaveLength(2);
  });
});

describe("pendingReports", () => {
  it("lists reports without a response older than the waiting time, oldest first, with the age in days", () => {
    const now = new Date("2026-11-01T09:00:00Z");
    const list = pendingReports([entry(), entry({ recipient: "TikTok", reported_utc: "2026-10-30T00:00:00Z" }), entry({ recipient: "CERT", response_utc: "2026-10-03T00:00:00Z", status: "przyjęte" })], now);
    expect(REPORT_WAIT_DAYS).toBeGreaterThan(0);
    expect(list.map((p) => [p.entry.recipient, p.days])).toEqual([["facebook (art. 16 DSA)", 31]]);
  });
});

describe("continuationAfterNotice", () => {
  it("counts the ads first seen after the earliest report", () => {
    const r = continuationAfterNotice([entry(), entry({ reported_utc: "2026-10-10T00:00:00Z" })], [{ item_id: "a1", first_seen_utc: "2026-09-30T00:00:00.000Z" }, { item_id: "a2", first_seen_utc: "2026-10-05T00:00:00.000Z" }, { item_id: "a3", first_seen_utc: null }]);
    expect(r).toEqual({ first_report_utc: "2026-10-01T09:00:00.000Z", ads_first_seen_after: ["a2"] });
  });
  it("is null without reports", () => {
    expect(continuationAfterNotice([], [{ item_id: "a1", first_seen_utc: "2026-10-05T00:00:00.000Z" }])).toBeNull();
  });
});
