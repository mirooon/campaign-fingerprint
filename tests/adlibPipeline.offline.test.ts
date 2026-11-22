/**
 * Library records (recorded responses of Meta and Google) -> `searchSources` -> case folders ->
 * `analyze-material --cases`: every record gets a result and the library traces reach its features.
 * No network: the sources run on recorded output of their helper scripts.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCache } from "../lib/cache";
import { adRecordToCaseDir, searchSources } from "../lib/adlib/index";
import { createGoogleSource } from "../lib/adlib/google";
import { createMetaSource } from "../lib/adlib/meta";
import { ADLIB_FIXTURES } from "../lib/adlib/testkit";
import type { ToolRunner } from "../lib/media/tools";
import { analyzeMaterial, type MaterialResult } from "../lib/pipeline/analyzeMaterial";
import { compileWatchlist, loadWatchlist } from "../lib/text/persona";
import { runSample, SAMPLE } from "./sampleRun";

const fixture = (f: string) => readFileSync(path.join(ADLIB_FIXTURES, f), "utf8");
const answering = (stdout: string): ToolRunner => async () => ({ code: 0, stdout, stderr: "", timedOut: false });
const NOW = () => "2026-11-21T10:00:00.000Z";

let root: string;
let result: MaterialResult;
let caseNames: string[];

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "adlib-pipeline-"));
  const run = await runSample({ only: ["c1-01", "c1-02", "c1-04"] });
  const data = path.join(root, "run");
  mkdirSync(data);
  writeFileSync(path.join(data, "enriched.json"), JSON.stringify(run.ds));
  writeFileSync(path.join(data, "campaigns.json"), JSON.stringify(run.campaigns));
  writeFileSync(path.join(data, "graph.json"), JSON.stringify(run.graph));

  const sources = {
    meta: createMetaSource({ env: { META_ADS_PYTHON: "/x/python" }, run: answering(fixture("meta_search_output.json")), now: NOW }),
    google: createGoogleSource({ env: {}, run: answering(fixture("google_atc_output.json")), now: NOW, cache: createCache({ namespace: "t", enabled: false }) }),
  };
  // the availability checks of the real sources ask Python; here both are declared available
  sources.meta.available = async () => ({ ok: true });
  sources.google.available = async () => ({ ok: true });
  const found = await searchSources(sources, ["meta", "google"], [{ keyword: "test" }]);
  const cases = path.join(root, "sprawy");
  for (const rec of found.records) await adRecordToCaseDir(rec, cases);
  caseNames = readdirSync(cases).sort();
  result = await analyzeMaterial(
    { caseDirs: caseNames.map((n) => path.join(cases, n)) },
    {
      dataDir: data,
      workDir: path.join(root, "work"),
      fixtures: path.join(SAMPLE, "fixtures"),
      config: run.config,
      personas: compileWatchlist(loadWatchlist(path.join(SAMPLE, "personas.json"))),
      media: { ocr: false },
    },
  );
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("search -> case folders -> analyze-material", () => {
  it("makes one case folder per record, named after the platform and the ad ID", () => {
    expect(caseNames).toEqual(["google_CR0000000000000000101", "google_CR0000000000000000102", "google_CR0000000000000000201", "meta_1000000000000501", "meta_1000000000000502"]);
  });

  it("gives every record a result", () => {
    expect(result.items.map((i) => i.id).sort()).toEqual(caseNames);
    for (const it of result.items) expect(it.verdict, it.id).toBeTruthy();
  });

  it("carries the library traces to the features of the material", () => {
    const g = result.items.find((i) => i.id === "google_CR0000000000000000101")!;
    expect(g.features).toMatchObject({
      adPlatform: "google",
      adLibraryAdId: "CR0000000000000000101",
      adAdvertiserId: "AR0000000000000000001",
      adAdvertiserLegalName: "Fikcyjna Firma Sp. z o.o.",
      adAdvertiserLocation: "PL",
      adAdvertiserVerified: "tak",
    });
    const m = result.items.find((i) => i.id === "meta_1000000000000501")!;
    expect(m.features.adPlatform).toBe("meta");
    expect(m.features.advertiser).toBe("Inwestycje Przykladowe");
  });

  it("puts two records of one Google advertiser account together although their display names differ", () => {
    const a = result.items.find((i) => i.id === "google_CR0000000000000000101")!;
    const b = result.items.find((i) => i.id === "google_CR0000000000000000102")!;
    expect(a.features.advertiser).not.toBe(b.features.advertiser);
    expect(a.withNew).toContain(b.id);
  });
});
