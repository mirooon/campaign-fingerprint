/**
 * The lookups step of analyze-material and what the result says about RDAP and DNS that got no answer
 * (an empty base, injected sources, no network): the record's errors, `failedLookups`, the step status and
 * the completeness list the GUI shows.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FetchPageResult } from "../osint/fetchPage";
import { completeness } from "../viewer/completeness";
import { jobFailedLookups } from "../viewer/jobs";
import { analyzeMaterial, type MaterialContext, type MaterialResult } from "./analyzeMaterial";
import { lookupsOffReason } from "./lookupFailures";
import type { EnrichmentSources } from "./sources";

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "lookups-step-"));
  const data = path.join(root, "baza");
  mkdirSync(data);
  writeFileSync(path.join(data, "enriched.json"), JSON.stringify({ version: 1, generatedAt: "2026-11-22T00:00:00.000Z", mode: "offline", baseDir: ".", items: [], perItem: {}, pages: {}, hosts: {}, domains: {}, ips: {} }));
  writeFileSync(path.join(data, "campaigns.json"), JSON.stringify({ version: 1, generatedAt: "2026-11-22T00:00:00.000Z", method: { unionFind: "test", louvain: { resolution: 1, seed: 1, modularity: null }, minLinkScore: 0.5 }, campaigns: [], assignments: {} }));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

/** Live sources with one saved-looking page per address; RDAP throws (no network) for the domains in `rdapDown`. */
function live(rdapDown: string[] = []): EnrichmentSources {
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
    body: "<html><head><title>Oferta</title></head><body><p>Zapisz się na lokatę z wysokim zyskiem.</p></body></html>",
    bodySha256: null,
    userAgent: "test",
    remoteAddress: null,
    error: null,
    errorCode: null,
    fetchedAt: "2026-11-22T00:00:00.000Z",
    durationMs: 0,
  });
  return {
    mode: "live",
    fetchPage: async (url) => page(url),
    fetchBinary: async () => null,
    dns: async (name) => ({ name, a: [], aaaa: [], cname: [], ns: [], mx: [], txt: [], errors: {} }),
    rdap: async (domain) => {
      if (rdapDown.includes(domain)) throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
      return null;
    },
    ct: async () => null,
    asn: async () => null,
  };
}

const input = { url: "https://lp-a.example/oferta", text: "Formularz: https://lp-b.example/zapis" };
const ctx = (work: string, sources: EnrichmentSources | null): MaterialContext => ({ dataDir: path.join(root, "baza"), workDir: path.join(root, work), live: sources, personas: null, media: { ocr: false } });
const lookupsStep = (res: MaterialResult) => res.steps.find((s) => s.step === "lookups");

describe("analyzeMaterial: RDAP and DNS without an answer", () => {
  it("puts the RDAP failure into the record's errors and failedLookups, counts it in the step, and the GUI list warns about it", async () => {
    const res = await analyzeMaterial(input, ctx("w-partial", live(["lp-b.example"])));
    const [it] = res.items;
    expect(it.errors).toContain("RDAP nie odpowiedział dla lp-b.example: brak połączenia z siecią");
    expect(res.failedLookups).toEqual(["rdap:lp-b.example"]);
    expect(lookupsStep(res)).toMatchObject({ status: "done", detail: "RDAP nie odpowiedział dla 1 z 2 domen: lp-b.example" });
    // what the result card builds (jobs.ts merges the failed lookups, completeness picks the ones of the material)
    const domains = (it.pivots ?? []).filter((p) => p.type === "domain").map((p) => p.label);
    const list = completeness({ features: it.features, errors: it.errors, failedLookups: jobFailedLookups(res, null), lookups: true, domains });
    const warn = list.items.filter((i) => i.status === "warn" && i.label.startsWith("The domain registry (RDAP) did not respond for domain lp-b.example"));
    expect(warn).toHaveLength(1);
    expect(warn[0].effect).toMatch(/^Reason: brak połączenia z siecią\. The comparison has no registration date/);
    expect(list.complete).toBe(false);
  });

  it("is done without failures when every lookup answered", async () => {
    const res = await analyzeMaterial(input, ctx("w-ok", live()));
    expect(res.items[0].errors.filter((e) => /nie odpowiedział/.test(e))).toEqual([]);
    expect(res.failedLookups).toEqual([]);
    expect(lookupsStep(res)).toMatchObject({ status: "done", detail: "RDAP i DNS odpowiedziały dla 2 z 2 domen" });
  });

  it("skips the step with the reason in an offline run (the container default), without any lookup error", async () => {
    vi.stubEnv("ANALYZE_OFFLINE", "1");
    const res = await analyzeMaterial(input, ctx("w-offline", null));
    expect(lookupsStep(res)).toMatchObject({ status: "skipped", detail: lookupsOffReason({ ANALYZE_OFFLINE: "1" }) });
    expect(res.failedLookups).toEqual([]);
    expect(res.items[0].errors.filter((e) => /nie odpowiedział/.test(e))).toEqual([]);
  });
});
