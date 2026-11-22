import { describe, expect, it } from "vitest";
import { metaIdSuffix, metaIdSuffixReport } from "./metaIdSuffix";

describe("metaIdSuffixReport", () => {
  it("counts agreement within a case and coincidences between cases", () => {
    const cases = new Map([
      ["a", ["120200000000001234", "120200000000011234"]],
      ["b", ["120200000000005678", "120200000000009999"]],
      ["c", ["120200000000021234"]],
      ["d", []],
    ]);
    const r = metaIdSuffixReport(cases);
    expect(r.casesWithTwoIds).toBe(2);
    expect(r.casesInAgreement).toBe(1);
    expect(r.casesWithId).toBe(3);
    expect(r.pairsCompared).toBe(3);
    expect(r.coincidences).toEqual([["a", "c", "1234"]]);
    expect(r.expectedByChance).toBeCloseTo(0.0003);
  });

  it("ignores values that are not Meta identifiers", () => {
    expect(metaIdSuffix("12345")).toBeNull();
    expect(metaIdSuffix("120200000000001234")).toBe("1234");
  });
});
