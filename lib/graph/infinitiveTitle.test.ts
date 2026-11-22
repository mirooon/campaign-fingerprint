import { describe, expect, it } from "vitest";
import { buildEvidenceGraph } from "./link";
import { makeDataset } from "./testkit";

describe("infinitive title (B-328)", () => {
  it("records a bare infinitive title as a translation artifact and not an imperative one", () => {
    const g = buildEvidenceGraph(makeDataset([{ id: "a", extra: { ad_title: "Czytać" } }, { id: "b", extra: { ad_title: "Czytaj więcej" } }]), { textMethod: "tfidf" });
    expect(g.nodes.find((n) => n.id === "item:a")?.data.translationArtifacts).toEqual([{ kind: "infinitive_cta", text: "czytać" }]);
    expect(g.nodes.find((n) => n.id === "item:b")?.data.translationArtifacts).toBeUndefined();
  });
});
