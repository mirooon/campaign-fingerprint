/**
 * Typed evidence graph: entities (nodes), typed edges with human-readable
 * evidence and weights, item-item links and campaigns.
 * Type-only module (safe to import from client components).
 */
import type { NarrativeSummary } from "../text/narrative";

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
  // page techniques (21.11): fake comment block written into the page (template trace) and the
  // technique names (modus operandi, second level only)
  "comment_block",
  "technique",
  // lead-company traces (I23): the key of the CRM / lead API (hashed), a sentence of the page template,
  // and the profit claims of the copy (amount + period, second level only)
  "crm_key",
  "template_phrase",
  "profit_claim",
  // text fingerprint (I25): a developer message of the kit's own scripts (a set shared by two pages)
  "kit_string",
  // contact identifiers (I28): a shared document, form or chat, an onion address, a messenger invitation
  "shared_doc",
  "onion",
  "messenger_invite",
  // C2 host of a stealer trojan in the lander kit (B-333)
  "c2_host",
  // a made-up "dr" or "prof." named on the page or in the ad (B-313)
  "fictional_expert",
  // shared lead funnel of a landing-page platform (B-332)
  "lead_flow",
  // video montage traces (B-326, B-327): the layout of replaced captions, the watermark of the stolen recording
  "overlay_template",
  "reused_footage",
  // identifiers of a company on a page (NIP, REGON, KRS, VAT, UK number) and bank accounts (IBAN, NRB)
  "company_id",
  "bank_account",
  // postal address of a shop (street, number, postal code, city), a trace that only supports a link
  "postal_address",
  // fields of the platform's visitor record (B-331, B-345): the cloaker customer account and the account
  // the ads were launched from, when it differs from the page owner
  "cloaker_account",
  "launcher_account",
  // account of an affiliate network (B-330): team+user pair, stream or offer UUID, scoped to the network host
  "affiliate_account",
  // Meta access token of the operator's ad account, only as a SHA-256 key (B-144)
  "meta_token",
  // account on video/file hosting (B-342): a Bunny Stream library of the page's videos
  "hosting_account",
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
  comment_block: "Blok fałszywych komentarzy",
  technique: "Technika strony",
  crm_key: "Klucz API CRM / sieci afiliacyjnej",
  template_phrase: "Zdanie szablonu strony",
  profit_claim: "Obiecywany zysk (kwota i okres)",
  kit_string: "Komunikat ze skryptu zestawu stron",
  shared_doc: "Dokument, formularz lub czat udostępniony linkiem",
  onion: "Adres .onion",
  messenger_invite: "Zaproszenie lub konto komunikatora",
  c2_host: "Serwer C2 trojana w zestawie strony",
  fictional_expert: "Zmyślony ekspert (dr, prof.)",
  lead_flow: "Wspólny lejek leadów platformy stron",
  hosting_account: "Konto na hostingu wideo",
  overlay_template: "Szablon podmienionych napisów w wideo",
  reused_footage: "Znak źródła cudzego nagrania",
  company_id: "Identyfikator firmy (NIP, REGON, KRS, VAT)",
  bank_account: "Rachunek bankowy (IBAN, NRB)",
  postal_address: "Adres siedziby sklepu",
  cloaker_account: "Konto klienta cloakera",
  launcher_account: "Konto narzędzia do uruchamiania reklam",
  affiliate_account: "Konto w sieci afiliacyjnej",
  meta_token: "Token dostępu Meta (tylko skrót)",
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
  | "has_comment_block"
  | "uses_technique"
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
  /** Raw similarity of a similarity edge (cosine, Chromaprint similarity), when it has one. */
  similarity?: number;
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
  /** Analyst decisions (corrections.json, B-281) that touched this campaign, each starting with "decyzja analityka". */
  analystNotes?: string[];
  /** Group of similar campaigns (same kit, template or narrative) this campaign belongs to, if any. */
  familyId?: string | null;
  /**
   * Members attached as variants of a creative (campaignRules.contentVariant): they have no
   * infrastructure and stand on the creative alone, so the assignment is less certain. `like` is the
   * member with the nearest creative, `evidence` the premise of that link, `weight` its weight.
   */
  variants?: ContentVariant[];
  /**
   * A strong pivot that alone ties two or more subgroups of the campaign (each of at least
   * `bridgeMinPartSize` members, with no other shared evidence between them): "campaign glued by one trace",
   * a candidate for lists.pivots if the trace turns out shared. Absent when there is none.
   */
  bridge?: { pivot: string; type: EntityType; label: string; parts: string[][] };
  /** The weakest member's best joining link: how close the loosest member hangs to the threshold. Absent for one member. */
  minInternalScore?: number;
  /** The member with that weakest best link, and how many joining links it has. */
  weakestMember?: { id: string; score: number; links: number };
  /**
   * Optional, for the "campaign evolution" view (campaigns of two or more members): per trait type,
   * the values every member shares (`stable`) and the types whose values differ between members
   * (`changing`, every value with the date of the first member holding it). The viewer can derive the
   * same from graph.json and must work without this field.
   */
  evolution?: CampaignEvolution;
}

/** One value of a trait of a campaign: a graph pivot (node id and label). */
export interface CampaignTraitValue {
  id: string;
  label: string;
  /** firstSeen of the earliest member holding the value (null: no member with a date). */
  firstSeen: string | null;
  /** Members holding the value. */
  items: number;
}

