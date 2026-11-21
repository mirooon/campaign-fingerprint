import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCache } from "../../cache";
import { DEFAULT_ARCHIVE_CONFIG } from "./config";
import { ArchiveLookupError } from "./http";
import { archiveSourceNames, earliestAcceptable, findArchivedCopy, judgeCopy, withCache } from "./index";
import type { ArchivedCopy, ArchiveSource } from "./types";

const NOW = new Date("2026-11-22T10:00:00Z");
const URL_ = "https://promo.example/offer/";
const copy = (source: ArchivedCopy["source"], capturedAt: string, extra: Partial<ArchivedCopy> = {}): ArchivedCopy => ({
  source,
  url: URL_,
  sourceUrl: `https://archive.example/${source}/${capturedAt}`,
  capturedAt,
  fetchedAt: NOW.toISOString(),
  html: "<html><title>Synthetic</title></html>",
  ...extra,
});

/** Fake source: answers by the `after` it is asked with, and remembers every call. */
function fake(name: ArchiveSource["name"], answer: (opts: { before?: string; after?: string }) => ArchivedCopy[] | Error, avail: { ok: boolean; reason?: string } = { ok: true }) {
  const calls: Array<{ url: string; before?: string; after?: string }> = [];
  const source: ArchiveSource = {
    name,
    available: async () => avail,
    lookup: async (url, opts = {}) => {
      calls.push({ url, ...opts });
      const r = answer(opts);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { source, calls };
}

describe("judgeCopy", () => {
  const ctx = { config: DEFAULT_ARCHIVE_CONFIG };
  it("rejects a copy made before the registration of the domain, and marks the domain as re-registered", () => {
    const v = judgeCopy(copy("wayback", "2016-05-01T00:00:00Z"), { ...ctx, domainCreated: "2026-09-10T00:00:00Z" });
    expect(v).toEqual({ reason: "kopia sprzed rejestracji domeny", reRegistered: true });
  });
  it("uses the oldest known certificate when RDAP gives no creation date", () => {
    const v = judgeCopy(copy("wayback", "2026-01-01T00:00:00Z"), { ...ctx, oldestCert: "2026-09-12T00:00:00Z" });
    expect(v).toEqual({ reason: "kopia sprzed rejestracji domeny", reRegistered: false });
  });
  it("rejects a copy older than the first sighting by more than the allowed days, without claiming re-registration", () => {
    const v = judgeCopy(copy("urlscan", "2026-08-01T00:00:00Z"), { ...ctx, firstSeen: "2026-10-20T00:00:00Z" });
    expect(v?.reason).toMatch(/30 dni/);
    expect(v?.reRegistered).toBe(false);
  });
  it("accepts a copy within the allowed age, a later copy, and a copy when nothing is known to compare with", () => {
    expect(judgeCopy(copy("urlscan", "2026-10-01T00:00:00Z"), { ...ctx, firstSeen: "2026-10-20T00:00:00Z", domainCreated: "2026-09-10T00:00:00Z" })).toBeNull();
    expect(judgeCopy(copy("urlscan", "2026-11-05T00:00:00Z"), { ...ctx, firstSeen: "2026-10-20T00:00:00Z" })).toBeNull();
    expect(judgeCopy(copy("wayback", "2016-05-01T00:00:00Z"), ctx)).toBeNull();
  });
});

describe("earliestAcceptable", () => {
  it("is the latest of the registration date and the first sighting minus the allowed age", () => {
    expect(earliestAcceptable({ config: DEFAULT_ARCHIVE_CONFIG, domainCreated: "2026-09-10T00:00:00Z", firstSeen: "2026-10-20T00:00:00Z" })).toBe("2026-09-20T00:00:00.000Z");
    expect(earliestAcceptable({ config: DEFAULT_ARCHIVE_CONFIG, domainCreated: "2026-10-01T00:00:00Z", firstSeen: "2026-10-20T00:00:00Z" })).toBe("2026-10-01T00:00:00.000Z");
    expect(earliestAcceptable({ config: DEFAULT_ARCHIVE_CONFIG })).toBeNull();
  });
});

describe("archiveSourceNames", () => {
  it("reads the list, keeps the fixed order and rejects unknown names", () => {
    expect(archiveSourceNames("wayback, urlscan")).toEqual({ names: ["urlscan", "wayback"] });
    expect(archiveSourceNames("urlscan,altavista").error).toMatch(/altavista/);
    expect(archiveSourceNames("")).toEqual({ names: [] });
  });
});

describe("findArchivedCopy", () => {
  it("rejects a Wayback copy from before the registration; nothing is used and the domain is re-registered", async () => {
    const wb = fake("wayback", () => [copy("wayback", "2016-05-01T00:00:00Z")]);
    const out = await findArchivedCopy(URL_, { sources: [wb.source], domainCreated: "2026-09-10T00:00:00Z" });
    expect(out.copy).toBeNull();
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0].rejected?.reason).toBe("kopia sprzed rejestracji domeny");
    expect(out.reRegistered).toBe(true);
    expect(out.tried[0].status).toBe("rejected");
    expect(out.summary).toMatch(/sprzed rejestracji/);
    // a second query looks for a copy from the current owner
    expect(wb.calls[1].after).toBe("2026-09-10T00:00:00.000Z");
  });

  it("uses the copy of the current owner found by the second query and still reports the rejected one", async () => {
    const wb = fake("wayback", (o) => [o.after ? copy("wayback", "2026-10-02T08:30:00Z") : copy("wayback", "2016-05-01T00:00:00Z")]);
    const out = await findArchivedCopy(URL_, { sources: [wb.source], domainCreated: "2026-09-10T00:00:00Z" });
    expect(out.copy?.capturedAt).toBe("2026-10-02T08:30:00Z");
    expect(out.rejected).toHaveLength(1);
    expect(out.reRegistered).toBe(true);
    expect(out.summary).toBe("kopia z wayback z 2026-10-02");
  });

  it("asks the sources in order and stops at the first acceptable copy", async () => {
    const us = fake("urlscan", () => [copy("urlscan", "2026-11-03T09:00:00Z")]);
    const wb = fake("wayback", () => [copy("wayback", "2026-10-02T08:30:00Z")]);
    const out = await findArchivedCopy(URL_, { sources: [us.source, wb.source] });
    expect(out.copy?.source).toBe("urlscan");
    expect(wb.calls).toHaveLength(0);
    expect(out.tried).toEqual([{ source: "urlscan", status: "found" }]);
  });

  it("prefers a copy with the page body: a urlscan copy without DOM gives way to a Wayback copy that has one", async () => {
    const us = fake("urlscan", () => [copy("urlscan", "2026-11-03T09:00:00Z", { html: undefined, requests: [{ url: "https://cdn.example/a.js" }] })]);
    const wb = fake("wayback", () => [copy("wayback", "2026-10-02T08:30:00Z")]);
    const out = await findArchivedCopy(URL_, { sources: [us.source, wb.source] });
    expect(out.copy?.source).toBe("wayback");
    expect(out.tried.map((t) => t.status)).toEqual(["found", "found"]);
  });

  it("keeps the urlscan copy without DOM when no other source has the page body", async () => {
    const us = fake("urlscan", () => [copy("urlscan", "2026-11-03T09:00:00Z", { html: undefined, requests: [{ url: "https://cdn.example/a.js" }] })]);
    const wb = fake("wayback", () => []);
    const out = await findArchivedCopy(URL_, { sources: [us.source, wb.source] });
    expect(out.copy?.source).toBe("urlscan");
    expect(out.summary).toBe("kopia z urlscan z 2026-11-03");
  });

  it("records why a source was skipped (limit) or failed (error) and goes on to the next one", async () => {
    const us = fake("urlscan", () => [], { ok: false, reason: "limit zapytań urlscan (HTTP 429)" });
    const wb = fake("wayback", () => new ArchiveLookupError("wayback", "Internet Archive nie odpowiedział (HTTP 504), po jednym ponowieniu"));
    const out = await findArchivedCopy(URL_, { sources: [us.source, wb.source] });
    expect(out.copy).toBeNull();
    expect(us.calls).toHaveLength(0);
    expect(out.tried).toEqual([
      { source: "urlscan", status: "skipped", reason: "limit zapytań urlscan (HTTP 429)" },
      { source: "wayback", status: "error", reason: "Internet Archive nie odpowiedział (HTTP 504), po jednym ponowieniu" },
    ]);
    expect(out.summary).toMatch(/urlscan: .*429/);
    expect(out.summary).toMatch(/wayback: .*504/);
  });

  it("says plainly that there is no copy when every source answered with nothing", async () => {
    const out = await findArchivedCopy(URL_, { sources: [fake("urlscan", () => []).source, fake("wayback", () => []).source] });
    expect(out.summary).toBe("brak kopii archiwalnej (urlscan, wayback)");
  });

  it("explains that no source is available when the list is empty", async () => {
    expect((await findArchivedCopy(URL_, { sources: [] })).summary).toMatch(/brak źródeł/);
  });
});

describe("withCache", () => {
  it("answers a repeated lookup from the cache and does not cache a failure", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "archiwum-cache-"));
    const cache = createCache({ namespace: "archive-test", dir, enabled: true });
    let n = 0;
    const base = fake("wayback", () => (n++ === 0 ? new ArchiveLookupError("wayback", "chwilowy błąd") : [copy("wayback", "2026-10-02T08:30:00Z")]));
    const src = withCache(base.source, cache, "wayback", DEFAULT_ARCHIVE_CONFIG);
    await expect(src.lookup(URL_)).rejects.toBeInstanceOf(ArchiveLookupError);
    expect(await src.lookup(URL_)).toHaveLength(1);
    expect(await src.lookup(URL_)).toHaveLength(1);
    expect(base.calls).toHaveLength(2);
  });
});
