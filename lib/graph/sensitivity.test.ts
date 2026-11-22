import { describe, expect, it } from "vitest";
import { DEFAULT_LINK_CONFIG, mergeConfig, type LinkConfig } from "./config";
import { getPath, newLabelMerges, partitionDistance, perturbWeights, scalePath, thresholdPaths, weightPaths } from "./sensitivity";

/** Small synthetic config: a few type weights (one zero), nested similarity weights and thresholds. */
function synthetic(): LinkConfig {
  const base = mergeConfig(null);
  return {
    ...base,
    typeWeights: { ...base.typeWeights, url: 1, host: 0.5, persona: 0.1, item: 0, registrar: 0 },
    strongThreshold: 0.8,
    minLinkScore: 0.4,
    creativeFileWeight: 0.9,
    trackerCampaignWeight: 0.7,
    registrationBurstWeight: 0.3,
    campaignRules: { ...base.campaignRules, discountedMinWeight: 0.2, infrastructureMinWeight: 0.5 },
    similarity: {
      imageHamming: 6,
      imageWeight: 0.6,
      imageSemantic: { minCosine: 0.9, weight: 0.5 },
      text: { tfidfThreshold: 0.8, embeddingThreshold: 0.85, weight: 0.4, minChars: 40 },
      dom: { hamming: 3, weight: 0.3 },
      audio: { minSimilarity: 0.9, weight: 0.2 },
      voice: { minCosine: 0.7, weight: 0.2 },
    },
  };
}

describe("weightPaths", () => {
  const paths = weightPaths(synthetic());

  it("finds positive typeWeights and nested similarity weights", () => {
    expect(paths).toContain("typeWeights.url");
    expect(paths).toContain("typeWeights.persona");
    expect(paths).toContain("similarity.imageSemantic.weight");
    expect(paths).toContain("similarity.dom.weight");
    expect(paths).toContain("similarity.imageWeight");
    expect(paths).toContain("creativeFileWeight");
    expect(paths).toContain("trackerCampaignWeight");
    expect(paths).toContain("registrationBurstWeight");
  });

  it("skips zero weights, thresholds and *Min* fields", () => {
    expect(paths).not.toContain("typeWeights.item");
    expect(paths).not.toContain("typeWeights.registrar");
    expect(paths).not.toContain("campaignRules.discountedMinWeight");
    expect(paths).not.toContain("campaignRules.infrastructureMinWeight");
    expect(paths).not.toContain("strongThreshold");
    expect(paths).not.toContain("similarity.text.minChars");
  });

  it("finds a weight added later without any list of names", () => {
    const cfg = synthetic() as LinkConfig & { newKit?: { someWeight: number } };
    cfg.newKit = { someWeight: 0.4 };
    expect(weightPaths(cfg)).toContain("newKit.someWeight");
  });

  it("returns only numeric leaves", () => {
    for (const p of paths) expect(typeof getPath(synthetic(), p)).toBe("number");
  });
});

describe("thresholdPaths", () => {
  it("finds thresholds by name and no weights", () => {
    const t = thresholdPaths(synthetic());
    expect(t).toEqual(
      expect.arrayContaining([
        "strongThreshold",
        "minLinkScore",
        "similarity.imageSemantic.minCosine",
        "similarity.text.tfidfThreshold",
        "similarity.text.embeddingThreshold",
        "similarity.dom.hamming",
        "similarity.audio.minSimilarity",
        "similarity.voice.minCosine",
      ]),
    );
    expect(t).not.toContain("similarity.dom.weight");
    expect(t).not.toContain("typeWeights.url");
  });
});

