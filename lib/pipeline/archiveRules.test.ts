import { describe, expect, it } from "vitest";
import { buildEvidenceGraph } from "../graph/link";
import type { ArchivedCopy, ArchiveSource } from "../osint/archive";
import type { FetchPageResult } from "../osint/fetchPage";
import { enrichItems } from "./enrich";
import type { EnrichmentSources } from "./sources";
import type { Item } from "./types";

const deadPage = (url: string): FetchPageResult => ({
  requestedUrl: url, finalUrl: url, status: null, ok: false, redirectChain: [], contentType: null, headers: {}, bytes: 0, truncated: false, body: null, bodySha256: null,
  userAgent: "test", remoteAddress: null, error: "getaddrinfo ENOTFOUND", errorCode: "network", fetchedAt: "2026-11-22T00:00:00.000Z", durationMs: 0,
});

/** Sources of a dead page on a domain registered on 2026-09-10 (RDAP), nothing else known. */
const sources: EnrichmentSources = {
  mode: "live",
  fetchPage: async (url) => deadPage(url),
  fetchBinary: async () => null,
  dns: async (name) => ({ name, a: [], aaaa: [], cname: [], ns: [], mx: [], txt: [], errors: {} }) as unknown as Awaited<ReturnType<EnrichmentSources["dns"]>>,
  rdap: async (domain) => ({ domain, registrar: null, registrarIanaId: null, created: "2026-09-10T00:00:00Z", expires: null, updated: null, status: [], nameservers: [], abuseEmail: null, source: null }),
  ct: async () => null,
  asn: async () => null,
};

const item: Item = { id: "m1", platform: null, advertiser: null, text: null, imageUrl: null, imagePath: null, landingUrl: "https://reregistered.example/lp/", firstSeen: "2026-10-20T00:00:00Z", lastSeen: null, label: null, persona: null, deepfakeScore: null, videoPath: null, extra: {} };

/** A capture of an earlier owner: a page with a form backend and a script that must not become features. */
const oldCopy: ArchivedCopy = {
  source: "wayback",
  url: "https://reregistered.example/lp/",
  sourceUrl: "https://web.archive.org/web/20160501000000/https://reregistered.example/lp/",
  capturedAt: "2016-05-01T00:00:00.000Z",
  fetchedAt: "2026-11-22T10:00:00.000Z",
  html: '<html><head><title>Old Shop</title><script src="https://cdn.example/js/old-shop.min.js"></script></head><body><form action="https://forms.example/old.php"><input type="hidden" name="old_token"></form></body></html>',
};
const wayback: ArchiveSource = { name: "wayback", available: async () => ({ ok: true }), lookup: async () => [oldCopy] };

describe("archive step: copy from before the registration", () => {
  it("adds no pivot to the graph, only the re-registered mark on the domain", async () => {
    const without = await enrichItems([item], { sources, baseDir: "." });
    const withArchive = await enrichItems([item], { sources, baseDir: ".", archive: { sources: [wayback] } });
    const a = buildEvidenceGraph(without, { includeItemPivots: true });
    const b = buildEvidenceGraph(withArchive, { includeItemPivots: true });
    expect(b.nodes.map((n) => n.id).sort()).toEqual(a.nodes.map((n) => n.id).sort());
    expect(b.itemPivots).toEqual(a.itemPivots);
    expect(b.nodes.find((n) => n.id === "domain:reregistered.example")?.data.reRegistered).toBe(true);
    expect(a.nodes.find((n) => n.id === "domain:reregistered.example")?.data.reRegistered).toBeUndefined();
  });
});
