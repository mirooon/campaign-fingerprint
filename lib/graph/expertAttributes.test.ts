import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset, type TestItemSpec } from "./testkit";

/** Builds the graph of the specs and returns the item node data by id. */
function itemData(specs: TestItemSpec[]): Record<string, Record<string, unknown>> {
  const res = clusterCampaigns(buildEvidenceGraph(makeDataset(specs, {}), { textMethod: "none" }));
  return Object.fromEntries(res.graph.nodes.filter((n) => n.type === "item").map((n) => [n.key, n.data]));
}

describe("expert and live-stream attributes (B-300, B-301)", () => {
  const health = "Lekarz dr Jan Testowy ujawnia: ten lek na stawy i choroby serca leczy cudownie, kuracja bez recepty.";

  /** An invented doctor in a health ad is an attribute (B-300); the linking pivot is B-313 `fictional_expert`, the only expert node type. */
  it("marks an unlisted doctor in a health ad and adds no other expert pivot", () => {
    const d = itemData([{ id: "a", text: health }, { id: "b", text: `${health} Zamów dziś.` }]);
    expect(d.a.fictionalExpert).toEqual(["dr Jan Testowy"]);
    const res = clusterCampaigns(buildEvidenceGraph(makeDataset([{ id: "a", text: health }], {}), { textMethod: "none" }));
    expect(res.graph.nodes.some((n) => String(n.type).includes("expert") && n.type !== "fictional_expert")).toBe(false);
  });

  /** A non-health ad with a title is not marked. */
  it("does not mark a non-health ad", () => {
    const d = itemData([{ id: "a", text: "Dr Jan Testowy zaprasza na wykład o historii miasta." }]);
    expect(d.a.fictionalExpert).toBeUndefined();
  });

  /** yt-dlp live_status in the item columns marks a fake live stream; a plain video does not. */
  it("marks was_live and not a plain video", () => {
    const d = itemData([
      { id: "a", text: "x", extra: { live_status: "was_live" } },
      { id: "b", text: "y", extra: {} },
    ]);
    expect(d.a.liveStream).toBe(true);
    expect(d.b.liveStream).toBeUndefined();
  });

  /** A recorded "not in the register" answer becomes a label on the item. */
  it("labels a doctor missing from the register", () => {
    const ds = makeDataset([{ id: "a", text: health }], {});
    ds.perItem.a.expertChecks = [{ name: "Jan Testowy", registered: false }];
    const res = clusterCampaigns(buildEvidenceGraph(ds, { textMethod: "none" }));
    expect(res.graph.nodes.find((n) => n.type === "item")!.data.expertNotInRegister).toEqual(["Jan Testowy"]);
  });
});
