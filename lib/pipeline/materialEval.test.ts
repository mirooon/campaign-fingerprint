import { describe, expect, it } from "vitest";
import { evaluateMaterialRows, materialClusters, truthFromLabels } from "./materialEval";

/** One row of the batch CSV (only the columns the evaluation reads). */
function row(material_id: string, verdict: string, extra: Partial<Record<string, string>> = {}): Record<string, string> {
  return { material_id, case: material_id, verdict, campaign_id: "", new_campaign_id: "", duplicate_of: "", ...extra };
}

// truth: X = {m1, m2, m3}, Y = {m4, m5}, Z = {m6}
// predicted: K01 = {m1, m2} (known campaign), N1 = {m3, m4, m5} (m5 a duplicate of m4), {m6} alone
const ROWS = [
  row("m1", "known_campaign", { campaign_id: "K01" }),
  row("m2", "known_campaign", { campaign_id: "K01" }),
  row("m3", "new_campaign", { new_campaign_id: "N1" }),
  row("m4", "new_campaign", { new_campaign_id: "N1" }),
  row("m5", "duplicate", { case: "sprawa-5", duplicate_of: "m4" }),
  row("m6", "similar_campaigns", { similar_campaigns: "K01" }),
];
const LABELS = { X: ["m1", "m2", "m3"], Y: ["m4", "sprawa-5"], Z: ["m6"] };

describe("materialClusters", () => {
  it("puts a record in its campaign, its new campaign, the cluster of the record it duplicates, or alone", () => {
    expect(materialClusters(ROWS)).toEqual({ m1: "K01", m2: "K01", m3: "N1", m4: "N1", m5: "N1", m6: "material:m6" });
  });
});

describe("truthFromLabels", () => {
  it("reads both label → cases and case → label files", () => {
    expect(truthFromLabels(LABELS)).toEqual({ m1: "X", m2: "X", m3: "X", m4: "Y", "sprawa-5": "Y", m6: "Z" });
    expect(truthFromLabels({ m1: "X", m4: "Y" })).toEqual({ m1: "X", m4: "Y" });
  });

  it("rejects a file of another shape", () => {
    expect(() => truthFromLabels([1, 2])).toThrow();
    expect(() => truthFromLabels({ m1: 3 })).toThrow();
  });
});

describe("evaluateMaterialRows (hand-computed)", () => {
  const { result, unlabeled } = evaluateMaterialRows(ROWS, truthFromLabels(LABELS));

  it("matches a record to its label by case, then by material id", () => {
    expect(result.n).toBe(6);
    expect(unlabeled).toEqual([]);
  });

  it("pairwise: predicted pairs m1m2 m3m4 m3m5 m4m5, true pairs m1m2 m1m3 m2m3 m4m5 → P = R = F1 = 0.5", () => {
    expect(result.pairwise).toMatchObject({ tp: 2, fp: 2, fn: 2 });
    expect(result.pairwise.f1).toBeCloseTo(0.5, 10);
  });

  it("B-cubed: P = (1 + 1 + 1/3 + 2/3 + 2/3 + 1) / 6, R = (2/3 + 2/3 + 1/3 + 1 + 1 + 1) / 6", () => {
    expect(result.bcubed.precision).toBeCloseTo(14 / 18, 10);
    expect(result.bcubed.recall).toBeCloseTo(14 / 18, 10);
    expect(result.bcubed.f1).toBeCloseTo(14 / 18, 10);
  });

  it("lists records without a label and leaves them out of the score", () => {
    const r = evaluateMaterialRows([...ROWS, row("m7", "new_campaign")], truthFromLabels(LABELS));
    expect(r.unlabeled).toEqual(["m7"]);
    expect(r.result.n).toBe(6);
  });
});
