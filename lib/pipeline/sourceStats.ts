/**
 * How many links inside campaigns each kind of metadata gave (pivot type on the evidence of a link
 * between two members of one campaign). Works on any graph.json; the result is the numbers behind the
 * ranking of sources in docs/ZRODLA-METADANYCH.md. Pure functions: the script reads the file.
 */
import type { EvidenceGraph } from "../graph/model";

/** Source a pivot or similarity type comes from; types missing here are listed as "inne". */
export const SOURCE_OF_TYPE: Record<string, string> = {
  url: "wejście (adres)",
  host: "wejście (adres)",
  domain: "wejście (adres)",
  advertiser: "wejście (reklamodawca)",
  campaign_param: "adres i HAR",
  param_schema: "adres i HAR",
  click_server: "adres i HAR",
  meta_ad: "adres i HAR",
  ip: "DNS",
  nameserver: "DNS",
  cname_target: "DNS",
  asn: "ASN",
  registrar: "RDAP",
  cert: "CT",
  tracker: "HTML/HAR",
  favicon: "HTML/HAR",
  endpoint: "HTML/HAR",
  hidden_fields: "HTML/HAR",
  asset: "HTML/HAR",
  comment: "HTML/HAR",
  comment_block: "HTML/HAR",
  path_id: "HTML/HAR",
  platform_account: "HTML/HAR",
  platform_campaign: "HTML/HAR",
  page_template: "HTML/HAR",
  email: "HTML/HAR",
  phone: "HTML/HAR",
  wallet: "HTML/HAR",
  telegram: "HTML/HAR",
  similar_dom: "HTML/HAR",
  domain_pattern: "nazwa domeny",
  imagehash: "obraz",
  similar_image: "obraz",
  similar_image_semantic: "obraz (CLIP)",
  similar_text: "tekst (OCR/ASR/strona)",
  persona: "tekst i twarze",
  technique: "HTML/HAR",
  ad_payer: "biblioteka reklam",
  similar_audio: "nagranie (odcisk audio)",
  similar_voice: "nagranie (głos)",
};

export interface SourceStatRow {
  /** Pivot or similarity type (node type or edge type). */
  type: string;
  source: string;
  /** Links between members of one campaign that carry this type as evidence. */
  links: number;
  /** Campaigns (two or more members) in which at least one link carries it. */
  campaigns: number;
  /** Links whose only evidence is this type (what no other source would have given). */
  onlyLinks: number;
  /** Links on which this evidence is strong (merging). */
  strongLinks: number;
}

export interface SourceStats {
  /** Campaigns of two or more members. */
  campaigns: number;
  /** Links between two members of one campaign. */
  links: number;
  /** Rows by `links`, descending. */
  rows: SourceStatRow[];
}

/** Counts, per evidence type, the links between members of one campaign (campaigns come from the item nodes of the graph). */
export function sourceStats(graph: EvidenceGraph): SourceStats {
  const campaignOf = new Map(graph.nodes.filter((n) => n.type === "item" && n.campaignId).map((n) => [n.key, n.campaignId as string]));
  const sizes = new Map<string, number>();
  for (const c of campaignOf.values()) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  const acc = new Map<string, { links: number; campaigns: Set<string>; only: number; strong: number }>();
  let links = 0;
  const inCampaigns = new Set<string>();
  for (const l of graph.links) {
    const c = campaignOf.get(l.a);
    if (!c || c !== campaignOf.get(l.b) || (sizes.get(c) ?? 0) < 2) continue;
    links += 1;
    inCampaigns.add(c);
    const types = new Set(l.evidence.map((e) => (e.kind === "pivot" ? (e.pivotType as string) : (e.edgeType as string))));
    for (const e of l.evidence) {
      const type = e.kind === "pivot" ? (e.pivotType as string) : (e.edgeType as string);
      const row = acc.get(type) ?? { links: 0, campaigns: new Set<string>(), only: 0, strong: 0 };
      row.campaigns.add(c);
      acc.set(type, row);
    }
    for (const type of types) {
      const row = acc.get(type)!;
      row.links += 1;
      if (types.size === 1) row.only += 1;
      if (l.evidence.some((e) => e.strong && (e.kind === "pivot" ? e.pivotType : e.edgeType) === type)) row.strong += 1;
    }
  }
  const rows = [...acc.entries()]
    .map(([type, r]) => ({ type, source: SOURCE_OF_TYPE[type] ?? "inne", links: r.links, campaigns: r.campaigns.size, onlyLinks: r.only, strongLinks: r.strong }))
    .sort((a, b) => b.links - a.links || a.type.localeCompare(b.type));
  return { campaigns: inCampaigns.size, links, rows };
}

/** Markdown table of the statistics (for pasting into a document), with the totals above it. */
export function sourceStatsMarkdown(s: SourceStats): string {
  const head = [`Kampanie z ≥ 2 materiałami: ${s.campaigns}; powiązania wewnątrz kampanii: ${s.links}.`, "", "| typ | źródło | powiązania | kampanie | jedyny dowód | mocne |", "|---|---|---|---|---|---|"];
  return [...head, ...s.rows.map((r) => `| ${r.type} | ${r.source} | ${r.links} | ${r.campaigns} | ${r.onlyLinks} | ${r.strongLinks} |`)].join("\n");
}
