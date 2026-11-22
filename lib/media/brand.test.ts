/**
 * Impersonated brand on a creative by CLIP zero-shot (B-199), with synthetic vectors in place of the model:
 * an attribute of the material, never a link. Fictional brands only.
 */
import { describe, expect, it } from "vitest";
import { matchBrand, type BrandVectors } from "./brand";

const unit = (v: number[]) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};
const vectors: BrandVectors = {
  brands: [
    { id: "kurier-testowy", name: "Kurier Testowy", kind: "media", vectors: [unit([1, 0, 0, 0])] },
    { id: "bank-przykladowy", name: "Bank Przykładowy", kind: "bank", vectors: [unit([0, 1, 0, 0])] },
  ],
  neutral: [unit([0, 0, 1, 0]), unit([0, 0, 0, 1])],
};

describe("brand on a creative (CLIP zero-shot)", () => {
  it("names the brand whose prompts the creative is closest to", () => {
    const hit = matchBrand(unit([0.9, 0.1, 0.1, 0.1]), vectors);
    expect(hit?.id).toBe("kurier-testowy");
    expect(hit?.kind).toBe("media");
    expect(hit!.probability).toBeGreaterThan(0.5);
  });

  it("names nothing for a creative closest to a neutral prompt (a person, a post)", () => {
    expect(matchBrand(unit([0.1, 0.1, 0.9, 0.2]), vectors)).toBeNull();
  });

  it("names nothing when two brands are equally close", () => {
    expect(matchBrand(unit([1, 1, 0.2, 0.2]), vectors)).toBeNull();
  });
});
