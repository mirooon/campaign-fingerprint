import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createCache } from "../cache";
import type { ToolRunner } from "../media/tools";
import { ADLIB_CONFIG } from "./config";
import type { AdLibrarySource, AdRecord } from "./types";
import { createGoogleSource, parseGoogleOutput } from "./google";
import { ADLIB_FIXTURES } from "./testkit";

const read = (f: string) => readFileSync(path.join(ADLIB_FIXTURES, f), "utf8");
const NOW = "2026-11-21T10:00:00.000Z";
const ok = (stdout: string): ToolRunner => async () => ({ code: 0, stdout, stderr: "", timedOut: false });

let tmp: string | null = null;
afterAll(() => tmp && rmSync(tmp, { recursive: true, force: true }));

describe("parseGoogleOutput", () => {
  it("maps rows to records with the advertiser account, legal name, country, verification and payer", () => {
    const { records } = parseGoogleOutput(read("google_atc_output.json"), NOW);
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      platform: "google",
      adId: "CR0000000000000000101",
      libraryUrl: "https://atc.example/advertiser/AR0000000000000000001/creative/CR0000000000000000101",
      fetchedAt: NOW,
      advertiser: { name: "Nazwa Wyswietlana Pierwsza", id: "AR0000000000000000001", legalName: "Fikcyjna Firma Sp. z o.o.", location: "PL", verified: true },
      payers: ["Fundator Testowy"],
      regions: ["PL", "DE"],
    });
    expect(records[0].landingUrl).toBeUndefined();
  });

  it("gives the same advertiser ID to records with different display names", () => {
    const { records } = parseGoogleOutput(read("google_atc_output.json"), NOW);
    expect(records[0].advertiser?.id).toBe(records[1].advertiser?.id);
    expect(records[0].advertiser?.name).not.toBe(records[1].advertiser?.name);
  });

  it("names a payer only when the funder differs from the advertiser (ignoring case)", () => {
    const { records } = parseGoogleOutput(read("google_atc_output.json"), NOW);
    expect(records[1].payers).toEqual([]);
    expect(records[2].payers).toEqual([]);
  });

  it("reads the verification status and the dates when the level of detail has them", () => {
    const { records } = parseGoogleOutput(read("google_atc_output.json"), NOW);
    expect(records[2].advertiser).toMatchObject({ name: "Druga Firma Ltd", verified: false, legalName: "Druga Firma Ltd" });
    expect(records[2].firstSeen).toBe("2026-10-01T00:00:00.000Z");
    expect(records[2].lastSeen).toBe("2026-11-15T00:00:00.000Z");
  });

  it("says what the lean level leaves out, and uses the advertiser ID as the name", () => {
    const { records, notes } = parseGoogleOutput(read("google_atc_output_lean.json"), NOW);
    expect(records[0].advertiser).toMatchObject({ name: "AR0000000000000000001", id: "AR0000000000000000001", location: "PL" });
    expect(records[0].advertiser?.legalName).toBeUndefined();
    expect(records[0].advertiser?.verified).toBeNull();
    expect(notes.join(" ")).toMatch(/nazw.*weryfikacj.*ADLIB_BQ_MAX_BYTES/);
  });

  it("turns a refused query into an error that says the estimate and what to do", () => {
    expect(() => parseGoogleOutput(read("google_atc_over_limit.json"), NOW)).toThrow(/25\.0 GB.*ADLIB_BQ_MAX_BYTES/);
  });

  it("does not treat unreadable output as an empty result", () => {
    expect(() => parseGoogleOutput("Traceback", NOW)).toThrow(/niepoprawny wynik/);
  });
});

