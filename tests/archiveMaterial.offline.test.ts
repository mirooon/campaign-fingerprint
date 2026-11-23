/**
 * The archive step in analyze-material (synthetic sample, fake archive sources, no network): a dead
 * address gets a copy with its provenance, no copy gives "insufficient" with the reason, an offline
 * run skips the step with the reason, and a run without the step is unchanged.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ArchivedCopy, ArchiveSource } from "../lib/osint/archive";
import { analyzeMaterial, type MaterialContext } from "../lib/pipeline/analyzeMaterial";
import { runSample, SAMPLE } from "./sampleRun";

let root: string;
let run: Awaited<ReturnType<typeof runSample>>;
const DEAD = "https://martwa-oferta.example/promo/";

beforeAll(async () => {
  run = await runSample();
  root = mkdtempSync(path.join(os.tmpdir(), "archive-material-"));
  const data = path.join(root, "run");
  mkdirSync(data);
  writeFileSync(path.join(data, "enriched.json"), JSON.stringify(run.ds));
  writeFileSync(path.join(data, "campaigns.json"), JSON.stringify(run.campaigns));
  writeFileSync(path.join(data, "graph.json"), JSON.stringify(run.graph));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const ctx = (work: string, archive?: MaterialContext["archive"]): MaterialContext => ({
  dataDir: path.join(root, "run"),
  workDir: path.join(root, work),
  fixtures: path.join(SAMPLE, "fixtures"),
  config: run.config,
  personas: null,
  media: { ocr: false },
  ...(archive !== undefined ? { archive } : {}),
});

const copy: ArchivedCopy = {
  source: "wayback",
  url: DEAD,
  sourceUrl: `https://web.archive.org/web/20261018020257/${DEAD}`,
  capturedAt: "2026-10-18T02:02:57.000Z",
  fetchedAt: "2026-11-22T10:00:00.000Z",
  html: '<html><head><title>Oferta archiwalna</title></head><body><form action="https://formularz.example/send.php"></form></body></html>',
};
const source = (copies: ArchivedCopy[]): ArchiveSource => ({ name: "wayback", available: async () => ({ ok: true }), lookup: async () => copies });
const step = (res: Awaited<ReturnType<typeof analyzeMaterial>>) => res.steps.find((s) => s.step === "archive");

describe("analyzeMaterial: archive step", () => {
  it("adds a copy of a dead address to the material with its provenance, and reports the step", async () => {
    const res = await analyzeMaterial({ url: DEAD }, ctx("a1", { sources: [source([copy])] }));
    const [it] = res.items;
    expect(it.bodySource).toBe("wayback");
    expect(it.archive).toMatchObject({ status: "used", detail: "copy from wayback of 2026-10-18", copy: { source: "wayback", sourceUrl: copy.sourceUrl, capturedAt: copy.capturedAt, used: true } });
    expect(step(res)).toMatchObject({ status: "done", detail: "copy from wayback of 2026-10-18" });
    expect(it.verdict).not.toBe("insufficient");
  });

  it("says insufficient, with the reason, when neither the page nor a copy exists", async () => {
    const res = await analyzeMaterial({ url: DEAD }, ctx("a2", { sources: [source([])] }));
    const [it] = res.items;
    expect(it.verdict).toBe("insufficient");
    expect(it.verdictText).toMatch(/no page and no archived copy/);
    expect(it.missing?.join(" ")).toMatch(/archive/);
    expect(it.bodySource).toBeUndefined();
    expect(step(res)).toMatchObject({ status: "skipped", detail: "no archived copy (wayback)" });
  });

  it("skips the step with the reason in an offline run and leaves the verdict as without it", async () => {
    const plain = await analyzeMaterial({ url: DEAD }, ctx("a3"));
    const off = await analyzeMaterial({ url: DEAD }, ctx("a4", { sources: [], skipReason: "tryb offline: bez zapytań sieciowych" }));
    expect(step(off)).toMatchObject({ status: "skipped", detail: "tryb offline: bez zapytań sieciowych" });
    expect(off.items[0].verdict).toBe(plain.items[0].verdict);
    expect(off.items[0].verdictText).toBe(plain.items[0].verdictText);
  });

  it("leaves a run without the step unchanged: no archive step and no archive fields", async () => {
    const res = await analyzeMaterial({ url: DEAD }, ctx("a5"));
    expect(step(res)).toBeUndefined();
    expect(res.items[0].archive).toBeUndefined();
    expect(res.items[0].bodySource).toBeUndefined();
  });
});
