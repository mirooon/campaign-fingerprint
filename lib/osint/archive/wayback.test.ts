import { readFileSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { DEFAULT_ARCHIVE_CONFIG } from "./config";
import { ArchiveLookupError, type ArchiveHttp, type ArchiveHttpResponse } from "./http";
import { createWaybackSource, waybackTimestamp } from "./wayback";

const FIX = path.join(__dirname, "../../../tests/fixtures/archive");
const cdx = readFileSync(path.join(FIX, "wayback-cdx.json"));
const page = readFileSync(path.join(FIX, "wayback-page.html"));
const NOW = new Date("2026-11-22T10:00:00Z");
const cfg = { ...DEFAULT_ARCHIVE_CONFIG, waybackRetryDelayMs: 0 };

/** Recorded answers by address fragment; remembers every address asked. */
function recorded(routes: Array<[string, ArchiveHttpResponse | (() => ArchiveHttpResponse)]>) {
  const calls: string[] = [];
  const http: ArchiveHttp = async (url) => {
    calls.push(url);
    const hit = routes.find(([frag]) => url.includes(frag));
    if (!hit) throw new Error(`nieoczekiwane zapytanie: ${url}`);
    return typeof hit[1] === "function" ? hit[1]() : hit[1];
  };
  return { http, calls };
}
const ok = (body: Buffer, headers: Record<string, string> = {}): ArchiveHttpResponse => ({ status: 200, headers, body });

describe("waybackTimestamp", () => {
  it("reads a CDX timestamp as UTC ISO time", () => {
    expect(waybackTimestamp("20261002083000")).toBe("2026-10-02T08:30:00.000Z");
  });
  it("returns null for a malformed timestamp", () => {
    expect(waybackTimestamp("2026")).toBeNull();
  });
});

describe("wayback source", () => {
  it("returns the capture nearest to `before`, with the time taken from the timestamp", async () => {
    const { http, calls } = recorded([
      ["/cdx/search/cdx", ok(cdx)],
      ["/web/20261002083000id_/", ok(page)],
    ]);
    const src = createWaybackSource({ http, now: () => NOW, config: cfg });
    const copies = await src.lookup("https://promo.example/offer/", { before: "2026-10-03T00:00:00Z" });
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({
      source: "wayback",
      url: "https://promo.example/offer/",
      sourceUrl: "https://web.archive.org/web/20261002083000/https://promo.example/offer/",
      capturedAt: "2026-10-02T08:30:00.000Z",
      fetchedAt: NOW.toISOString(),
    });
    expect(copies[0].html).toContain("Synthetic Offer Page");
    expect(calls.some((c) => c.includes("filter=statuscode%3A200") || c.includes("filter=statuscode:200"))).toBe(true);
  });

  it("decompresses gzip and zstd bodies even without a Content-Encoding header", async () => {
    const zstdCompressSync = (zlib as unknown as { zstdCompressSync?: (b: Buffer) => Buffer }).zstdCompressSync;
    for (const body of [zlib.gzipSync(page), ...(zstdCompressSync ? [zstdCompressSync(page)] : [])]) {
      const { http } = recorded([
        ["/cdx/search/cdx", ok(cdx)],
        ["id_/", ok(body)],
      ]);
      const [copy] = await createWaybackSource({ http, now: () => NOW, config: cfg }).lookup("https://promo.example/offer/");
      expect(copy.html).toContain("Join the synthetic programme");
    }
  });

  it("passes `after` as the start of the CDX range and asks for the capture closest to `before`", async () => {
    const { http, calls } = recorded([
      ["/cdx/search/cdx", ok(Buffer.from("[]"))],
    ]);
    await createWaybackSource({ http, now: () => NOW, config: cfg }).lookup("https://promo.example/offer/", { after: "2026-09-10T00:00:00Z", before: "2026-10-01T00:00:00Z" });
    expect(calls[0]).toContain("from=20260910000000");
    expect(calls[0]).toContain("closest=20261001000000");
  });

  it("returns no copies and fetches no body when the CDX has no rows", async () => {
    const { http, calls } = recorded([["/cdx/search/cdx", ok(Buffer.from("[]"))]]);
    const copies = await createWaybackSource({ http, now: () => NOW, config: cfg }).lookup("https://promo.example/offer/");
    expect(copies).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("retries a 504 once, then reports the reason instead of throwing a bare error", async () => {
    const { http, calls } = recorded([["/cdx/search/cdx", { status: 504, headers: {}, body: Buffer.from("") }]]);
    const src = createWaybackSource({ http, now: () => NOW, config: cfg });
    const err = await src.lookup("https://promo.example/offer/").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ArchiveLookupError);
    expect((err as ArchiveLookupError).reason).toMatch(/504/);
    expect(calls).toHaveLength(2);
  });

  it("succeeds when the retry after a timeout answers", async () => {
    let n = 0;
    const { http } = recorded([
      ["/cdx/search/cdx", () => {
        if (n++ === 0) throw new Error("timeout");
        return ok(cdx);
      }],
      ["id_/", ok(page)],
    ]);
    const copies = await createWaybackSource({ http, now: () => NOW, config: cfg }).lookup("https://promo.example/offer/");
    expect(copies).toHaveLength(1);
  });

  it("is available without a key", async () => {
    const { http } = recorded([]);
    expect((await createWaybackSource({ http, now: () => NOW, config: cfg }).available()).ok).toBe(true);
  });
});
