/**
 * Evidence pack export for the GUI/API (POST /api/evidence): a ZIP for a known campaign of the run
 * and for a campaign of new materials (N1) of an analysis job; an unknown id is a message, not an exception.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeMaterial, type MaterialResult } from "../lib/pipeline/analyzeMaterial";
import { compileWatchlist, loadWatchlist } from "../lib/text/persona";
import { buildEvidenceZip } from "../lib/viewer/evidenceExport";
import { runSample, SAMPLE } from "./sampleRun";

let root: string;
let run: Awaited<ReturnType<typeof runSample>>;
let res: MaterialResult;

const page = (url: string, title: string, body: string) =>
  `<!-- saved from url=(${String(url.length).padStart(4, "0")})${url} -->\n<html><head><title>${title}</title></head><body>${body}</body></html>`;

function caseWith(name: string, html: string): string {
  const dir = path.join(root, "sprawy", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "Strona.html"), html);
  return dir;
}

beforeAll(async () => {
  run = await runSample();
  root = mkdtempSync(path.join(os.tmpdir(), "evidence-export-"));
  const data = path.join(root, "run");
  mkdirSync(data);
  writeFileSync(path.join(data, "enriched.json"), JSON.stringify(run.ds));
  writeFileSync(path.join(data, "campaigns.json"), JSON.stringify(run.campaigns));
  writeFileSync(path.join(data, "graph.json"), JSON.stringify(run.graph));
  res = await analyzeMaterial(
    {
      caseDirs: [
        caseWith("lejek-1", page("https://nowy-lejek.example/krok-1", "Krok pierwszy", "<form action='/zapis'><input name='imie'></form><p>Zapisz się na webinar o oszczędzaniu.</p>")),
        caseWith("lejek-2", page("https://nowy-lejek.example/krok-2", "Krok drugi", "<p>Dziękujemy, doradca oddzwoni w ciągu godziny.</p>")),
      ],
    },
    {
      dataDir: data,
      workDir: path.join(root, "job", "praca"),
      fixtures: path.join(SAMPLE, "fixtures"),
      config: run.config,
      personas: compileWatchlist(loadWatchlist(path.join(SAMPLE, "personas.json"))),
      media: { ocr: false },
    },
  );
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

const names = (zip: Uint8Array) => Object.keys(unzipSync(zip)).sort();

describe("buildEvidenceZip", () => {
  it("zips the pack of a known campaign of the run", () => {
    const out = buildEvidenceZip({ campaignId: run.campaigns.assignments["c1-01"], dataDir: path.join(root, "run"), root: process.cwd() });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(names(out.zip)).toEqual(expect.arrayContaining(["evidence.json", "cert-domains.txt", "dsa-art16-notice.md", "manifest.sha256"]));
    expect(out.fileName).toMatch(/^paczka-dowodow-.*\.zip$/);
  });

  it("zips the pack of a campaign of new materials (N1) of the job", () => {
    expect(res.newCampaigns?.[0]?.id).toBe("N1");
    const out = buildEvidenceZip({ campaignId: "N1", dataDir: path.join(root, "run"), jobWorkDir: path.join(root, "job", "praca"), root: process.cwd() });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const files = unzipSync(out.zip);
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["evidence.json", "manifest.sha256", "cert-domains.txt"]));
    expect(strFromU8(files["cert-domains.txt"])).toContain("nowy-lejek.example");
    expect(strFromU8(files["manifest.sha256"])).toMatch(/^[0-9a-f]{64} {2}\S+/m);
  });

  it("answers an unknown id with a message, not an exception", () => {
    const out = buildEvidenceZip({ campaignId: "K999", dataDir: path.join(root, "run"), root: process.cwd() });
    expect(out).toMatchObject({ ok: false, status: 404 });
    if (!out.ok) expect(out.error).toMatch(/K999/);
    const noJob = buildEvidenceZip({ campaignId: "N1", dataDir: path.join(root, "run"), root: process.cwd() });
    expect(noJob).toMatchObject({ ok: false, status: 404 });
  });
});
