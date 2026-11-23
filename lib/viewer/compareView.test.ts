import { describe, expect, it } from "vitest";
import type { PairEvidence } from "@/lib/graph/model";
import { familyShares, markShared } from "./compareView";

function ev(over: Partial<PairEvidence>): PairEvidence {
  return { kind: "pivot", pivot: null, pivotType: null, edgeType: null, weight: 0.5, strong: false, discounted: false, evidence: "", pathA: [], pathB: [], ...over };
}

describe("familyShares", () => {
  it("the family shares of the score add up to 100%, and discounted evidence does not count", () => {
    const shares = familyShares([
      ev({ pivotType: "tracker", weight: 0.6 }),
      ev({ kind: "similarity", edgeType: "similar_text", weight: 0.6 }),
      ev({ pivotType: "domain", weight: 0.9, discounted: true }),
    ]);
    expect(shares.map((s) => s.family).sort()).toEqual(["content", "infra"]);
    expect(shares.reduce((n, s) => n + s.percent, 0)).toBe(100);
  });
  it("an unknown kind and no evidence give no shares", () => {
    expect(familyShares([])).toEqual([]);
    expect(familyShares([ev({ pivotType: null, edgeType: null })])).toEqual([]);
  });
  it("the family with stronger evidence gets a larger percentage", () => {
    const shares = familyShares([ev({ pivotType: "tracker", weight: 0.8 }), ev({ kind: "similarity", edgeType: "similar_image", weight: 0.2 })]);
    const by = Object.fromEntries(shares.map((s) => [s.family, s.percent]));
    expect(by.infra).toBeGreaterThan(by.look);
  });
});

describe("markShared", () => {
  it("marks a shared passage of at least four words in both texts", () => {
    const { a, b } = markShared("Gwiazda ujawnia sposób na szybki zarobek dla każdego", "Wywiad: ujawnia sposób na szybki zarobek, mówi ekspert");
    expect(a.filter((s) => s.shared).map((s) => s.text.trim())).toEqual(["ujawnia sposób na szybki zarobek"]);
    expect(b.filter((s) => s.shared).map((s) => s.text.trim().replace(/,$/, ""))).toEqual(["ujawnia sposób na szybki zarobek"]);
    expect(a.map((s) => s.text).join("")).toBe("Gwiazda ujawnia sposób na szybki zarobek dla każdego");
  });
  it("shorter matches and texts without shared passages are not marked", () => {
    const { a, b } = markShared("kup teraz tanio", "kup teraz drogo");
    expect([...a, ...b].some((s) => s.shared)).toBe(false);
  });
  it("ignores letter case and punctuation in the comparison", () => {
    const { b } = markShared("Zarobek, bez ryzyka. Dla każdego!", "ZAROBEK bez ryzyka dla każdego");
    expect(b.filter((s) => s.shared)).toHaveLength(1);
  });
  it("an empty text gives an empty result", () => {
    expect(markShared("", "coś tam jeszcze jest")).toEqual({ a: [], b: [{ text: "coś tam jeszcze jest", shared: false }] });
  });
});
