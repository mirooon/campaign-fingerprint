import { describe, expect, it } from "vitest";
import { evaluateClustering } from "./eval";

describe("evaluateClustering (hand-computed)", () => {
  // truth: {a,b,c} {d,e}   predicted: {a,b} {c,d,e}
  const truth = { a: "T1", b: "T1", c: "T1", d: "T2", e: "T2" };
  const pred = { a: "P1", b: "P1", c: "P2", d: "P2", e: "P2" };

  it("pairwise P/R/F1", () => {
    // gold pairs ab ac bc de; predicted pairs ab cd ce de; TP = ab, de
    const r = evaluateClustering(pred, truth);
    expect(r.pairwise).toMatchObject({ tp: 2, fp: 2, fn: 2 });
    expect(r.pairwise.precision).toBeCloseTo(0.5, 10);
    expect(r.pairwise.recall).toBeCloseTo(0.5, 10);
    expect(r.pairwise.f1).toBeCloseTo(0.5, 10);
  });

  it("B-cubed", () => {
    // per item P: a 1, b 1, c 1/3, d 2/3, e 2/3 -> 11/15 ; R: a 2/3, b 2/3, c 1/3, d 1, e 1 -> 11/15
    const r = evaluateClustering(pred, truth);
    expect(r.bcubed.precision).toBeCloseTo(11 / 15, 10);
    expect(r.bcubed.recall).toBeCloseTo(11 / 15, 10);
    expect(r.bcubed.f1).toBeCloseTo(11 / 15, 10);
  });

  it("ARI", () => {
    // sum C(nij,2)=2, sum C(ai,2)=4, sum C(bj,2)=4, C(5,2)=10 -> (2-1.6)/(4-1.6) = 1/6
    expect(evaluateClustering(pred, truth).ari).toBeCloseTo(1 / 6, 10);
  });
});

describe("evaluateClustering edge cases", () => {
  it("perfect clustering scores 1 everywhere (labels may differ)", () => {
    const r = evaluateClustering({ a: "x", b: "x", c: "y" }, { a: "1", b: "1", c: "2" });
    expect(r.pairwise.f1).toBe(1);
    expect(r.bcubed.f1).toBe(1);
    expect(r.ari).toBe(1);
  });

  it("everything merged into one cluster", () => {
    // truth {a,b} {c,d}; pred {a,b,c,d}: TP=2, FP=4, FN=0
    const r = evaluateClustering({ a: "x", b: "x", c: "x", d: "x" }, { a: "1", b: "1", c: "2", d: "2" });
    expect(r.pairwise).toMatchObject({ tp: 2, fp: 4, fn: 0, recall: 1 });
    expect(r.pairwise.precision).toBeCloseTo(1 / 3, 10);
    expect(r.bcubed.precision).toBeCloseTo(0.5, 10);
    expect(r.bcubed.recall).toBe(1);
    // ARI: index=2, expected=(6*2)/6=2, max=(6+2)/2=4 -> (2-2)/(4-2) = 0
    expect(r.ari).toBeCloseTo(0, 10);
  });

  it("all singletons on both sides", () => {
    const r = evaluateClustering({ a: "1", b: "2" }, { a: "x", b: "y" });
    expect(r.pairwise.f1).toBe(1);
    expect(r.ari).toBe(1);
  });

  it("ignores items missing from either side", () => {
    const r = evaluateClustering({ a: "1", b: "1", z: "9" }, { a: "x", b: "x", q: "y" });
    expect(r.n).toBe(2);
    expect(r.pairwise.f1).toBe(1);
  });
});
