import { describe, expect, it } from "vitest";
import type { Campaign, CampaignFamily, CampaignsFile, EvidenceGraph } from "./model";
import { keepCampaignIds } from "./stableIds";

const camp = (id: string, members: string[], familyId: string | null = null): Campaign =>
  ({ id, size: members.length, members, firstSeen: null, lastSeen: null, topEvidence: [], domains: [], advertisers: [], cohesion: 0, strongComponents: 1, attributes: { personas: [], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null }, familyId }) as Campaign;

const family = (id: string, campaigns: string[], members: string[]): CampaignFamily => ({ id, campaigns, members, size: members.length, topEvidence: [], apart: [] });

function file(campaigns: Campaign[], families: CampaignFamily[] = []): CampaignsFile {
  const assignments: Record<string, string> = {};
  for (const c of campaigns) for (const m of c.members) assignments[m] = c.id;
  return { version: 1, generatedAt: "", method: { unionFind: "", louvain: { resolution: 1, seed: 1, modularity: null }, minLinkScore: 0 }, campaigns, families, assignments };
}

const graphOf = (campaigns: CampaignsFile): EvidenceGraph =>
  ({ nodes: Object.entries(campaigns.assignments).map(([key, campaignId]) => ({ id: `item:${key}`, type: "item", key, campaignId })) }) as unknown as EvidenceGraph;

const idsOf = (f: CampaignsFile) => Object.fromEntries(f.campaigns.map((c) => [[...c.members].sort().join("+"), c.id]));

describe("stałe identyfikatory kampanii po przebudowie", () => {
  const prev = file([camp("K01", ["a", "b", "c"]), camp("K02", ["d", "e"]), camp("K03", ["f"])]);

  it("dodanie materiału do kampanii zostawia identyfikatory i skład pozostałych", () => {
    // clusterowanie zwraca inne numery (K01 ↔ K02 zamienione) i dołożony materiał x
    const next = file([camp("K01", ["d", "e"]), camp("K02", ["a", "b", "c", "x"]), camp("K03", ["f"])]);
    const out = keepCampaignIds(prev, next, graphOf(next));
    expect(idsOf(out.campaigns)).toEqual({ "a+b+c+x": "K01", "d+e": "K02", f: "K03" });
    expect(out.campaigns.assignments).toMatchObject({ a: "K01", x: "K01", d: "K02", f: "K03" });
    expect(out.created).toEqual([]);
  });

  it("nowa kampania dostaje nowy numer za największym dotychczasowym, w kolejności", () => {
    const next = file([camp("K01", ["x", "y"]), camp("K02", ["a", "b", "c"]), camp("K03", ["d", "e"]), camp("K04", ["f"]), camp("K05", ["z"])]);
    const out = keepCampaignIds(prev, next, graphOf(next));
    expect(idsOf(out.campaigns)).toEqual({ "a+b+c": "K01", "d+e": "K02", f: "K03", "x+y": "K04", z: "K05" });
    expect(out.created).toEqual(["K04", "K05"]);
  });

  it("rozdzielona kampania: większa część zachowuje numer, mniejsza dostaje nowy", () => {
    const next = file([camp("K01", ["c", "x"]), camp("K02", ["a", "b"]), camp("K03", ["d", "e"]), camp("K04", ["f"])]);
    const out = keepCampaignIds(prev, next, graphOf(next));
    expect(idsOf(out.campaigns)).toEqual({ "a+b": "K01", "c+x": "K04", "d+e": "K02", f: "K03" });
    expect(out.created).toEqual(["K04"]);
  });

  it("połączone kampanie: numer zachowuje ta z większym pokryciem, przy remisie młodszy numer", () => {
    const next = file([camp("K01", ["a", "b", "c", "d", "e"]), camp("K02", ["f"])]);
    const out = keepCampaignIds(prev, next, graphOf(next));
    expect(idsOf(out.campaigns)).toEqual({ "a+b+c+d+e": "K01", f: "K03" });
  });

  it("przenosi numery także na grupy podobnych kampanii, przypisania, familyId i węzły grafu", () => {
    const p = file([camp("K01", ["a", "b"], "R01"), camp("K02", ["c"], "R01")], [family("R01", ["K01", "K02"], ["a", "b", "c"])]);
    const n = file([camp("K01", ["c"], "R01"), camp("K02", ["a", "b", "x"], "R01")], [family("R01", ["K01", "K02"], ["a", "b", "c", "x"])]);
    const out = keepCampaignIds(p, n, graphOf(n));
    expect(out.campaigns.families?.[0]).toMatchObject({ id: "R01", campaigns: ["K01", "K02"] });
    expect(out.campaigns.campaigns.map((c) => [c.id, c.familyId])).toEqual([["K02", "R01"], ["K01", "R01"]]);
    expect(out.graph.nodes.find((x) => x.key === "x")?.campaignId).toBe("K01");
    expect(out.graph.nodes.find((x) => x.key === "c")?.campaignId).toBe("K02");
  });

  it("bez poprzedniego pliku kampanii zostawia numery z klastrowania", () => {
    const next = file([camp("K01", ["a"]), camp("K02", ["b"])]);
    expect(keepCampaignIds(null, next, graphOf(next)).campaigns).toEqual(next);
  });
});
