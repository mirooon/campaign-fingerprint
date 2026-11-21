/**
 * One synthetic case in four compositions (full, without HAR, screenshots only, video only): each goes through
 * the case import and the material analysis without an exception, and `missing` names what the composition lacks.
 * No network; the existing run is the synthetic sample.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeMaterial, type MaterialResult } from "../lib/pipeline/analyzeMaterial";
import { importCases } from "../lib/pipeline/caseImport";
import { compileWatchlist, loadWatchlist } from "../lib/text/persona";
import { runSample, SAMPLE } from "./sampleRun";

const HAR_MISSING = "plik HAR z wizyty na stronie";
const LANDING = "https://sklad-sprawy.example/oferta";
let root: string;
let run: Awaited<ReturnType<typeof runSample>>;
let shot: Buffer;

/** Saved page ("save as" in a browser) with the address in the comment the importer reads. */
const savedPage = `<!-- saved from url=(${String(LANDING.length).padStart(4, "0")})${LANDING} -->\n<html><head><title>Oferta</title></head><body><p>Lokata na 9% w skali roku.</p></body></html>`;

/** HAR with the landing page as its document request. */
const har = JSON.stringify({
  log: {
    entries: [
      {
        _resourceType: "document",
        startedDateTime: "2026-01-15T09:10:01.000Z",
        serverIPAddress: "192.0.2.10",
        request: { method: "GET", url: LANDING },
        response: { status: 200, headers: [{ name: "Content-Type", value: "text/html" }], content: { mimeType: "text/html", text: savedPage } },
      },
    ],
  },
});

/** Case folder with the given files (name → bytes). */
function caseWith(name: string, files: Record<string, string | Buffer>): string {
  const dir = path.join(root, "sprawy", name);
  mkdirSync(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) writeFileSync(path.join(dir, f), body);
  return dir;
}

/** The four compositions of one case. */
function compositions(): Record<string, Record<string, string | Buffer>> {
  return {
    pelna: { "Oferta.html": savedPage, "sklad-sprawy.example.har": har, "Zrzut ekranu 2026-01-15 101500.png": shot },
    "bez-har": { "Oferta.html": savedPage, "Zrzut ekranu 2026-01-15 101500.png": shot },
    "same-zrzuty": { "Zrzut ekranu 2026-01-15 101500.png": shot },
    // the bytes are never decoded here (no ASR, CLIP or audio): only the extension makes it a video
    "samo-wideo": { "nagranie.mp4": Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 29) % 256)) },
  };
}

/** Analysis of one composition on its own, against the sample run. */
async function analyse(name: string): Promise<MaterialResult> {
  return analyzeMaterial(
    { caseDir: path.join(root, "sprawy", name) },
    {
      dataDir: path.join(root, "run"),
      workDir: path.join(root, `praca-${name}`),
      fixtures: path.join(SAMPLE, "fixtures"),
      config: run.config,
      personas: compileWatchlist(loadWatchlist(path.join(SAMPLE, "personas.json"))),
      media: { ocr: false },
    },
  );
}

beforeAll(async () => {
  run = await runSample();
  root = mkdtempSync(path.join(os.tmpdir(), "sklad-sprawy-"));
  const data = path.join(root, "run");
  mkdirSync(data);
  writeFileSync(path.join(data, "enriched.json"), JSON.stringify(run.ds));
  writeFileSync(path.join(data, "campaigns.json"), JSON.stringify(run.campaigns));
  writeFileSync(path.join(data, "graph.json"), JSON.stringify(run.graph));
  // a picture of noise: no sample creative resembles it
  const noise = Buffer.from(Array.from({ length: 64 * 64 * 3 }, (_, i) => (i * 97 + (i >> 3) * 31) % 256));
  shot = await sharp(noise, { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
  for (const [name, files] of Object.entries(compositions())) caseWith(name, files);
}, 120_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("case composition", () => {
  it("imports every composition as one record, without an exception", async () => {
    const res = await importCases({ casesDir: path.join(root, "sprawy"), outDir: path.join(root, "import") });
    expect(res.skipped).toEqual([]);
    expect(res.cases.map((c) => c.caseId).sort()).toEqual(["bez-har", "pelna", "same-zrzuty", "samo-wideo"]);
  });

  it("full case: page, HAR and screenshot leave nothing to add about the files", async () => {
    const [it] = (await analyse("pelna")).items;
    expect(it.missing ?? []).not.toContain(HAR_MISSING);
    expect(it.missing ?? []).not.toContain("zrzut ekranu reklamy");
  }, 60_000);

  it("case without a HAR: asks for it, although the page was saved", async () => {
    const [it] = (await analyse("bez-har")).items;
    expect(it.verdict).toBe("new_campaign");
    expect(it.missing).toContain(HAR_MISSING);
  }, 60_000);

  it("screenshots only: not enough to compare; asks for a link and the HAR, not for a screenshot", async () => {
    const [it] = (await analyse("same-zrzuty")).items;
    expect(it.verdict).toBe("insufficient");
    expect(it.missing).toEqual(expect.arrayContaining(["link do reklamy albo strony docelowej", HAR_MISSING]));
    expect(it.missing).not.toContain("zrzut ekranu reklamy");
  }, 60_000);

  it("a link and a text, the page not captured: asks for the HAR, although the address is known", async () => {
    const res = await analyzeMaterial(
      { url: "https://niezapisana.example/oferta", text: "Lokata na dziewięć procent w skali roku, zapisz się dziś." },
      { dataDir: path.join(root, "run"), workDir: path.join(root, "praca-link"), fixtures: path.join(SAMPLE, "fixtures"), config: run.config, media: { ocr: false } },
    );
    const [it] = res.items;
    expect(it.verdict).toBe("new_campaign");
    expect(it.missing).toEqual([HAR_MISSING, "zrzut ekranu reklamy"]);
  }, 60_000);

  it("a case of phone photos in HEIC: skipped with the format named, the other cases of the batch go on", async () => {
    caseWith("zdjecia-heic", { "IMG_0001.HEIC": Buffer.from("nie-obraz") });
    const ctx = { dataDir: path.join(root, "run"), workDir: path.join(root, "praca-heic"), fixtures: path.join(SAMPLE, "fixtures"), config: run.config, media: { ocr: false } };
    const res = await analyzeMaterial({ caseDirs: [path.join(root, "sprawy", "zdjecia-heic"), path.join(root, "sprawy", "bez-har")] }, ctx);
    expect(res.items.map((i) => i.id)).toEqual(["bez-har"]);
    expect(res.steps.find((s) => s.caseId === "zdjecia-heic" && s.step === "import")).toMatchObject({ status: "skipped", detail: expect.stringContaining("HEIC") });
    await expect(analyzeMaterial({ caseDir: path.join(root, "sprawy", "zdjecia-heic") }, { ...ctx, workDir: path.join(root, "praca-heic-1") })).rejects.toThrow(/HEIC/);
  }, 60_000);

  it("video only: not enough to compare; asks for a link and the HAR, not for a screenshot", async () => {
    const res = await analyse("samo-wideo");
    const [it] = res.items;
    expect(it.verdict).toBe("insufficient");
    expect(it.missing).toEqual(expect.arrayContaining(["link do reklamy albo strony docelowej", HAR_MISSING]));
    expect(it.missing).not.toContain("zrzut ekranu reklamy");
    expect(res.steps.find((s) => s.step === "asr")).toMatchObject({ status: "skipped" });
  }, 60_000);
});