describe("perturbWeights", () => {
  it("is deterministic for one seed and differs for another", () => {
    const a = perturbWeights(synthetic(), { spread: 0.2, seed: 1 });
    expect(perturbWeights(synthetic(), { spread: 0.2, seed: 1 })).toEqual(a);
    expect(perturbWeights(synthetic(), { spread: 0.2, seed: 2 })).not.toEqual(a);
  });

  it("keeps the configuration identical when spread is 0", () => {
    expect(perturbWeights(synthetic(), { spread: 0, seed: 5 })).toEqual(synthetic());
  });

  it("keeps every weight inside [1-s, 1+s] of the base, clamped to [0, 1]", () => {
    const base = synthetic();
    const out = perturbWeights(base, { spread: 0.3, seed: 7 });
    for (const p of weightPaths(base)) {
      const b = getPath(base, p);
      const v = getPath(out, p);
      expect(v).toBeGreaterThanOrEqual(Math.min(1, b * 0.7) - 1e-12);
      expect(v).toBeLessThanOrEqual(Math.min(1, b * 1.3) + 1e-12);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("clamps to 1 and leaves zero weights at 0", () => {
    const out = perturbWeights(synthetic(), { spread: 0.9, seed: 3 });
    expect(out.typeWeights.url).toBeLessThanOrEqual(1);
    expect(out.typeWeights.item).toBe(0);
    expect(out.typeWeights.registrar).toBe(0);
  });

  it("does not touch thresholds or the base object", () => {
    const base = synthetic();
    const snapshot = structuredClone(base);
    const out = perturbWeights(base, { spread: 0.5, seed: 9 });
    expect(base).toEqual(snapshot);
    for (const p of thresholdPaths(base)) expect(getPath(out, p)).toBe(getPath(base, p));
    expect(out.campaignRules.discountedMinWeight).toBe(base.campaignRules.discountedMinWeight);
    expect(out.lists).toEqual(base.lists);
  });

  it("actually changes weights for a positive spread", () => {
    const out = perturbWeights(synthetic(), { spread: 0.3, seed: 4 });
    expect(out.typeWeights.host).not.toBe(0.5);
  });
});

describe("scalePath", () => {
  it("scales one value and nothing else", () => {
    const out = scalePath(synthetic(), "typeWeights.host", 1.3);
    expect(out.typeWeights.host).toBeCloseTo(0.65);
    expect(out.typeWeights.url).toBe(1);
  });

  it("clamps weights to [0, 1]", () => {
    expect(scalePath(synthetic(), "typeWeights.url", 1.3).typeWeights.url).toBe(1);
  });

  it("does not clamp a threshold to 1 and rounds hamming distances", () => {
    expect(scalePath(synthetic(), "strongThreshold", 1.3).strongThreshold).toBeCloseTo(1.04);
    expect(scalePath(synthetic(), "similarity.dom.hamming", 1.3).similarity.dom.hamming).toBe(4);
  });

  it("throws for a path that is not a number", () => {
    expect(() => scalePath(synthetic(), "typeWeights.nie_ma", 1.1)).toThrow();
  });
});

describe("partitionDistance", () => {
  it("counts pairs that changed together/apart", () => {
    // a: {1,2,3} {4,5}   b: {1,2} {3,4,5}
    // together in a: 12 13 23 45; in b: 12 34 35 45; differ: 13 23 (a only), 34 35 (b only) = 4
    const a = { 1: "x", 2: "x", 3: "x", 4: "y", 5: "y" };
    const b = { 1: "p", 2: "p", 3: "q", 4: "q", 5: "q" };
    expect(partitionDistance(a, b)).toBe(4);
  });

  it("is 0 for the same partition under different cluster names", () => {
    expect(partitionDistance({ 1: "a", 2: "a", 3: "b" }, { 1: "K9", 2: "K9", 3: "K1" })).toBe(0);
  });

  it("counts only items present in both partitions", () => {
    expect(partitionDistance({ 1: "a", 2: "a", 3: "a" }, { 1: "x", 2: "y" })).toBe(1);
  });
});

describe("newLabelMerges", () => {
  const truth = { 1: "A", 2: "A", 3: "B", 4: "C", 5: "N-5" };

  it("lists label pairs newly sharing a cluster", () => {
    const base = { 1: "k1", 2: "k1", 3: "k2", 4: "k3", 5: "k4" };
    const other = { 1: "k1", 2: "k1", 3: "k1", 4: "k3", 5: "k3" };
    expect(newLabelMerges(base, other, truth)).toEqual(["A|B", "C|N-5"]);
  });

  it("ignores pairs of labels already glued in the base", () => {
    const base = { 1: "k1", 3: "k1", 4: "k2" };
    const other = { 1: "k1", 3: "k1", 4: "k2" };
    expect(newLabelMerges(base, other, truth)).toEqual([]);
  });

  it("does not count a split as a merge", () => {
    expect(newLabelMerges({ 1: "k", 2: "k" }, { 1: "k", 2: "z" }, truth)).toEqual([]);
  });
});

describe("default config", () => {
  it("is discovered without errors", () => {
    expect(weightPaths(DEFAULT_LINK_CONFIG).length).toBeGreaterThan(20);
    expect(thresholdPaths(DEFAULT_LINK_CONFIG)).toContain("minLinkScore");
  });
});
