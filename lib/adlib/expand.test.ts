import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "../graph/cluster";
import { buildEvidenceGraph } from "../graph/link";
import { makeDataset } from "../graph/testkit";
import { expansionQueries } from "./expand";

const extra = (adId: string, advertiserId: string) => ({ ad_platform: "google", ad_id: adId, ad_library_url: "u", advertiser_id: advertiserId });

describe("expansionQueries", () => {
  const graph = buildEvidenceGraph(
    makeDataset([
      { id: "a", url: "https://oferta-wspolna.example/a", advertiser: "Nazwa 1", extra: extra("CR1", "AR0000000000000000001"), text: "inwestuj z nami dziś" },
      { id: "b", url: "https://oferta-wspolna.example/b", advertiser: "Nazwa 2", extra: extra("CR2", "AR0000000000000000001"), text: "inwestuj z nami dziś" },
      { id: "z", url: "https://zupelnie-inna.example/", advertiser: "Inny", extra: extra("CR3", "AR0000000000000000777") },
    ]),
  );
  const { campaigns } = clusterCampaigns(graph);
  const campaign = campaigns.campaigns.find((c) => c.members.includes("a"))!;

  it("asks for the domains of the campaign and for the library accounts of its advertisers", () => {
    const qs = expansionQueries(graph, campaign);
    expect(qs).toContainEqual({ platform: "google", query: { keyword: "oferta-wspolna.example" }, reason: "domena kampanii" });
    expect(qs).toContainEqual({ platform: "google", query: { advertiser: "AR0000000000000000001" }, reason: "konto reklamodawcy z biblioteki reklam" });
  });

  it("does not ask twice for one account, and not for accounts of other campaigns", () => {
    const qs = expansionQueries(graph, campaign);
    expect(qs.filter((q) => q.query.advertiser === "AR0000000000000000001")).toHaveLength(1);
    expect(qs.some((q) => q.query.advertiser === "AR0000000000000000777")).toBe(false);
    expect(qs.some((q) => q.query.keyword === "zupelnie-inna.example")).toBe(false);
  });
});
