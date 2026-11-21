import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ARCHIVE_CONFIG } from "./config";
import { ArchiveLookupError, type ArchiveHttp, type ArchiveHttpResponse } from "./http";
import { createUrlscanSource, dateWindows, matchLevel, parseResultRequests } from "./urlscan";

const FIX = path.join(__dirname, "../../../tests/fixtures/archive");
const search = readFileSync(path.join(FIX, "urlscan-search.json"));
const resultPage = readFileSync(path.join(FIX, "urlscan-result.html"));
const dom = readFileSync(path.join(FIX, "urlscan-dom.html"));
const U1 = "aaaaaaaa-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-22T10:00:00Z");
const cfg = { ...DEFAULT_ARCHIVE_CONFIG, urlscanMinIntervalMs: 0 };
const ok = (body: Buffer | string, headers: Record<string, string> = {}): ArchiveHttpResponse => ({ status: 200, headers, body: Buffer.from(body) });

type Route = [string, ArchiveHttpResponse | ((url: string, headers: Record<string, string>) => ArchiveHttpResponse)];

/** Recorded answers by address fragment (first match wins); remembers the addresses and headers asked. */
function recorded(routes: Route[]) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const http: ArchiveHttp = async (url, o) => {
    calls.push({ url, headers: o.headers ?? {} });
    const hit = routes.find(([frag]) => decodeURIComponent(url).includes(frag));
    if (!hit) throw new Error(`nieoczekiwane zapytanie: ${url}`);
    return typeof hit[1] === "function" ? hit[1](url, o.headers ?? {}) : hit[1];
  };
  return { http, calls };
}
const baseRoutes: Route[] = [
  ["/api/v1/search/", ok(search)],
  [`/result/${U1}/`, ok(resultPage)],
  [`/dom/${U1}/`, ok(dom)],
  [`/screenshots/${U1}.png`, ok(Buffer.from([0x89, 0x50, 0x4e, 0x47]))],
];
const source = (routes: Route[], extra: Partial<Parameters<typeof createUrlscanSource>[0]> = {}) => {
  const rec = recorded(routes);
  return { ...rec, src: createUrlscanSource({ http: rec.http, now: () => NOW, config: cfg, sleep: async () => {}, apiKey: "", ...extra }) };
};

describe("matchLevel", () => {
  it("tells an identical address from the same page with another query and from another page", () => {
    const want = "https://promo.example/offer/?clickid=synthetic1";
    expect(matchLevel(want, "https://promo.example/offer/?clickid=synthetic1#top")).toBe("exact");
    expect(matchLevel(want, "https://promo.example/offer/")).toBe("path");
    expect(matchLevel(want, "https://promo.example/other/")).toBeNull();
    expect(matchLevel(want, "https://other.example/offer/")).toBeNull();
  });
});

describe("dateWindows", () => {
  it("covers the range in windows of at most the given days, newest first", () => {
    const w = dateWindows("2026-11-01T00:00:00Z", "2026-11-10T00:00:00Z", 4);
    expect(w).toEqual([
      { from: "2026-11-06T00:00:00", to: "2026-11-10T00:00:00" },
      { from: "2026-11-02T00:00:00", to: "2026-11-06T00:00:00" },
      { from: "2026-11-01T00:00:00", to: "2026-11-02T00:00:00" },
    ]);
  });
});

describe("parseResultRequests", () => {
  it("reads the request list with resource hashes, addresses, statuses and types from a result page", () => {
    const reqs = parseResultRequests(resultPage.toString("utf8"));
    expect(reqs).toHaveLength(5);
    expect(reqs[0]).toEqual({ url: "https://promo.example/offer/?clickid=synthetic1", sha256: "1".repeat(64), ip: "192.0.2.10", type: "Document" });
    expect(reqs[1]).toMatchObject({ url: "https://cdn.example/lib/app.min.js", sha256: "2".repeat(64), ip: "192.0.2.20", type: "Script" });
    expect(reqs[4]).toEqual({ url: "https://tracker.example/pixel.gif", type: "failed" });
  });
});

