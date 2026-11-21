import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import type { ItemLink } from "./model";
import { makeDataset, type TestItemSpec } from "./testkit";

function run(specs: TestItemSpec[]) {
  const graph = buildEvidenceGraph(makeDataset(specs), { textMethod: "tfidf" });
  return clusterCampaigns(graph);
}
const link = (res: ReturnType<typeof run>, a: string, b: string): ItemLink | undefined =>
  res.graph.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
const kinds = (l: ItemLink | undefined) => (l?.evidence ?? []).map((e) => e.edgeType ?? e.pivotType);

const LIBRARY_VIEW = (id: string, copy: string) =>
  `Szczegóły reklamy x Aktywna Identyfikator biblioteki: ${id} Data zamieszczenia: 8 paź 2026 Sponsorowane ${copy} Dowiedz się więcej Transparentność według lokalizacji Informacje o reklamodawcy Reklamodawca i płatnik`;

describe("screenshots of ads: the platform interface is not evidence", () => {
  it("two ad-library screenshots of different ads are not linked by the interface text or its layout", () => {
    const res = run([
      { id: "a", dhash: "ffff0000ffff0000", ocrText: LIBRARY_VIEW("1111111111111111", "Krem na stawy działa od pierwszego dnia") },
      { id: "b", dhash: "ffff0000ffff0003", ocrText: LIBRARY_VIEW("2222222222222222", "Nowy sposób na tańszy prąd w domu") },
    ]);
    expect(kinds(link(res, "a", "b"))).toEqual([]);
    expect(res.campaigns.assignments.a).not.toBe(res.campaigns.assignments.b);
  });

  it("an identical picture hash of two ad-library views does not link different ads", () => {
    const res = run([
      { id: "g", dhash: "ffff0000ffff0000", ocrText: LIBRARY_VIEW("4444444444444444", "Krem na stawy działa od pierwszego dnia") },
      { id: "h", dhash: "ffff0000ffff0000", ocrText: LIBRARY_VIEW("5555555555555555", "Nowy sposób na tańszy prąd w domu") },
    ]);
    expect(kinds(link(res, "g", "h"))).toEqual([]);
  });

  it("near-identical creatives without interface text are still linked by the picture", () => {
    const res = run([
      { id: "c", dhash: "ffff0000ffff0000" },
      { id: "d", dhash: "ffff0000ffff0003" },
    ]);
    expect(kinds(link(res, "c", "d"))).toEqual(["similar_image"]);
  });

  it("the same ad-library ID in two screenshots is strong evidence: one ad reported twice", () => {
    const res = run([
      { id: "e", ocrText: LIBRARY_VIEW("3333333333333333", "Lekarze są w szoku") },
      { id: "f", ocrText: LIBRARY_VIEW("3333333333333333", "Lekarze sa w szoku") },
    ]);
    const l = link(res, "e", "f")!;
    expect(l.strong).toBe(true);
    expect(l.evidence.map((e) => e.pivot)).toContain("campaign_param:ad_library_id=3333333333333333");
    expect(res.campaigns.assignments.e).toBe(res.campaigns.assignments.f);
    const node = res.graph.nodes.find((n) => n.id === "campaign_param:ad_library_id=3333333333333333")!;
    // inactive ads are shown only when the link asks for every status, type and country
    expect(node.data.sourceUrl).toBe("https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&id=3333333333333333");
  });
});
