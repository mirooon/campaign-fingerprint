import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset, type TestItemSpec } from "./testkit";

const OVERLAY = { kind: "strip" as const, color: "white" as const, box: { x: 0, y: 0.9, w: 1, h: 0.1 }, frames: 4, key: "strip:white:0,0.9,1,0.1" };

function run(a: TestItemSpec, b: TestItemSpec) {
  const res = clusterCampaigns(buildEvidenceGraph(makeDataset([a, b]), { textMethod: "tfidf" }));
  return { res, link: res.graph.links.find((l) => (l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id)) };
}

describe("video montage traces (B-326, B-327)", () => {
  it("links two videos with the same replaced-caption layout, but never into one campaign by itself", () => {
    const { res, link } = run({ id: "a", videoOverlay: OVERLAY, advertiser: "One" }, { id: "b", videoOverlay: OVERLAY, advertiser: "Two" });
    expect((link?.evidence ?? []).map((e) => e.pivotType)).toContain("overlay_template");
    expect(res.campaigns.assignments.a).not.toBe(res.campaigns.assignments.b);
    const node = res.graph.nodes.find((n) => n.id === "item:a");
    expect(node?.data.subtitleOverlay).toMatchObject({ kind: "strip" });
  });

  it("links the same source watermark across advertisers, not different ones", () => {
    const wm = { text: "studio test", corner: "top_right" as const, frames: 3 };
    const same = run({ id: "a", sourceWatermark: wm }, { id: "b", sourceWatermark: wm });
    expect((same.link?.evidence ?? []).map((e) => e.pivotType)).toContain("reused_footage");
    const other = run({ id: "a", sourceWatermark: wm }, { id: "b", sourceWatermark: { ...wm, text: "other studio" } });
    expect(other.link).toBeUndefined();
  });

  it("a video without overlay or watermark gets neither", () => {
    const { link } = run({ id: "a" }, { id: "b" });
    expect(link).toBeUndefined();
  });
});