describe("urlscan source", () => {
  it("finds the scan of the full address, with the request list and the record fields", async () => {
    const { src } = source(baseRoutes);
    const copies = await src.lookup("https://promo.example/offer/?clickid=synthetic1");
    expect(copies.map((c) => c.sourceUrl)).toEqual([`https://urlscan.io/result/${U1}/`, "https://urlscan.io/result/aaaaaaaa-0000-4000-8000-000000000003/"]);
    const [best] = copies;
    expect(best).toMatchObject({
      source: "urlscan",
      url: "https://promo.example/offer/?clickid=synthetic1",
      capturedAt: "2026-11-03T09:00:00.000Z",
      fetchedAt: NOW.toISOString(),
      meta: { ip: "192.0.2.10", asn: "AS64500", server: "nginx", tlsIssuer: "Example CA", title: "Synthetic Offer Page" },
    });
    expect(best.requests?.map((r) => r.sha256)).toEqual(["1".repeat(64), "2".repeat(64), "3".repeat(64), "4".repeat(64), undefined]);
  });

  it("does not return a scan of another page of the same domain", async () => {
    const { src } = source(baseRoutes);
    const copies = await src.lookup("https://promo.example/offer/?clickid=synthetic1");
    expect(copies.every((c) => !c.url.includes("/other/"))).toBe(true);
  });

  it("splits a busy domain into date windows of at most four days", async () => {
    const filler = JSON.stringify({ results: Array.from({ length: 100 }, (_, i) => ({ _id: `f-${i}`, task: { time: "2026-11-05T00:00:00.000Z", url: "https://promo.example/x" }, page: { url: "https://promo.example/x", domain: "promo.example" } })), total: 500 });
    const { src, calls } = source([
      ["date:[", ok(search)],
      ["/api/v1/search/", ok(filler)],
      ["/result/", ok(resultPage)],
    ]);
    const copies = await src.lookup("https://promo.example/offer/", { before: "2026-11-13T00:00:00Z" });
    const searches = calls.filter((c) => c.url.includes("/api/v1/search/"));
    expect(searches.length).toBeGreaterThan(1);
    expect(searches.some((c) => decodeURIComponent(c.url).includes("page.domain:promo.example"))).toBe(true);
    expect(copies.length).toBeGreaterThan(0);
  });

  it("answers 429 with Retry-After once, does not ask again and says why", async () => {
    let now = NOW;
    const { src, calls } = source([["/api/v1/search/", { status: 429, headers: { "retry-after": "1080" }, body: Buffer.from("") }]], { now: () => now });
    const err = await src.lookup("https://promo.example/offer/").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArchiveLookupError);
    expect((err as ArchiveLookupError).retryAfterS).toBe(1080);
    expect((err as ArchiveLookupError).reason).toMatch(/429/);
    expect(calls).toHaveLength(1);
    // still inside the pause: no request at all
    await expect(src.lookup("https://promo.example/offer/")).rejects.toBeInstanceOf(ArchiveLookupError);
    expect(calls).toHaveLength(1);
    const av = await src.available();
    expect(av.ok).toBe(false);
    expect(av.reason).toMatch(/12:18|Retry-After|429/);
    now = new Date(NOW.getTime() + 1_081_000);
    expect((await src.available()).ok).toBe(true);
  });

  it("keeps the copy and names the gap when the result page answers 429 after a successful search", async () => {
    const { src } = source([
      ["/api/v1/search/", ok(search)],
      ["/result/", { status: 429, headers: { "retry-after": "60" }, body: Buffer.from("") }],
    ]);
    const [copy] = await src.lookup("https://promo.example/offer/?clickid=synthetic1");
    expect(copy.requests).toBeUndefined();
    expect(copy.notes?.join(" ")).toMatch(/brak: lista żądań .*429/);
    expect((await src.available()).ok).toBe(false);
  });

  it("without a key searches but leaves out the DOM, and says so", async () => {
    const { src, calls } = source(baseRoutes);
    const av = await src.available();
    expect(av.ok).toBe(true);
    expect(av.reason).toMatch(/DOM/);
    expect(av.howToGetAccess).toMatch(/URLSCAN_API_KEY/);
    const [copy] = await src.lookup("https://promo.example/offer/?clickid=synthetic1");
    expect(copy.html).toBeUndefined();
    expect(calls.some((c) => c.url.includes("/dom/"))).toBe(false);
  });

  it("with a key fetches the DOM of the scan and sends the key as a header", async () => {
    const { src, calls } = source(baseRoutes, { apiKey: "synthetic-key" });
    const [copy] = await src.lookup("https://promo.example/offer/?clickid=synthetic1");
    expect(copy.html).toContain("forms.example/send.php");
    expect(calls.find((c) => c.url.includes("/dom/"))?.headers["api-key"]).toBe("synthetic-key");
    expect((await src.available()).reason ?? "").not.toMatch(/DOM/);
  });

  it("saves the screenshot when a folder is given", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "archiwum-test-"));
    const { src } = source(baseRoutes, { screenshotDir: dir });
    const [copy] = await src.lookup("https://promo.example/offer/?clickid=synthetic1");
    expect(copy.screenshotPath).toBe(path.join(dir, `${U1}.png`));
    expect(existsSync(copy.screenshotPath!)).toBe(true);
  });

  it("never asks urlscan to scan anything", async () => {
    const { src, calls } = source(baseRoutes, { apiKey: "synthetic-key" });
    await src.lookup("https://promo.example/offer/?clickid=synthetic1");
    expect(calls.every((c) => !/\/api\/v1\/scan\/?(\?|$)/.test(c.url))).toBe(true);
  });
});
