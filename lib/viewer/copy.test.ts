import { describe, expect, it } from "vitest";
import { campaignNextSteps, METHOD_ANCHOR, READ_HOW } from "./copy";

describe("guiding texts (B-034)", () => {
  it("has a non-empty caption for every visualisation", () => {
    for (const [id, text] of Object.entries(READ_HOW)) expect(text.length, id).toBeGreaterThan(40);
    expect(METHOD_ANCHOR).toMatch(/^[a-z-]+$/);
  });

  it("gives 1–3 actions, deciding first when nothing is decided", () => {
    const steps = campaignNextSteps({ size: 4, minInternalScore: 0.3 }, null, 0.25);
    expect(steps.map((s) => s.id)).toEqual(["decide", "weakest", "compare"]);
    expect(campaignNextSteps({ size: 1 }, "rejected", 0.25).map((s) => s.id)).toEqual(["analyze"]);
    expect(campaignNextSteps({ size: 3, minInternalScore: 0.9 }, "to_report", 0.25).map((s) => s.id)).toEqual(["compare", "evidence"]);
    for (const d of [null, "to_report", "to_verify"] as const) {
      const n = campaignNextSteps({ size: 5, minInternalScore: 0.2, bridge: { pivot: "p", type: "domain", label: "x", parts: [] } }, d, 0.25).length;
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(3);
    }
  });
});
