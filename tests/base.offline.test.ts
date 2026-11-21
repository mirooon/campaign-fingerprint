/**
 * `bun run base` on three synthetic cases made from the sample, offline: a base with at least one
 * campaign, a status for every step (skipped steps carry a reason), the built-in weights unless
 * a config is given explicitly.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CampaignsFile } from "../lib/graph/model";
import { applyLabels, runBase, type BaseResult, type MediaAvailability } from "../lib/pipeline/base";
import { writeSampleCases } from "../lib/pipeline/sampleCases";
import { SAMPLE } from "./sampleRun";

let root: string;
let cases: string;
let res: BaseResult;
const quiet = () => undefined;
/** No media tools or models: keeps the test offline (no model download) and shows the skip reasons. */
const noTools = async (): Promise<MediaAvailability> => {
  const off = { available: false, reason: "wyłączone w teście" };
  return { ocr: off, asr: off, audio: off, clip: off };
};

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "base-"));
  cases = path.join(root, "sprawy");
  // two ads of one campaign (same tracker host and page) and one of another
  writeSampleCases(SAMPLE, cases, [
    { name: "a1", itemId: "c1-01" },
    { name: "a2", itemId: "c1-02" },
    { name: "b1", itemId: "c2-01" },
  ]);
  res = await runBase({ casesDir: cases, outDir: path.join(root, "baza"), offline: true, detect: noTools, log: quiet });
}, 120_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("runBase", () => {
  it("writes the files analyze-material --data needs, with at least one campaign", () => {
    for (const f of ["graph.json", "campaigns.json", "enriched.json", "input.json", "items.json", "base.json"]) expect(existsSync(path.join(root, "baza", f)), f).toBe(true);
    const campaigns = JSON.parse(readFileSync(path.join(root, "baza", "campaigns.json"), "utf8")) as CampaignsFile;
    expect(campaigns.campaigns.length).toBeGreaterThanOrEqual(1);
    expect(campaigns.assignments.a1).toBe(campaigns.assignments.a2);
    expect(campaigns.assignments.b1).not.toBe(campaigns.assignments.a1);
    expect(res.cases).toBe(3);
  });

  it("reports every step, and every skipped step with a reason", () => {
    expect(res.steps.map((s) => s.step)).toEqual(["import-cases", "lookups", "ingest", "enrich", "ocr", "asr", "audio", "clip", "build-graph"]);
    const lookups = res.steps.find((s) => s.step === "lookups")!;
    expect(lookups.status).toBe("skipped");
    expect(lookups.reason).toMatch(/offline/);
    expect(res.steps.find((s) => s.step === "clip")).toMatchObject({ status: "skipped", reason: "wyłączone w teście" });
    for (const s of res.steps) expect(s.status === "skipped" ? !!s.reason : true, s.step).toBe(true);
    const saved = JSON.parse(readFileSync(path.join(root, "baza", "base.json"), "utf8")) as BaseResult;
    expect(saved.steps).toEqual(res.steps);
  });

  it("uses the built-in weights, not the sample's, when no --config is given", () => {
    expect(res.configFile).toBeNull();
    expect(existsSync(path.join(root, "baza", "linking.json"))).toBe(false);
  });

  it("copies an explicit --config next to the base, so the analysis uses the same weights", async () => {
    const cfg = path.join(root, "wlasne.json");
    writeFileSync(cfg, JSON.stringify({}));
    const out = path.join(root, "baza2");
    const r = await runBase({ casesDir: cases, outDir: out, offline: true, config: cfg, detect: noTools, log: quiet });
    expect(r.configFile).toBe(cfg);
    expect(existsSync(path.join(out, "linking.json"))).toBe(true);
  }, 120_000);
});

describe("applyLabels", () => {
  it("adds ref_label to the records of the listed cases and leaves the others unlabeled", () => {
    const rows = [{ id: "a1" }, { id: "a2" }, { id: "b1" }];
    const out = applyLabels(rows, { K1: ["a1", "a2"], _uwaga: ["b1"] });
    expect(out.map((r) => r.ref_label)).toEqual(["K1", "K1", undefined]);
  });
});
