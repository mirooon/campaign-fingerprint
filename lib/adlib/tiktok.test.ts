import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTikTokSource, parseTikTokAds, type TikTokFetch } from "./tiktok";
import { ADLIB_FIXTURES } from "./testkit";

const read = (f: string) => readFileSync(path.join(ADLIB_FIXTURES, f), "utf8");
const NOW = "2026-11-21T10:00:00.000Z";
const KEYS = { TIKTOK_CLIENT_KEY: "k", TIKTOK_CLIENT_SECRET: "s" };

describe("TikTok source", () => {
  it("maps the recorded answer: advertiser account, dates, creatives, and the library address", () => {
    const recs = parseTikTokAds(read("tiktok_ad_query.json"), NOW);
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({
      platform: "tiktok",
      adId: "1700000000000001",
      advertiser: { name: "Konto Testowe TikTok", id: "7000000000000001" },
      firstSeen: "2026-11-01T00:00:00.000Z",
      lastSeen: "2026-11-10T00:00:00.000Z",
    });
    expect(recs[0].creatives).toEqual([{ kind: "image", url: "https://cdn.example/tt/1.jpg" }, { kind: "video", url: "https://cdn.example/tt/1.mp4" }]);
    expect(recs[0].libraryUrl).toContain("1700000000000001");
    expect(recs[1].lastSeen).toBeUndefined();
    expect(recs[0].advertiser?.id).toBe(recs[1].advertiser?.id);
  });

  it("reports an error answer with its message", () => {
    expect(() => parseTikTokAds(JSON.stringify({ error: { code: "access_token_invalid", message: "bad token" } }), NOW)).toThrow(/bad token/);
    expect(() => parseTikTokAds("<html>", NOW)).toThrow(/invalid answer/);
  });

  it("is unavailable without the keys, with how to apply for access", async () => {
    const a = await createTikTokSource({ env: {} }).available();
    expect(a.ok).toBe(false);
    expect(a.reason).toContain("TIKTOK_CLIENT_KEY");
    expect(a.howToGetAccess).toMatch(/apply/i);
    expect((await createTikTokSource({ env: KEYS }).available()).ok).toBe(true);
  });

  it("gets a client token with the keys, then queries with the filters of the search", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const fetchFn: TikTokFetch = async (url, init) => (calls.push({ url, headers: init.headers, body: init.body }), url.includes("/oauth/token") ? read("tiktok_token.json") : read("tiktok_ad_query.json"));
    const src = createTikTokSource({ env: KEYS, fetchFn, now: () => NOW });
    const recs = await src.search({ keyword: "inwestycja", advertiser: "Konto", country: "PL", from: "2026-11-01", to: "2026-11-21", limit: 5 });
    expect(recs).toHaveLength(2);
    expect(calls[0].url).toContain("/v2/oauth/token/");
    expect(new URLSearchParams(calls[0].body).get("client_key")).toBe("k");
    expect(calls[1].headers.authorization).toBe("Bearer synthetic-token");
    const body = JSON.parse(calls[1].body);
    expect(body).toMatchObject({ search_term: "inwestycja", max_count: 5, filters: { country: "PL", advertiser_name: "Konto", ad_published_date_range: { min: "20261101", max: "20261121" } } });
  });

  it("looks up one ad by its ID", async () => {
    const fetchFn: TikTokFetch = async (url) => (url.includes("/oauth/token") ? read("tiktok_token.json") : read("tiktok_ad_query.json"));
    const rec = await createTikTokSource({ env: KEYS, fetchFn, now: () => NOW }).getAd("1700000000000002");
    expect(rec?.adId).toBe("1700000000000002");
    expect(await createTikTokSource({ env: KEYS, fetchFn, now: () => NOW }).getAd("999")).toBeNull();
  });
});
