import { describe, expect, it } from "vitest";
import { contribution, noisyOr } from "./contribution";

const w = (x: number) => x;

describe("contribution (§6.3)", () => {
  it("segments add up exactly to the noisy-OR score, largest first", () => {
    const c = contribution([0.3, 0.5, 0.2], w);
    expect(c.segments.map((s) => s.weight)).toEqual([0.5, 0.3, 0.2]);
    expect(c.segments[0].length).toBeCloseTo(0.5);
    expect(c.segments[1].length).toBeCloseTo(0.15);
    expect(c.segments[2].length).toBeCloseTo(0.07);
    const sum = c.segments.reduce((s, x) => s + x.length, 0);
    expect(sum).toBeCloseTo(noisyOr([0.3, 0.5, 0.2]), 10);
    expect(c.total).toBeCloseTo(0.72);
    expect(c.rest).toBe(false);
  });
  it("keeps the stored score within tolerance", () => {
    const c = contribution([0.5, 0.5], w, 0.755);
    expect(c.total).toBeCloseTo(0.75);
    expect(c.rest).toBe(false);
  });
  it("adds a rest segment when the stored score is higher", () => {
    const c = contribution([0.5], w, 0.8);
    expect(c.rest).toBe(true);
    expect(c.total).toBe(0.8);
    expect(c.segments.at(-1)?.item).toBeNull();
    expect(c.segments.reduce((s, x) => s + x.length, 0)).toBeCloseTo(0.8);
  });
  it("scales segments down when the stored score is lower", () => {
    const c = contribution([0.5, 0.5], w, 0.5);
    expect(c.total).toBe(0.5);
    expect(c.segments.reduce((s, x) => s + x.length, 0)).toBeCloseTo(0.5);
  });
  it("empty list gives zero", () => {
    expect(contribution([], w).total).toBe(0);
  });
});
