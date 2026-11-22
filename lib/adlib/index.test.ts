import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSources, defaultQueries, searchSources } from "./index";
import { ADLIB_FIXTURES } from "./testkit";
import type { AdLibrarySource, AdPlatform, AdRecord, AdSearchQuery } from "./types";

const rec = (platform: AdPlatform, adId: string): AdRecord => ({ platform, adId, libraryUrl: `https://lib.example/${platform}/${adId}`, fetchedAt: "2026-11-21T10:00:00.000Z", creatives: [] });

function source(platform: AdPlatform, over: Partial<AdLibrarySource> & { seen?: AdSearchQuery[]; records?: AdRecord[] } = {}): AdLibrarySource {
  const { seen, records, ...rest } = over;
  return {
    platform,
    available: async () => ({ ok: true }),
    search: async (q) => (seen?.push(q), records ?? [rec(platform, `${q.keyword ?? q.advertiser}`)]),
    getAd: async () => null,
    ...rest,
  };
}

describe("defaultQueries", () => {
  it("uses the keywords and the persona names when the query names neither keyword nor advertiser", () => {
    const qs = defaultQueries({ country: "PL", limit: 10 }, ["inwestycja"], ["Adam Testowy"]);
    expect(qs).toEqual([
      { country: "PL", limit: 10, keyword: "inwestycja" },
      { country: "PL", limit: 10, keyword: "Adam Testowy" },
    ]);
  });

  it("keeps a query that names a keyword or an advertiser as it is", () => {
    expect(defaultQueries({ keyword: "test" }, ["inwestycja"], ["Adam Testowy"])).toEqual([{ keyword: "test" }]);
    expect(defaultQueries({ advertiser: "AR1" }, ["inwestycja"], [])).toEqual([{ advertiser: "AR1" }]);
  });
});

describe("searchSources", () => {
  it("lists an unavailable source with the reason and the way to get access, and searches the others", async () => {
    const sources = {
      meta: source("meta"),
      google: source("google", { available: async () => ({ ok: false, reason: "brak ADC", howToGetAccess: "gcloud auth application-default login" }) }),
    };
    const res = await searchSources(sources, ["meta", "google"], [{ keyword: "test" }]);
    expect(res.records.map((r) => r.platform)).toEqual(["meta"]);
    expect(res.skipped).toEqual([{ platform: "google", reason: "brak ADC", howToGetAccess: "gcloud auth application-default login" }]);
    expect(res.errors).toEqual([]);
  });

  it("reports a failing search as an error of that platform and goes on with the others", async () => {
    const sources = {
      meta: source("meta", { search: async () => { throw new Error("Meta: blocked"); } }),
      google: source("google"),
    };
    const res = await searchSources(sources, ["meta", "google"], [{ keyword: "test" }]);
    expect(res.errors).toEqual([{ platform: "meta", message: "Meta: blocked" }]);
    expect(res.records.map((r) => r.platform)).toEqual(["google"]);
  });

  it("runs every query on a platform and drops a record seen twice", async () => {
    const seen: AdSearchQuery[] = [];
    const sources = { meta: source("meta", { seen, records: [rec("meta", "1")] }) };
    const res = await searchSources(sources, ["meta"], [{ keyword: "a" }, { keyword: "b" }]);
    expect(seen).toHaveLength(2);
    expect(res.records).toHaveLength(1);
  });

  it("does not spend the BigQuery limit on default queries: Google is skipped with the reason", async () => {
    const seen: AdSearchQuery[] = [];
    const sources = { meta: source("meta"), google: source("google", { seen }) };
    const res = await searchSources(sources, ["meta", "google"], defaultQueries({ country: "PL" }, ["inwestycja"], []), { defaultQueries: true });
    expect(seen).toEqual([]);
    expect(res.skipped).toEqual([{ platform: "google", reason: expect.stringContaining("--keyword") }]);
    expect(res.records.map((r) => r.platform)).toEqual(["meta"]);
  });

  it("searches Google for a query the user gave", async () => {
    const seen: AdSearchQuery[] = [];
    const sources = { google: source("google", { seen }) };
    await searchSources(sources, ["google"], [{ advertiser: "AR1" }]);
    expect(seen).toEqual([{ advertiser: "AR1" }]);
  });
});

describe("createSources", () => {
  it("says for TikTok and X what is missing and how to get it, when there are no keys and no file", async () => {
    const sources = createSources({ env: {} });
    const tiktok = await sources.tiktok.available();
    const x = await sources.x.available();
    expect([tiktok.ok, x.ok]).toEqual([false, false]);
    expect(tiktok.reason).toContain("TIKTOK_CLIENT_KEY");
    expect(x.reason).toContain("X_ADS_FILE");
  });
});

describe("recorded library responses", () => {
  it("live outside data/sample, which `bun run sample:generate` deletes and rebuilds", () => {
    const sample = path.join(process.cwd(), "data", "sample");
    expect(path.relative(sample, ADLIB_FIXTURES).startsWith("..")).toBe(true);
  });
});
