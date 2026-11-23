/**
 * Copies of one ad inside a batch run (synthetic sample): the item nodes of graph.json carry
 * duplicateOf, so the viewer can stack them.
 */
import { describe, expect, it } from "vitest";
import { markDuplicates } from "../lib/pipeline/steps";
import { runSample, SAMPLE, sampleItems } from "./sampleRun";

describe("markDuplicates", () => {
  it("marks a re-compressed copy of an earlier ad, and not the same picture under another page", async () => {
    const run = await runSample();
    const n = await markDuplicates(run.graph, run.ds, SAMPLE);
    const dupOf = Object.fromEntries(run.graph.nodes.filter((nd) => nd.type === "item" && nd.data.duplicateOf).map((nd) => [nd.key, nd.data.duplicateOf as { id: string; reason: string }]));
    expect(Object.keys(dupOf).length).toBe(n);
    const items = sampleItems().items;
    const byImage = (img: string) => items.find((it) => it.imagePath === `images/${img}`)!.id;
    // c1_A_jpeg.jpg (no link) is a copy of c1_A.png; c1_A_bright.png points at another page of the site
    expect(dupOf[byImage("c1_A_jpeg.jpg")]).toEqual({ id: byImage("c1_A.png"), reason: "identical image (dHash differs by 1 bit, e.g. after recompression)" });
    expect(dupOf[byImage("c1_A_bright.png")]).toBeUndefined();
    // variants are never copies
    for (const v of ["c1_B_badge.png", "c1_B_crop.jpg", "c1_A_v2.png"]) expect(dupOf[byImage(v)], v).toBeUndefined();
  });
});
