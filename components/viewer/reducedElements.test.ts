import { describe, expect, it } from "vitest";
import type { ReducedGraph } from "@/lib/viewer/reducedGraph";
import { reducedToElements } from "./graphView";

const graph: ReducedGraph = {
  nodes: [
    { id: "campaign:K01", kind: "campaign", label: "K01", size: 9, campaignId: "K01", weight: null, strong: false, expandable: true },
    { id: "tracker:T1", kind: "trace", label: "GA4 G-TEST", size: 4, type: "tracker", weight: 0.5, strong: true, expandable: true },
    { id: "item:a1", kind: "item", label: "a1", size: 1, campaignId: "K01", weight: null, strong: false, expandable: false },
  ],
  edges: [{ id: "campaign:K01|tracker:T1", source: "campaign:K01", target: "tracker:T1", weight: 0.5 }],
};

describe("reducedToElements", () => {
  const els = reducedToElements(graph, new Map([["K01", { index: 0, size: 9 }]]));
  const node = (id: string) => els.find((e) => e.data.id === id)!;
  it("kampanie są większe od śladów, a reklamy mają klasę item i kolor kampanii", () => {
    expect(node("campaign:K01").data.size).toBeGreaterThan(node("tracker:T1").data.size as number);
    expect(node("item:a1").classes).toContain("item");
    expect(node("item:a1").data.color).toBe(node("campaign:K01").data.color);
  });
  it("silny ślad dostaje klasę strong, a kampania do rozwinięcia klasę expandable", () => {
    expect(node("tracker:T1").classes).toContain("strong");
    expect(node("campaign:K01").classes).toContain("expandable");
  });
  it("krawędź niesie wagę i klasę rodzaju", () => {
    const edge = els.find((e) => e.group === "edges")!;
    expect(edge.data.weight).toBe(0.5);
  });
});
