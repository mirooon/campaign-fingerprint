/**
 * Text spaced out letter by letter (B-337) is an attribute of the material, read from every OCR source.
 * Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { buildEvidenceGraph } from "./link";
import { makeDataset } from "./testkit";

describe("spaced-out text as a technique (B-337)", () => {
  it("marks the material when the spaced text is only in a further screenshot", () => {
    const ds = makeDataset([{ id: "a", url: "https://alfa-wiadomosci.example/", ocrText: "Sponsorowane Zagraj teraz" }, { id: "b", url: "https://beta-zdrowie.test/", ocrText: "Sponsorowane Zagraj teraz" }]);
    ds.perItem.a.extraOcrText = "Opis: Z a r e j e s t r u j  s i ę dziś";
    const g = buildEvidenceGraph(ds, { textMethod: "none" });
    const a = g.nodes.find((n) => n.id === "item:a")!.data;
    expect(a.spacedText).toBe(true);
    expect(a.techniques).toContain("spaced_text");
    expect(g.nodes.find((n) => n.id === "item:b")!.data.techniques ?? []).not.toContain("spaced_text");
    // an attribute, never a link
    expect(g.links.some((l) => l.evidence.some((e) => /spaced/i.test(e.pivot ?? "")))).toBe(false);
  });
});
