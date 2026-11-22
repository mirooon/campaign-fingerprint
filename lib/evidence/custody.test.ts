import { describe, expect, it } from "vitest";
import { buildCustodyLog, timestampFields } from "./custody";

const base = {
  campaignId: "K07",
  exportUtc: "2026-11-19T12:00:00.000Z",
  tool: "starter-test 0.0.0",
  manifestSha256: "a".repeat(64),
  enrich: { generatedUtc: "2026-11-18T09:00:00.000Z", mode: "live" as const, fetchedFirstUtc: "2026-11-18T09:01:00.000Z", fetchedLastUtc: "2026-11-18T09:05:00.000Z", userAgents: ["Mozilla/5.0 Synthetic"] },
  imports: [{ id: "c1", importedUtc: "2026-11-18T08:00:00.000Z", files: [{ role: "har", name: "ruch.har", sha256: "b".repeat(64) }, { role: "screenshot", name: "zrzut.png", sha256: "c".repeat(64) }] }],
};

describe("buildCustodyLog", () => {
  it("records import with the hashes before, enrichment with time, mode and user agent, and the export, in time order", () => {
    const log = buildCustodyLog(base);
    expect(log).toHaveLength(3);
    expect(log.map((e) => e.utc)).toEqual([...log.map((e) => e.utc)].sort());
    expect(log[0].action).toMatch(/import/);
    expect(log[0].action).toContain("b".repeat(64));
    expect(log[1].action).toMatch(/live/);
    expect(log[1].action).toContain("Mozilla/5.0 Synthetic");
    expect(log[1].action).toContain("2026-11-18T09:01:00.000Z");
    expect(log[2].sha256_after).toBe("a".repeat(64));
  });

  it("still writes three entries when the import left no provenance, and says so", () => {
    const log = buildCustodyLog({ ...base, imports: [] });
    expect(log).toHaveLength(3);
    expect(log[0].action).toMatch(/brak provenance/);
  });
});

describe("timestampFields", () => {
  it("is null with the reason when no TSA was asked for or the network was unavailable", () => {
    expect(timestampFields(null, "nie podano --tsa")).toEqual({ timestamp_token: null, timestamp_note: expect.stringContaining("nie podano --tsa") });
    expect(timestampFields(null, "brak sieci: ECONNREFUSED").timestamp_note).toMatch(/ECONNREFUSED/);
  });
  it("names the token file, the TSA and the time when there is one", () => {
    const f = timestampFields({ file: "manifest.tsr", tsa: "https://tsa.example/", sha256: "d".repeat(64), utc: "2026-11-19T12:01:00.000Z" }, null);
    expect(f.timestamp_token).toEqual({ file: "manifest.tsr", tsa: "https://tsa.example/", sha256: "d".repeat(64), utc: "2026-11-19T12:01:00.000Z" });
    expect(f.timestamp_note).toMatch(/dostawc\w* kwalifikowan/);
  });
});
