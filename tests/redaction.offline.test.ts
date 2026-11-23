/**
 * Data of the analyst's visit and access tokens in captured material: a page saved by the analyst
 * holds the visitor record of the landing-page platform (IP, fingerprint ...) and a link with a Meta
 * token. None of it may reach graph.json, the result of the analysis, its CSV or the evidence pack;
 * the pack keeps a redacted copy next to the hash of the original.
 */
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportEvidencePack } from "../lib/evidence/pack";
import type { PackProvenance } from "../lib/evidence/sourceFiles";
import { analyzeMaterial, evidenceInputsDir, type MaterialResult } from "../lib/pipeline/analyzeMaterial";
import { materialCsv } from "../lib/pipeline/materialCsv";
import { compileWatchlist, loadWatchlist } from "../lib/text/persona";
import { runSample, SAMPLE } from "./sampleRun";

const TOKEN = "EAABsbCS1iHgBO7Zx9yQ2testtoken";
const IP = "192.0.2.213";
const FINGERPRINT = "fp-synthetic-123456";

let root: string;
let res: MaterialResult;
let packDir: string;
let provenance: PackProvenance;

const LANDING = `https://lp-redakcja.example/oferta?offer=5&token=${TOKEN}&ip=${IP}`;
const AIO = JSON.stringify({
  campaign: { uuid: "11111111-1111-4111-8111-111111111111", owner_uuid: "22222222-2222-4222-8222-222222222222", name: "Lato" },
  visit: { ip_address: IP, country: "XX", zip: "99-123", asn: "AS64500", ja3_hash: "c".repeat(32), fingerprint: FINGERPRINT, user_agent: "Mozilla/5.0 Synthetic", campaign_human_id: 42 },
});
const PAGE = `<!-- saved from url=(${String(LANDING.length).padStart(4, "0")})${LANDING} -->
<html><head><title>Oferta</title><script>window.aio = JSON.parse('${AIO}');</script></head>
<body><a href="https://tracker-redakcja.example/go?ip=${IP}&token=${TOKEN}">Zapisz się</a><p>Zapisz się na webinar.</p></body></html>`;
const HAR = JSON.stringify({
  log: {
    entries: [
      {
        startedDateTime: "2026-01-15T09:10:01.000Z",
        serverIPAddress: "203.0.113.10",
        request: { method: "GET", url: LANDING, headers: [{ name: "Cookie", value: "sid=ciasteczko-analityka" }, { name: "User-Agent", value: "Mozilla/5.0 Synthetic" }], cookies: [{ name: "sid", value: "ciasteczko-analityka" }], queryString: [] },
        response: { status: 200, headers: [{ name: "Content-Type", value: "text/html" }, { name: "Server", value: "nginx" }], cookies: [], content: { mimeType: "text/html", text: PAGE } },
      },
    ],
  },
});

const walk = (dir: string, rel = ""): string[] => readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(dir, `${rel}${e.name}/`) : [`${rel}${e.name}`]));

