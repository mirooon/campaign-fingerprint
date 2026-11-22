/**
 * Widening a campaign through the ad libraries: the queries that follow from what the campaign already
 * holds. Pure function over the evidence graph; the CLI runs the queries (`adlib expand`).
 */
import type { Campaign, EvidenceGraph } from "../graph/model";
import type { AdPlatform, AdSearchQuery } from "./types";

export interface ExpansionQuery {
  platform: AdPlatform;
  query: AdSearchQuery;
  reason: string;
}

/**
 * Queries that widen a campaign: its landing domains (searched where a library can search by domain:
 * Google through the public RPC) and the library accounts of its advertisers (all ads of the same
 * account). A library account is the stable ID of an advertiser node written from a library record,
 * so only ads that came from a library give such a query; each query appears once.
 */
export function expansionQueries(graph: EvidenceGraph, campaign: Campaign): ExpansionQuery[] {
  const out: ExpansionQuery[] = campaign.domains.map((domain) => ({ platform: "google", query: { keyword: domain }, reason: "domena kampanii" }));
  const members = new Set(campaign.members.map((m) => `item:${m}`));
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  for (const e of graph.edges) {
    if (e.type !== "posted_by" || !members.has(e.source)) continue;
    const node = nodes.get(e.target);
    const platform = node?.data.platform as AdPlatform | undefined;
    const id = node?.data.advertiserId as string | undefined;
    if (node?.type !== "advertiser" || !platform || !id || seen.has(node.id)) continue;
    seen.add(node.id);
    out.push({ platform, query: { advertiser: id }, reason: "konto reklamodawcy z biblioteki reklam" });
  }
  return out;
}
