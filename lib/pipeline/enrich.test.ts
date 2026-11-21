import { describe, expect, it } from "vitest";
import type { FetchPageResult } from "../osint/fetchPage";
import { enrichItems } from "./enrich";
import type { EnrichmentSources } from "./sources";
import type { Item } from "./types";

/** Live sources that record the requested page addresses and answer with an empty page. */
function recordingLive(requested: string[]): EnrichmentSources {
  const page = (url: string): FetchPageResult => ({
    requestedUrl: url,
    finalUrl: url,
    status: 200,
    ok: true,
    redirectChain: [],
    contentType: "text/html",
    headers: {},
    bytes: 0,
    truncated: false,
    body: "<html><body>x</body></html>",
    bodySha256: null,
    userAgent: "test",
    remoteAddress: null,
    error: null,
    errorCode: null,
    fetchedAt: "2026-01-15T00:00:00.000Z",
    durationMs: 0,
  });
  return {
    mode: "live",
    fetchPage: async (url) => {
      requested.push(url);
      return page(url);
    },
    fetchBinary: async () => null,
    dns: async (name) => ({ name, a: [], aaaa: [], cname: [], ns: [], mx: [], txt: [], errors: {} }) as unknown as Awaited<ReturnType<EnrichmentSources["dns"]>>,
    rdap: async () => null,
    ct: async () => null,
    asn: async () => null,
  };
}

describe("enrichItems: the landing page in live mode", () => {
  it("requests the full address with fbclid and utm_* (many scam pages answer only to it), keyed by the normalised address", async () => {
    const url = "https://lp.example/landers/x/?clickid=c1&fbclid=IwAR0&utm_source=fb";
    const item: Item = { id: "m1", platform: null, advertiser: null, text: null, imageUrl: null, imagePath: null, landingUrl: url, firstSeen: null, lastSeen: null, label: null, persona: null, deepfakeScore: null, videoPath: null, extra: {} };
    const requested: string[] = [];
    const out = await enrichItems([item], { sources: recordingLive(requested), baseDir: "." });
    expect(requested[0]).toBe(url);
    expect(out.perItem.m1.pageKey).toBe("https://lp.example/landers/x/?clickid=c1");
    expect(Object.keys(out.pages)).toEqual(["https://lp.example/landers/x/?clickid=c1"]);
  });
});
