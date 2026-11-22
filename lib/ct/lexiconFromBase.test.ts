import { describe, expect, it } from "vitest";
import type { EvidenceGraph } from "../graph/model";
import { ctLexiconFile, lexiconFromGraph } from "./lexiconFromBase";

const item = (key: string, data: Record<string, unknown>) => ({ id: `item:${key}`, type: "item", key, label: key, df: 1, weight: null, strong: false, discounts: [], data, campaignId: null });
const graph = {
  nodes: [
    item("a", { impersonatedBrand: "Bank Przykładowy", landingName: "Zyskarnia Demo" }),
    item("b", { impersonatedBrand: "bank przykładowy", platformCampaignName: "Zyskarnia  Demo" }),
    item("c", { landingName: "ab" }),
    item("d", {}),
    { ...item("e", { impersonatedBrand: "Ignorowana" }), type: "domain" },
  ],
} as unknown as EvidenceGraph;

describe("leksykon watchera CT z bazy", () => {
  it("zbiera podrabiane marki i nazwy landerów z rekordów, bez powtórzeń (wielkość liter, odstępy) i bez nazw krótszych niż 3 znaki", () => {
    expect(lexiconFromGraph(graph).brands).toEqual(["Bank Przykładowy", "Zyskarnia Demo"]);
  });

  it("plik leksykonu ma format czytany przez loadCtConfig i mówi, skąd pochodzi", () => {
    const file = ctLexiconFile(["Zyskarnia Demo"], new Date("2026-11-22T10:00:00Z"));
    expect(file.lexicon.brands).toEqual(["Zyskarnia Demo"]);
    expect(file._comment).toContain("2026-11-22");
  });
});