describe("Google source", () => {
  it("asks for all creatives of an advertiser ID in the EEA with the byte limit from the configuration", async () => {
    const calls: string[][] = [];
    const run: ToolRunner = async (_c, args) => {
      calls.push(args);
      return { code: 0, stdout: read("google_atc_output.json"), stderr: "", timedOut: false };
    };
    const src = createGoogleSource({ run, now: () => NOW, env: {}, cache: createCache({ namespace: "t", enabled: false }) });
    const recs = await src.search({ advertiser: "AR0000000000000000001" });
    expect(recs).toHaveLength(3);
    const args = calls[0];
    expect(args[0]).toContain("google_atc.py");
    expect(args).toEqual(expect.arrayContaining(["--advertiser", "AR0000000000000000001", "--max-bytes", String(10 * 1024 ** 3), "--regions", ADLIB_CONFIG.google.eeaRegions.join(",")]));
    expect(args).not.toContain("--country");
  });

  it("passes the country as the display region and dates, and no EEA list", async () => {
    const calls: string[][] = [];
    const run: ToolRunner = async (_c, args) => (calls.push(args), { code: 0, stdout: read("google_atc_output.json"), stderr: "", timedOut: false });
    const src = createGoogleSource({ run, now: () => NOW, env: { ADLIB_BQ_MAX_BYTES: "20GB" }, cache: createCache({ namespace: "t", enabled: false }) });
    await src.search({ advertiser: "Fikcyjna", country: "PL", from: "2026-01-01", to: "2026-11-01", limit: 5 });
    expect(calls[0]).toEqual(expect.arrayContaining(["--country", "PL", "--from", "2026-01-01", "--to", "2026-11-01", "--limit", "5", "--max-bytes", String(20 * 1024 ** 3)]));
    expect(calls[0]).not.toContain("--regions");
  });

  it("reports a refused query as an error, not as an empty list", async () => {
    const src = createGoogleSource({ run: ok(read("google_atc_over_limit.json")), now: () => NOW, env: {}, cache: createCache({ namespace: "t", enabled: false }) });
    await expect(src.search({ keyword: "inwestycja" })).rejects.toThrow(/limit to 10\.0 GB/);
  });

  it("does not ask BigQuery again for the same search (result cache per query)", async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "adlib-cache-"));
    let calls = 0;
    const run: ToolRunner = async () => (calls++, { code: 0, stdout: read("google_atc_output.json"), stderr: "", timedOut: false });
    const src = createGoogleSource({ run, now: () => NOW, env: {}, cache: createCache({ namespace: "adlib-google", dir: tmp, enabled: true }) });
    const first = await src.search({ advertiser: "AR0000000000000000001" });
    const second = await src.search({ advertiser: "AR0000000000000000001" });
    expect(calls).toBe(1);
    expect(second).toEqual(first);
    await src.search({ advertiser: "AR0000000000000000002" });
    expect(calls).toBe(2);
  });

  it("does not cache a failed query", async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "adlib-cache-"));
    let calls = 0;
    const run: ToolRunner = async () => (calls++, { code: 0, stdout: read("google_atc_over_limit.json"), stderr: "", timedOut: false });
    const src = createGoogleSource({ run, now: () => NOW, env: {}, cache: createCache({ namespace: "adlib-google", dir: tmp, enabled: true }) });
    await expect(src.search({ keyword: "x" })).rejects.toThrow();
    await expect(src.search({ keyword: "x" })).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it("is unavailable without credentials, with the commands that give access", async () => {
    const run = ok(JSON.stringify({ ok: false, backend: null, reason: "brak poświadczeń ADC dla google-cloud-bigquery" }));
    const a = await createGoogleSource({ run, env: {} }).available();
    expect(a.ok).toBe(false);
    expect(a.reason).toContain("ADC");
    expect(a.howToGetAccess).toContain("gcloud auth application-default login");
  });

  it("is unavailable, with the reason, when Python cannot be started", async () => {
    const run: ToolRunner = async () => ({ code: null, stdout: "", stderr: "spawn python3 ENOENT", timedOut: false });
    const a = await createGoogleSource({ run, env: {} }).available();
    expect(a).toMatchObject({ ok: false });
    expect(a.reason).toContain("python3");
  });

  it("looks up one creative by its ID", async () => {
    const calls: string[][] = [];
    const run: ToolRunner = async (_c, args) => (calls.push(args), { code: 0, stdout: read("google_atc_output_lean.json"), stderr: "", timedOut: false });
    const src = createGoogleSource({ run, now: () => NOW, env: {}, cache: createCache({ namespace: "t", enabled: false }) });
    const rec = await src.getAd("CR0000000000000000101");
    expect(rec?.adId).toBe("CR0000000000000000101");
    expect(calls[0]).toEqual(expect.arrayContaining(["--creative", "CR0000000000000000101"]));
    expect(await src.getAd("not an id")).toBeNull();
  });

  it("sends a domain to the RPC when it is switched on, and says how to switch it on when it is not", async () => {
    const rpcRec: AdRecord = { platform: "google", adId: "CR0000000000000000301", libraryUrl: "u", fetchedAt: NOW, creatives: [], landingUrl: "https://oferta-przyklad.example/" };
    const off: AdLibrarySource = { platform: "google", available: async () => ({ ok: false, reason: "wyłączone", howToGetAccess: "ADLIB_GOOGLE_RPC=1" }), search: async () => [], getAd: async () => null };
    const on: AdLibrarySource = { ...off, available: async () => ({ ok: true }), search: async () => [rpcRec] };
    const never: ToolRunner = async () => {
      throw new Error("BigQuery must not be asked for a domain");
    };
    await expect(createGoogleSource({ run: never, rpc: off, env: {} }).search({ keyword: "oferta-przyklad.example" })).rejects.toThrow(/ADLIB_GOOGLE_RPC=1/);
    expect(await createGoogleSource({ run: never, rpc: on, env: {} }).search({ keyword: "oferta-przyklad.example" })).toEqual([rpcRec]);
  });

  it("is available through the RPC alone when BigQuery has no access", async () => {
    const run = ok(JSON.stringify({ ok: false, backend: null, reason: "brak ADC" }));
    const on: AdLibrarySource = { platform: "google", available: async () => ({ ok: true }), search: async () => [], getAd: async () => null };
    expect((await createGoogleSource({ run, rpc: on, env: {} }).available()).ok).toBe(true);
  });
});
