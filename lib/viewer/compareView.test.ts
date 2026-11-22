import { describe, expect, it } from "vitest";
import type { PairEvidence } from "@/lib/graph/model";
import { familyShares, markShared } from "./compareView";

function ev(over: Partial<PairEvidence>): PairEvidence {
  return { kind: "pivot", pivot: null, pivotType: null, edgeType: null, weight: 0.5, strong: false, discounted: false, evidence: "", pathA: [], pathB: [], ...over };
}

describe("familyShares", () => {
  it("udział rodzin w wyniku sumuje się do 100%, a pominięte przesłanki nie liczą się", () => {
    const shares = familyShares([
      ev({ pivotType: "tracker", weight: 0.6 }),
      ev({ kind: "similarity", edgeType: "similar_text", weight: 0.6 }),
      ev({ pivotType: "domain", weight: 0.9, discounted: true }),
    ]);
    expect(shares.map((s) => s.family).sort()).toEqual(["content", "infra"]);
    expect(shares.reduce((n, s) => n + s.percent, 0)).toBe(100);
  });
  it("nieznany rodzaj i brak przesłanek nie dają udziałów", () => {
    expect(familyShares([])).toEqual([]);
    expect(familyShares([ev({ pivotType: null, edgeType: null })])).toEqual([]);
  });
  it("rodzina z mocniejszą przesłanką dostaje większy procent", () => {
    const shares = familyShares([ev({ pivotType: "tracker", weight: 0.8 }), ev({ kind: "similarity", edgeType: "similar_image", weight: 0.2 })]);
    const by = Object.fromEntries(shares.map((s) => [s.family, s.percent]));
    expect(by.infra).toBeGreaterThan(by.look);
  });
});

describe("markShared", () => {
  it("zaznacza wspólny fragment co najmniej czterech słów w obu tekstach", () => {
    const { a, b } = markShared("Gwiazda ujawnia sposób na szybki zarobek dla każdego", "Wywiad: ujawnia sposób na szybki zarobek, mówi ekspert");
    expect(a.filter((s) => s.shared).map((s) => s.text.trim())).toEqual(["ujawnia sposób na szybki zarobek"]);
    expect(b.filter((s) => s.shared).map((s) => s.text.trim().replace(/,$/, ""))).toEqual(["ujawnia sposób na szybki zarobek"]);
    expect(a.map((s) => s.text).join("")).toBe("Gwiazda ujawnia sposób na szybki zarobek dla każdego");
  });
  it("krótsze zbieżności i teksty bez wspólnych fragmentów nie są zaznaczane", () => {
    const { a, b } = markShared("kup teraz tanio", "kup teraz drogo");
    expect([...a, ...b].some((s) => s.shared)).toBe(false);
  });
  it("pomija wielkość liter i znaki interpunkcyjne przy porównaniu", () => {
    const { b } = markShared("Zarobek, bez ryzyka. Dla każdego!", "ZAROBEK bez ryzyka dla każdego");
    expect(b.filter((s) => s.shared)).toHaveLength(1);
  });
  it("pusty tekst daje pusty wynik", () => {
    expect(markShared("", "coś tam jeszcze jest")).toEqual({ a: [], b: [{ text: "coś tam jeszcze jest", shared: false }] });
  });
});
