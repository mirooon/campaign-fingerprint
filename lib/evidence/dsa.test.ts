import { describe, expect, it } from "vitest";
import { dedupeUrls, platformSlug, renderDsaNotices, type DsaAd } from "./dsa";

const ad = (over: Partial<DsaAd> & { item_id: string }): DsaAd => ({
  platform: "facebook",
  ad_urls: [],
  ad_ids: { ad_id: over.item_id },
  advertiser_displayed: null,
  first_seen_utc: "2026-09-05T00:00:00.000Z",
  landing_url: null,
  landing_chain: [],
  repository_record: null,
  ...over,
});

const base = {
  campaignId: "K01",
  packageId: "pkg-1",
  createdUtc: "2026-11-19T12:00:00.000Z",
  submitter: { name: "Analityk Testowy", email: "analityk@example.org" },
  legalCandidates: ["art. 286 k.k. (oszustwo)"],
  personas: ["Adam Testowy"],
  financialOffer: true,
  deepfake: false,
  domains: [{ domain: "cel.example", created_utc: "2026-08-20T00:00:00.000Z", cert_status: "active" as const, cert_insert_date: "2026-10-10T00:00:00.000Z" }],
  goodFaith: "Oświadczam, że w dobrej wierze…",
};

describe("platformSlug", () => {
  it("makes a file-safe lower-case name and names a missing platform", () => {
    expect(platformSlug("Facebook")).toBe("facebook");
    expect(platformSlug("YouTube Shorts")).toBe("youtube-shorts");
    expect(platformSlug(null)).toBe("unknown-platform");
  });
});

describe("dedupeUrls", () => {
  it("drops copies that differ only by tracking parameters and keeps the first address as seen", () => {
    expect(dedupeUrls(["https://a.example/p?x=1&fbclid=AAA", "https://a.example/p?x=1&fbclid=BBB&utm_source=fb", "https://a.example/q"])).toEqual(["https://a.example/p?x=1&fbclid=AAA", "https://a.example/q"]);
  });
});

describe("renderDsaNotices", () => {
  const ads = [
    ad({
      item_id: "a1",
      platform: "facebook",
      ad_urls: ["https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&id=1000000000000101", "https://www.facebook.com/permalink/abc"],
      ad_ids: { ad_id: "a1", ad_library_id: "1000000000000101" },
      repository_record: [{ page_id: "5550001" }],
      landing_chain: [{ url: "https://hop.example/r?fbclid=1" }, { url: "https://cel.example/start?utm_source=fb" }],
    }),
    ad({ item_id: "a2", platform: "facebook", landing_chain: [{ url: "https://hop.example/r?fbclid=2" }, { url: "https://cel.example/start?utm_source=fb" }] }),
    ad({ item_id: "t1", platform: "tiktok", landing_url: "https://tt.example/x" }),
  ];
  const notices = renderDsaNotices({ ...base, ads });

  it("writes one notice per platform", () => {
    expect(notices.map((n) => n.file)).toEqual(["dsa-art16-facebook.md", "dsa-art16-tiktok.md"]);
    expect(notices[1].content).not.toContain("a1");
    expect(notices[0].content).not.toContain("t1");
  });

  it("starts with the impersonation category and puts the platform location before the landing pages", () => {
    const fb = notices[0].content;
    expect(fb.split("\n").slice(0, 6).join("\n")).toMatch(/Notice category: impersonation/);
    const b = fb.split("## (b)")[1];
    const libraryAt = b.indexOf("id=1000000000000101");
    expect(libraryAt).toBeGreaterThan(-1);
    expect(libraryAt).toBeLessThan(b.indexOf("Landing pages"));
    expect(b).toContain("https://www.facebook.com/5550001");
    expect(b).toContain("https://www.facebook.com/permalink/abc");
  });

  it("lists landing pages per ad without copies that differ only by tracking parameters", () => {
    const b = notices[0].content.split("## (b)")[1];
    expect(b.match(/cel\.example\/start/g)).toHaveLength(2); // once per ad
    expect(b).toMatch(/ad a1[\s\S]*cel\.example[\s\S]*ad a2/);
  });

  it("falls back to the fraud category without a person", () => {
    const [n] = renderDsaNotices({ ...base, personas: [], ads: [ads[2]] });
    expect(n.content).toMatch(/Notice category: fraud/);
  });

  it("composes the justification from the facts instead of leaving a placeholder", () => {
    const a = notices[0].content.split("## (b)")[0];
    expect(a).not.toContain("[FILL IN");
    expect(a).toMatch(/Adam Testowy/);
    expect(a).toMatch(/financial services/);
    expect(a).toMatch(/CERT Warning List since 2026-10-10/);
    expect(a).toMatch(/registered 2026-08-20/);
    expect(a).toMatch(/to verify/);
  });

  it("names deepfake or a financial offer only when the facts say so", () => {
    const [plain] = renderDsaNotices({ ...base, personas: [], financialOffer: false, deepfake: false, ads: [ads[2]] });
    const a = plain.content.split("## (b)")[0];
    expect(a).not.toMatch(/financial|synthetic|deepfake/i);
    const [fake] = renderDsaNotices({ ...base, deepfake: true, ads: [ads[2]] });
    expect(fake.content.split("## (b)")[0]).toMatch(/synthetic/);
  });
});
