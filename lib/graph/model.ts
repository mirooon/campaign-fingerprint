/**
 * Typed evidence graph: entities (nodes), typed edges with human-readable
 * evidence and weights, item-item links and campaigns.
 * Type-only module (safe to import from client components).
 */

export const ENTITY_TYPES = [
  "item",
  "url",
  "host",
  "domain",
  "ip",
  "asn",
  "nameserver",
  "registrar",
  "cert",
  "tracker",
  "favicon",
  "imagehash",
  "wallet",
  "email",
  "phone",
  "telegram",
  "advertiser",
  // page kit and campaign metadata (research-driven pivots)
  "endpoint",
  "hidden_fields",
  "asset",
  "comment",
  "domain_pattern",
  "cname_target",
  "campaign_param",
  "persona",
  // pivots added after a run on real landing-page captures
  "path_id",
  "param_schema",
  // records of the landing-page platform and decoded click IDs (jury sample, 21.11)
  "platform_account",
  "platform_campaign",
  "page_template",
  "click_server",
  "meta_ad",
  // DSA transparency of the Meta Ad Library (MetaAdsCollector, opt-in)
  "ad_payer",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_LABELS_PL: Record<EntityType, string> = {
  item: "Reklama",
  url: "URL",
  host: "Host",
  domain: "Domena",
  ip: "Adres IP",
  asn: "ASN",
  nameserver: "Serwery NS",
  registrar: "Rejestrator",
  cert: "Certyfikat",
  tracker: "Tracker",
  favicon: "Favicon",
  imagehash: "Hash obrazu",
  wallet: "Portfel krypto",
  email: "E-mail",
  phone: "Telefon",
  telegram: "Telegram",
  advertiser: "Reklamodawca",
  endpoint: "Backend formularza",
  hidden_fields: "Ukryte pola formularza",
  asset: "Plik JS/CSS",
  comment: "Komentarz w kodzie",
  domain_pattern: "Wzorzec nazwy domeny",
  cname_target: "Cel CNAME",
  campaign_param: "Parametr kampanii",
  persona: "Persona (wizerunek)",
  path_id: "Identyfikator konta w ścieżkach zasobów",
  param_schema: "Szablon linku śledzącego",
  platform_account: "Konto na platformie stron",
  platform_campaign: "Kampania na platformie stron",
  page_template: "Szablon strony na platformie",
  click_server: "Serwer trackera (clickid xid)",
  meta_ad: "Reklama w Mecie (z fbclid)",
  ad_payer: "Płatnik reklamy (biblioteka reklam, DSA)",
};

export type EdgeType =
  | "landing"
  | "redirect"
  | "on_host"
  | "in_domain"
  | "resolves_to"
  | "announced_by"
  | "uses_ns"
  | "registered_with"
  | "registration_burst"
  | "has_cert"
  | "uses_tracker"
  | "has_favicon"
  | "has_image"
  | "mentions"
  | "posted_by"
  | "links_to"
  | "posts_to"
  | "has_hidden_fields"
  | "loads_asset"
  | "has_comment"
  | "matches_pattern"
  | "cname_to"
  | "carries_param"
  | "uses_path_id"
  | "follows_schema"
  | "built_on"
  | "routed_by"
  | "clicked_ad"
  | "mentions_persona"
  | "paid_by"
  | "similar_image"
  | "similar_image_semantic"
  | "similar_text"
  | "similar_dom"
  | "similar_audio"
  | "similar_voice";

/** Item-item similarity edge types (not entity pivots). */
export const SIMILARITY_EDGE_TYPES = ["similar_image", "similar_image_semantic", "similar_text", "similar_dom", "similar_audio", "similar_voice"] as const;
export type SimilarityEdgeType = (typeof SIMILARITY_EDGE_TYPES)[number];

export function isSimilarityEdge(t: string): t is SimilarityEdgeType {
  return (SIMILARITY_EDGE_TYPES as readonly string[]).includes(t);
}

export interface Discount {
  /** Human-readable reason (Polish). */
  reason: string;
  factor: number;
  rule: string;
}

export interface GraphNode {
  id: string;
  type: EntityType;
  key: string;
  label: string;
  /** Number of items connected to this entity (document frequency). */
  df: number;
  /** Final pivot weight in [0,1]: type weight x list factor x inverse frequency. */
  weight: number | null;
  /** True when sharing this entity is strong (merging) evidence. */
  strong: boolean;
  discounts: Discount[];
  /** Type-specific details shown in the viewer. */
  data: Record<string, unknown>;
  /** Campaign of an item node (filled by clustering). */
  campaignId: string | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  weight: number;
  /** Human-readable why (Polish). */
  evidence: string;
}

export interface PairEvidence {
  kind: "pivot" | "similarity";
  /** Shared entity node id (kind = pivot). */
  pivot: string | null;
  pivotType: EntityType | null;
  /** similar_image / similar_text (kind = similarity). */
  edgeType: EdgeType | null;
  weight: number;
  strong: boolean;
  discounted: boolean;
  evidence: string;
  /** Node path item A -> pivot and item B -> pivot (kind = pivot). */
  pathA: string[];
  pathB: string[];
}

export interface ItemLink {
  a: string;
  b: string;
  /** Combined score (noisy-OR of evidence weights) in [0,1]. */
  score: number;
  strong: boolean;
  evidence: PairEvidence[];
}

export interface GraphStats {
  items: number;
  nodes: number;
  edges: number;
  links: number;
  strongLinks: number;
  byType: Partial<Record<EntityType, number>>;
}

export interface EvidenceGraph {
  version: 1;
  generatedAt: string;
  mode: "live" | "offline";
  /** Dataset directory (relative to the project root) for resolving local image paths. */
  baseDir: string;
  textMethod: "tfidf" | "embedding" | "none";
  stats: GraphStats;
  nodes: GraphNode[];
  edges: GraphEdge[];
  links: ItemLink[];
}

export interface CampaignEvidence {
  /** Node id for pivots, or the similarity edge type. */
  key: string;
  type: EntityType | SimilarityEdgeType;
  label: string;
  /** Members holding this pivot / number of similarity pairs. */
  count: number;
  weight: number;
}

export interface Campaign {
  id: string;
  size: number;
  members: string[];
  firstSeen: string | null;
  lastSeen: string | null;
  topEvidence: CampaignEvidence[];
  domains: string[];
  advertisers: string[];
  /** Mean link score inside the campaign (0 for singletons). */
  cohesion: number;
  /** Number of union-find components (strong evidence) merged by Louvain. */
  strongComponents: number;
  /** Attributes for filtering and triage (not linking evidence). */
  attributes: CampaignAttributes;
  /** Group of similar campaigns (same kit, template or narrative) this campaign belongs to, if any. */
  familyId?: string | null;
}

/**
 * Group of similar campaigns: different operators or accounts (no campaign-level evidence between
 * them) whose material shares a kit, a page template or a narrative.
 */
export interface CampaignFamily {
  id: string;
  campaigns: string[];
  members: string[];
  size: number;
  /** Strongest evidence on links between member campaigns. */
  topEvidence: CampaignEvidence[];
  /** Why the campaigns are kept apart (e.g. different platform accounts). */
  apart: string[];
}

export interface CampaignAttributes {
  /** Personas (impersonated people) mentioned in member ads, with ad counts. */
  personas: Array<{ id: string; name: string; count: number }>;
  /** Member ads whose page comments or campaign parameters contain Cyrillic. */
  cyrillic: number;
  /** Member ads whose landing page looked different for a crawler and a mobile browser. */
  cloakingSuspected: number;
  /** Highest deepfake score supplied in the input data (e.g. DROZD column), if any. */
  deepfakeScoreMax: number | null;
}

export interface CampaignsFile {
  version: 1;
  generatedAt: string;
  method: {
    unionFind: string;
    louvain: { resolution: number; seed: number; modularity: number | null };
    minLinkScore: number;
    /** Rules that decide which links may join two ads into one campaign. */
    rules?: string[];
  };
  campaigns: Campaign[];
  /** Groups of similar campaigns (second level). */
  families?: CampaignFamily[];
  assignments: Record<string, string>;
}

export function nodeId(type: EntityType, key: string): string {
  return `${type}:${key}`;
}
