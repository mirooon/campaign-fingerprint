import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { createXSource, parseXExport } from "./x";
import { ADLIB_FIXTURES } from "./testkit";

const csv = readFileSync(path.join(ADLIB_FIXTURES, "x_ads_export.csv"), "utf8");
const NOW = "2026-11-21T10:00:00.000Z";
const tmp = mkdtempSync(path.join(os.tmpdir(), "adlib-x-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("X source (import of the repository's CSV export)", () => {
  it("reads the advertiser, funder, dates, country and the ad address of every row", () => {
    const recs = parseXExport(csv, NOW);
    expect(recs).toHaveLength(3);
    expect(recs[0]).toMatchObject({
      platform: "x",
      adId: "1850000000000001",
      libraryUrl: "https://x.example/i/ads/1850000000000001",
      advertiser: { name: "Konto Testowe X" },
      payers: ["Fundator Testowy"],
      firstSeen: "2026-11-01T00:00:00.000Z",
      lastSeen: "2026-11-09T00:00:00.000Z",
      regions: ["PL"],
    });
    expect(recs[1].payers).toEqual([]);
    expect(recs[1].lastSeen).toBeUndefined();
  });

  it("says which columns are missing when the file is not the repository's export", () => {
    expect(() => parseXExport("a,b\n1,2\n", NOW)).toThrow(/column/);
  });

  it("is unavailable without a file, and says where to get it", async () => {
    const a = await createXSource({ env: {} }).available();
    expect(a.ok).toBe(false);
    expect(a.reason).toContain("X_ADS_FILE");
    expect(a.howToGetAccess).toContain("docs/ZRODLA-METADANYCH.md");
  });

  it("searches the file by advertiser, funder, country and dates, and gets an ad by ID", async () => {
    const file = path.join(tmp, "x.csv");
    writeFileSync(file, csv);
    const src = createXSource({ env: { X_ADS_FILE: file }, now: () => NOW });
    expect((await src.available()).ok).toBe(true);
    expect((await src.search({ advertiser: "testowe" })).map((r) => r.adId)).toEqual(["1850000000000001", "1850000000000003"]);
    expect((await src.search({ keyword: "fundator", country: "pl", from: "2026-11-10" })).map((r) => r.adId)).toEqual(["1850000000000003"]);
    expect((await src.search({ country: "DE" })).map((r) => r.adId)).toEqual(["1850000000000002"]);
    expect((await src.search({ limit: 1 }))).toHaveLength(1);
    expect((await src.getAd("1850000000000002"))?.advertiser?.name).toBe("Inne Konto X");
    expect(await src.getAd("1")).toBeNull();
  });
});
