import { describe, expect, it } from "vitest";
import type { AddToBaseResult } from "@/lib/pipeline/addToBase";
import { addMessages, addToBaseRefusal } from "./addToBaseView";

const empty: AddToBaseResult = { added: [], skipped: [], createdCampaigns: [], historyDir: null };

describe("addMessages", () => {
  it("says what was added and to which campaign, a newly created one too", () => {
    const msgs = addMessages({ ...empty, added: [{ id: "n1", verdict: "new_campaign", campaign: "K11" }, { id: "n2", verdict: "known_campaign", campaign: "K03" }], createdCampaigns: ["K11"] });
    expect(msgs[0]).toBe("Added 2 samples to the base: n1 (new campaign K11), n2 (campaign K03).");
  });
  it("says what was not added and why, with the original of a duplicate", () => {
    const msgs = addMessages({ ...empty, skipped: [{ id: "n3", reason: "duplicate of a sample already in the base", duplicateOf: "c1-01" }, { id: "n4", reason: "insufficient data for comparison" }] });
    expect(msgs).toEqual(["Nothing was added to the base.", "Not added n3: duplicate of a sample already in the base (duplicate of sample c1-01).", "Not added n4: insufficient data for comparison."]);
  });
  it("one added sample is singular", () => {
    expect(addMessages({ ...empty, added: [{ id: "n1", verdict: "new_campaign", campaign: null }] })[0]).toBe("Added 1 sample to the base: n1.");
  });
});

describe("addToBaseRefusal", () => {
  it("the sample base is read-only and gets a description of how to add samples", () => {
    expect(addToBaseRefusal(true)).toContain("VIEWER_DATA_DIR");
    expect(addToBaseRefusal(false)).toBeNull();
  });
  it("the result of the example does not go into a base, not even your own", () => {
    expect(addToBaseRefusal(false, true)).toContain("example");
  });
});
