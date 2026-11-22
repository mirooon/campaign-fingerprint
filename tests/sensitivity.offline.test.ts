/**
 * End-to-end run of the weight-sensitivity analysis on a tiny synthetic batch: graph built in the
 * process for the base configuration and for perturbed ones, outputs written, runs reproducible.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeDataset } from "../lib/graph/testkit";
import { runSensitivity } from "../lib/pipeline/sensitivity";
import type { SensitivityResult } from "../lib/pipeline/sensitivityReport";

let dir: string;
let enriched: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "sensitivity-"));
  const ds = makeDataset([
    { id: "a1", url: "https://alpha-zysk.example/start", label: "A", trackers: [{ kind: "ga4", id: "G-AAAA111111" }] },
    { id: "a2", url: "https://alpha-zysk.example/oferta", label: "A", trackers: [{ kind: "ga4", id: "G-AAAA111111" }] },
    { id: "b1", url: "https://beta-energia.example/", label: "B", trackers: [{ kind: "ga4", id: "G-BBBB222222" }] },
    { id: "b2", url: "https://beta-energia.example/promo", label: "B", trackers: [{ kind: "ga4", id: "G-BBBB222222" }] },
    { id: "c1", url: "https://gamma-dom.example/", label: "N-c1" },
  ]);
  enriched = path.join(dir, "enriched.json");
  writeFileSync(enriched, JSON.stringify(ds));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const opts = () => ({ enriched, runs: 3, spreads: [0.2], seed: 1, factors: [0.7, 1.3], thresholdFactors: [0.9, 1.1], text: "none" as const });

describe("runSensitivity", () => {
  it("runs the base, 3 random runs per spread, one-at-a-time and threshold runs, and writes both files", async () => {
    const out = path.join(dir, "out");
    const res = await runSensitivity({ ...opts(), outDir: out });
    expect(res.base.f1).toBeCloseTo(1, 6);
    expect(res.random).toHaveLength(3);
    expect(res.random.map((r) => r.seed)).toEqual([1, 2, 3]);
    expect(res.oneAtATime.length).toBeGreaterThan(20);
    expect(res.thresholds.length).toBeGreaterThan(0);
    expect(res.meta.items).toBe(5);
    const json = JSON.parse(readFileSync(path.join(out, "sensitivity.json"), "utf8")) as SensitivityResult;
    expect(json.random).toHaveLength(3);
    const md = readFileSync(path.join(out, "sensitivity.md"), "utf8");
    expect(md).toContain("## A.");
    expect(md).toContain("## B.");
    expect(md).toContain("## C.");
  });

  it("gives the same numbers for the same seed", async () => {
    const a = await runSensitivity({ ...opts(), outDir: path.join(dir, "o1") });
    const b = await runSensitivity({ ...opts(), outDir: path.join(dir, "o2") });
    expect(b.random).toEqual(a.random);
    expect(b.oneAtATime).toEqual(a.oneAtATime);
  });
});
