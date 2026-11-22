import { describe, expect, it } from "vitest";
import { withoutVoiceVectors } from "./addToBase";
import type { EnrichedDataset } from "./types";

/** Minimal dataset with a voice vector on two records. */
const data = {
  items: [],
  perItem: {
    a: { itemId: "a", speakerEmbedding: [0.1, 0.2], ocrText: "x" },
    b: { itemId: "b", speakerEmbedding: [0.3, 0.4] },
  },
} as unknown as EnrichedDataset;

describe("withoutVoiceVectors", () => {
  it("drops the raw voice vector of the given records only and leaves the input untouched", () => {
    const out = withoutVoiceVectors(data, new Set(["a"]));
    expect(out.perItem.a.speakerEmbedding).toBeUndefined();
    expect(out.perItem.a.ocrText).toBe("x");
    expect(out.perItem.b.speakerEmbedding).toEqual([0.3, 0.4]);
    expect(data.perItem.a.speakerEmbedding).toEqual([0.1, 0.2]);
  });
});