/** Values of one trait type in a campaign, ordered by first appearance. */
export interface CampaignTraitGroup {
  type: EntityType;
  values: CampaignTraitValue[];
}

/**
 * Stable and changing traits of a campaign. A type is stable when it has values held by every member
 * (only those values are listed); it is changing when some value is not held by every member (all its
 * values are listed, the first is where the campaign started, each next one a change). A type with a
 * shared value and a further one is in both lists.
 */
export interface CampaignEvolution {
  stable: CampaignTraitGroup[];
  changing: CampaignTraitGroup[];
}

/** A member attached to its campaign as a variant of a creative (`Campaign.variants`). */
export interface ContentVariant {
  id: string;
  like: string;
  evidence: string;
  weight: number;
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
  /** Narratives of the members (topics with dates, hooks, IHC labels): a trait of the group, never evidence. */
  narrative?: NarrativeSummary;
  /** Groups of the impersonated persons (e.g. "Dziennikarze") with member counts, from the public list. */
  personaCategories?: Array<{ category: string; count: number }>;
  /** Brands recognised on the members' creatives, with member counts. */
  brands?: Array<{ id: string; name: string; count: number }>;
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
  /**
   * What the campaign stands on: "content" when every link that joined its members is content only
   * (similar copy, picture, recording, the same creative file) and a single member has no infrastructure;
   * "infrastructure" when no member is attached by content alone; "mixed" otherwise.
   */
  basis?: "content" | "infrastructure" | "mixed";
  /** Narratives of the members (topics with dates, hooks, IHC labels, topic switches): an attribute, never evidence. */
  narrative?: NarrativeSummary;
  /** Brands recognised on the members' creatives (CLIP zero-shot), with member counts: an attribute, never evidence. */
  brands?: Array<{ id: string; name: string; count: number }>;
  /** Platforms of the members' pages (page builder, tracker product) from their SDK traces, with member counts: an attribute. */
  platforms?: Array<{ id: string; count: number }>;
  /** Members whose ad the ad library shows as taken down by the platform (B-192). */
  takenDownCount?: number;
  /** Members whose ad started on each weekday, Monday first (seven counts; I28): the rhythm of the operator, an attribute. */
  adStartWeekdays?: number[];
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

/**
 * Id of the rule that kept two similar ads out of one campaign (`NearMiss.rule`). `below-min-score`: the
 * pair score is under `minLinkScore`; `family-only-kind`: only evidence that counts for groups (a
 * person in the ad, a technique) lifts it; `account-conflict`: different accounts of one page platform;
 * `discounted-only`: the only traces are infrastructure shared by many sites (the discount weakened them);
 * `kit-only`: only traces of a page kit or a template, which many operators reuse;
 * `content-only-with-infra`: copy or picture alone, while an ad has infrastructure; `too-few-content-kinds`:
 * one kind of content between ads without infrastructure; `too-few-evidence-kinds`: fewer kinds of
 * operator evidence than `minEvidenceKinds`; `split-by-clustering`: the rules allowed the link, but the
 * clustering put the ads in different campaigns.
 */
export type NearMissRule =
  | "below-min-score"
  | "family-only-kind"
  | "account-conflict"
  | "discounted-only"
  | "kit-only"
  | "content-only-with-infra"
  | "too-few-content-kinds"
  | "too-few-evidence-kinds"
  | "split-by-clustering";

/** A shared trace weakened by a discount: its rule kind, the id of the discount rule and the factor (0..1). */
export interface NearMissDiscount {
  kind: string;
  rule: string;
  factor: number;
}

/** A pair of similar ads that the method deliberately did not join into one campaign. */
export interface NearMiss {
  a: string;
  b: string;
  /** Pair score in [0,1] (noisy-OR of all evidence, discounted included). */
  score: number;
  rule: NearMissRule;
  /** Sentence in Polish: what held the pair back, with the numbers it concerns. */
  reason: string;
  /** Rule kinds of all shared traces (pivot type, similarity edge type, or a finer kind such as "tracker_host"), sorted. */
  sharedKinds: string[];
  /** Shared traces of a strong type that a discount weakened (CDN, platform, registrar ...). */
  discounted: NearMissDiscount[];
  /** Why the pair is on the list: score at least `minScoreRatio` of `minLinkScore`, a discounted strong trace, or one family. */
  selectedBy: Array<"score" | "discounted-strong" | "family">;
  /** Campaigns of both ads (null: not assigned). */
  campaignA: string | null;
  campaignB: string | null;
  /** Family both campaigns belong to, if they share one. */
  familyId: string | null;
}

/** `near-misses.json`: the pairs listed by `findNearMisses`, strongest first, next to `campaigns.json`. */
export interface NearMissesFile {
  version: 1;
  generatedAt: string;
  minLinkScore: number;
  /** Settings the list was made with (`LinkConfig.nearMiss`). */
  minScoreRatio: number;
  maxPairs: number;
  /** Pairs that qualified before the cut at `maxPairs`. */
  total: number;
  /** Pairs that qualified, per rule (before the cut). */
  byRule: Partial<Record<NearMissRule, number>>;
  pairs: NearMiss[];
}

/** Key prefix of the "same creative file" pivot: an image-hash node keyed by the SHA-256 of the file ("creative_sha256" in the campaign rules). */
export const CREATIVE_FILE_PREFIX = "sha256:";

export function nodeId(type: EntityType, key: string): string {
  return `${type}:${key}`;
}