beforeAll(async () => {
  const run = await runSample();
  root = mkdtempSync(path.join(os.tmpdir(), "redaction-"));
  const data = path.join(root, "run");
  mkdirSync(data);
  writeFileSync(path.join(data, "enriched.json"), JSON.stringify(run.ds));
  writeFileSync(path.join(data, "campaigns.json"), JSON.stringify(run.campaigns));
  writeFileSync(path.join(data, "graph.json"), JSON.stringify(run.graph));
  const caseDir = path.join(root, "sprawy", "redakcja-1");
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(path.join(caseDir, "Strona.html"), PAGE);
  writeFileSync(path.join(caseDir, "lp-redakcja.example.har"), HAR);
  res = await analyzeMaterial(
    { caseDirs: [caseDir] },
    { dataDir: data, workDir: path.join(root, "praca"), fixtures: path.join(SAMPLE, "fixtures"), config: run.config, personas: compileWatchlist(loadWatchlist(path.join(SAMPLE, "personas.json"))), media: { ocr: false } },
  );
  const inputs = evidenceInputsDir(path.join(root, "praca"));
  const campaigns = JSON.parse(readFileSync(path.join(inputs, "campaigns.json"), "utf8"));
  provenance = JSON.parse(readFileSync(path.join(inputs, "provenance.json"), "utf8"));
  packDir = path.join(root, "paczka");
  exportEvidencePack({
    campaignId: campaigns.assignments["redakcja-1"],
    graph: JSON.parse(readFileSync(path.join(inputs, "graph.json"), "utf8")),
    campaigns,
    enriched: JSON.parse(readFileSync(path.join(inputs, "enriched.json"), "utf8")),
    provenance,
    outDir: packDir,
    now: () => new Date("2026-11-19T12:00:00Z"),
  });
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

const leaks = (text: string) => [IP, TOKEN, FINGERPRINT, "c".repeat(32), "ciasteczko-analityka", "99-123", "AS64500"].filter((v) => text.includes(v));

describe("analyst data and tokens", () => {
  it("never reach the result of the analysis, graph.json or the CSV, where the token stays recognisable as a hash", () => {
    expect(leaks(JSON.stringify(res)), "result").toEqual([]);
    expect(leaks(materialCsv(res)), "csv").toEqual([]);
    const inputs = evidenceInputsDir(path.join(root, "praca"));
    expect(leaks(readFileSync(path.join(inputs, "graph.json"), "utf8")), "graph.json").toEqual([]);
    expect(readFileSync(path.join(inputs, "graph.json"), "utf8")).toMatch(/EA…\[sha256:[0-9a-f]{12}\]/);
  });

  it("are absent from every text file of the evidence pack", () => {
    for (const f of walk(packDir)) {
      if (/\.(png|jpe?g|webp|gif|mp4|wav|mp3)$/i.test(f)) continue;
      expect(leaks(readFileSync(path.join(packDir, f), "utf8")), f).toEqual([]);
    }
  });

  it("go into the pack as redacted copies, with the hash of the original next to them", () => {
    const manifest = JSON.parse(readFileSync(path.join(packDir, "evidence.json"), "utf8")).integrity.manifest as Array<{ file: string; sha256: string; derived_from_sha256?: string; redaction?: string }>;
    const derived = manifest.filter((m) => m.derived_from_sha256 && !m.file.endsWith(".warc.gz"));
    expect(derived.map((m) => m.file.split("/")[1]).sort()).toEqual(expect.arrayContaining(["har", "html-source"]));
    const originals = provenance.cases[0].files!.filter((f) => f.role === "har" || f.role === "saved_html").map((f) => f.sha256);
    expect(derived.map((m) => m.derived_from_sha256).sort()).toEqual([...originals].sort());
    for (const d of derived) {
      expect(d.redaction).toMatch(/redacted/);
      expect(createHash("sha256").update(readFileSync(path.join(packDir, d.file))).digest("hex")).toBe(d.sha256);
      expect(d.sha256).not.toBe(d.derived_from_sha256);
    }
    expect(statSync(path.join(packDir, "manifest.sha256")).size).toBeGreaterThan(0);
  });

  it("are absent from the WARC made of the HAR, which records the traffic and the hash of the original HAR", () => {
    const manifest = JSON.parse(readFileSync(path.join(packDir, "evidence.json"), "utf8")).integrity.manifest as Array<{ file: string; derived_from_sha256?: string }>;
    const warc = manifest.find((m) => m.file.startsWith("files/warc/"));
    expect(warc?.derived_from_sha256).toBeTruthy();
    const text = gunzipSync(readFileSync(path.join(packDir, warc!.file))).toString("utf8");
    expect(text).toContain("WARC-Target-URI: https://lp-redakcja.example/");
    expect(leaks(text)).toEqual([]);
  });

  it("show addresses defanged in evidence.md, raw only in evidence.json and the DSA notice", () => {
    const md = readFileSync(path.join(packDir, "evidence.md"), "utf8");
    expect(md).toMatch(/hxxps:\/\/[a-z0-9-]+\[\.\]/);
    expect(md).not.toMatch(/https?:\/\/(?!www\.facebook)[a-z0-9-]+\.(example|test)/);
  });
});
