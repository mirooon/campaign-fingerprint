import { describe, expect, it } from "vitest";
import { formatSensitivityMarkdown, impactRows, summarizeRandom, type RandomRun, type RunMetrics, type ShiftRun } from "./sensitivityReport";

const m = (f1: number, over: Partial<RunMetrics> = {}): RunMetrics => ({ precision: f1, recall: f1, f1, bcubedF1: f1, ari: f1, clusters: 5, ...over });

const random = (spread: number, seed: number, f1: number, distance = 0, newMerges: string[] = []): RandomRun => ({
  spread,
  seed,
  metrics: m(f1),
  distance,
  newMerges,
  identical: distance === 0,
});

describe("summarizeRandom", () => {
  it("gives min / median / max per spread, in ascending spread order", () => {
    const rows = summarizeRandom([random(0.2, 1, 0.9, 2), random(0.1, 1, 1), random(0.2, 2, 0.7, 6, ["A|B"]), random(0.2, 3, 0.8, 0), random(0.1, 2, 0.8, 1)]);
    expect(rows.map((r) => r.spread)).toEqual([0.1, 0.2]);
    expect(rows[1].f1).toEqual({ min: 0.7, median: 0.8, max: 0.9 });
    expect(rows[1].identical).toBe(1);
    expect(rows[1].maxDistance).toBe(6);
    expect(rows[1].runsWithNewMerge).toBe(1);
    expect(rows[1].runs).toBe(3);
    expect(rows[0].f1.median).toBeCloseTo(0.9);
  });
});

describe("impactRows", () => {
  const shift = (path: string, factor: number, distance: number, deltaF1: number): ShiftRun => ({ path, factor, from: 0.5, to: 0.5 * factor, metrics: m(0.9), deltaF1, distance, newMerges: [] });

  it("ranks by changed pairs and collects weights without any effect", () => {
    const { ranked, noImpact } = impactRows([
      shift("a", 0.7, 0, 0),
      shift("a", 1.3, 0, 0),
      shift("b", 0.7, 2, -0.01),
      shift("b", 1.3, 0, 0),
      shift("c", 0.7, 10, -0.2),
      shift("c", 1.3, 10, 0.05),
    ]);
    expect(ranked.map((r) => `${r.path}@${r.factor}`)).toEqual(["c@0.7", "c@1.3", "b@0.7"]);
    expect(noImpact).toEqual(["a"]);
  });

  it("breaks ties by the size of the F1 change", () => {
    const { ranked } = impactRows([shift("x", 0.7, 4, 0.01), shift("y", 0.7, 4, -0.05)]);
    expect(ranked.map((r) => r.path)).toEqual(["y", "x"]);
  });
});

describe("formatSensitivityMarkdown", () => {
  it("has the header and tables A, B, C", () => {
    const md = formatSensitivityMarkdown({
      meta: { commit: "abc1234", date: "2026-01-01T00:00:00.000Z", items: 12, labeled: 12, seconds: 3.2, seed: 1, runs: 2, spreads: [0.1], factors: [0.7, 1.3], thresholdFactors: [0.9] },
      base: m(0.95),
      random: [random(0.1, 1, 0.95), random(0.1, 2, 0.9, 2)],
      oneAtATime: [{ path: "typeWeights.url", factor: 0.7, from: 1, to: 0.7, metrics: m(0.9), deltaF1: -0.05, distance: 3, newMerges: [] }],
      thresholds: [],
    });
    expect(md).toContain("abc1234");
    expect(md).toContain("## A.");
    expect(md).toContain("## B.");
    expect(md).toContain("## C.");
    expect(md).toContain("typeWeights.url");
  });
});
