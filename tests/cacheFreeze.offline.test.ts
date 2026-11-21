/**
 * `cache:freeze`: what a live run left in `.cache/` (pages, DNS, RDAP, crt.sh, ASN) becomes a fixtures
 * folder (`frozen.json`) that replays offline and gives the same enrichment as the run it came from.
 * The recorded run here is the sample read from its recorded responses, written to the cache the way
 * the live sources write it (same keys).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCache } from "../lib/cache";
import { asnCacheKey } from "../lib/osint/asn";
import { ctCacheKey } from "../lib/osint/ct";
import { dnsCacheKey } from "../lib/osint/dns";
import { rdapCacheKey } from "../lib/osint/rdap";
import { enrichItems } from "../lib/pipeline/enrich";
import { freezeEntries, readCacheDump } from "../lib/pipeline/freeze";
import { binaryCacheKey, fixtureSources, pageCacheKey, type EnrichmentSources } from "../lib/pipeline/sources";
import { compileWatchlist, loadWatchlist } from "../lib/text/persona";
import { SAMPLE, sampleItems } from "./sampleRun";

let root: string;
const ids = ["c1-01", "c1-04", "c2-01", "c3-01", "c3-05", "c4-01", "c5-01", "n-01"];
const personas = () => compileWatchlist(loadWatchlist(path.join(SAMPLE, "personas.json")));
const items = () => sampleItems().items.filter((it) => ids.includes(it.id));

/** The sample's recorded responses, written to the cache under the keys of the live sources. */
function recordingSources(cacheDir: string): EnrichmentSources {
  const fx = fixtureSources(path.join(SAMPLE, "fixtures"));
  const cache = (namespace: string) => createCache({ namespace, dir: cacheDir, enabled: true });
  const [page, binary, dns, rdap, ct, asn] = ["page", "binary", "dns", "rdap", "ct", "asn"].map(cache);
  return {
    ...fx,
    fetchPage: async (url, o) => {
      const r = await fx.fetchPage(url, o);
      await page.set(pageCacheKey(url, o?.userAgent), r);
      return r;
    },
    fetchBinary: async (url) => {
      const r = await fx.fetchBinary(url);
      if (r) await binary.set(binaryCacheKey(url), { base64: r.toString("base64") });
      return r;
    },
    dns: async (name, types) => {
      const r = await fx.dns(name, types);
      await dns.set(dnsCacheKey(name, types), r);
      return r;
    },
    rdap: async (d) => {
      const r = await fx.rdap(d);
      if (r) await rdap.set(rdapCacheKey(d), r);
      return r;
    },
    ct: async (d) => {
      const r = await fx.ct(d);
      if (r) await ct.set(ctCacheKey(d), r);
      return r;
    },
    asn: async (ip) => {
      const r = await fx.asn(ip);
      if (r) await asn.set(asnCacheKey(ip), r);
      return r;
    },
  };
}

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "freeze-"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("cache:freeze", () => {
  it("replays a run offline with the same enrichment as the run it came from", async () => {
    const cacheDir = path.join(root, "cache");
    const original = await enrichItems(items(), { sources: recordingSources(cacheDir), baseDir: SAMPLE, personas: personas() });
    const frozenDir = path.join(root, "zamrozone");
    mkdirSync(frozenDir);
    const frozen = freezeEntries(await readCacheDump(cacheDir));
    writeFileSync(path.join(frozenDir, "frozen.json"), JSON.stringify(frozen));
    expect(Object.keys(frozen.pages).length).toBeGreaterThan(5);
    expect(Object.keys(frozen.rdap).length).toBeGreaterThan(0);
    const replay = await enrichItems(items(), { sources: fixtureSources(frozenDir), baseDir: SAMPLE, personas: personas() });
    // the moments of fetching differ between two runs by nature
    const stable = (ds: object) => JSON.stringify(ds, (k, v) => (["generatedAt", "fetchedAt", "durationMs"].includes(k) ? null : v));
    expect(stable(replay)).toBe(stable(original));
  }, 60_000);

  it("keeps entries whatever their age and leaves out other namespaces", async () => {
    const cacheDir = path.join(root, "cache2");
    const page = createCache({ namespace: "page", dir: cacheDir, enabled: true, defaultTtlMs: 1 });
    await page.set(pageCacheKey("https://stara.example/"), { finalUrl: "https://stara.example/" });
    await createCache({ namespace: "embed", dir: cacheDir, enabled: true }).set("x", [1]);
    await new Promise((r) => setTimeout(r, 5));
    const frozen = freezeEntries(await readCacheDump(cacheDir));
    expect(Object.keys(frozen.pages)).toEqual([pageCacheKey("https://stara.example/")]);
  });
});
