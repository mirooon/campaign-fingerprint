/**
 * Pure helpers for the viewer's "compare two ads" panel, item attributes and the
 * campaign persona filter. No React here, so everything is unit-tested.
 */
import {
  isSimilarityEdge,
  type Campaign,
  type CampaignAttributes,
  type EdgeType,
  type GraphNode,
  type ItemLink,
  type PairEvidence,
} from "@/lib/graph/model";
import type { GraphIndex } from "./graphView";

export interface ItemOption {
  key: string;
  label: string;
  campaignId: string | null;
}

const byNumeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** All ads, ordered by campaign then id, labelled "id · advertiser". */
export function itemOptions(idx: GraphIndex): ItemOption[] {
  const out: ItemOption[] = [];
  for (const n of idx.nodeById.values()) {
    if (n.type !== "item") continue;
    const advertiser = typeof n.data.advertiser === "string" && n.data.advertiser ? n.data.advertiser : null;
    out.push({ key: n.key, label: advertiser ? `${n.key} · ${advertiser}` : n.key, campaignId: n.campaignId });
  }
  return out.sort((x, y) => byNumeric(x.campaignId ?? "~", y.campaignId ?? "~") || byNumeric(x.key, y.key));
}

/** Item key if it exists in the graph, otherwise null (for deep-link parameters). */
export function validItemKey(idx: GraphIndex, key: string | null | undefined): string | null {
  return key && idx.nodeById.get(`item:${key}`)?.type === "item" ? key : null;
}

/** The stored link between two ads (graph.json keeps each ad's strongest links only). */
export function pairLink(idx: GraphIndex, a: string, b: string): ItemLink | null {
  return idx.linksByItem.get(a)?.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a)) ?? null;
}

/** Entities an ad reaches through the graph (url -> host -> domain -> ip ...), items excluded. */
export function reachableEntities(idx: GraphIndex, itemKey: string): Set<string> {
  const seen = new Set<string>();
  const stack = [`item:${itemKey}`];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of idx.out.get(id) ?? []) {
      if (isSimilarityEdge(e.type) || seen.has(e.target)) continue;
      const t = idx.nodeById.get(e.target);
      if (!t || t.type === "item") continue;
      seen.add(e.target);
      stack.push(e.target);
    }
  }
  return seen;
}

export interface SharedEntity {
  node: GraphNode;
  /** True when the entity is listed in the stored direct evidence of the pair. */
  inDirect: boolean;
}

/**
 * Every entity both ads reach, including weak and discounted ones. This explains why two
 * ads were NOT merged (e.g. a shared public form service or CDN), which the stored links
 * cannot show because links below the minimum score are dropped.
 */
export function sharedEntities(idx: GraphIndex, a: string, b: string, direct: PairEvidence[] = []): SharedEntity[] {
  const ra = reachableEntities(idx, a);
  const rb = reachableEntities(idx, b);
  const inDirect = new Set(direct.map((e) => e.pivot).filter((p): p is string => !!p));
  const out: SharedEntity[] = [];
  for (const id of ra) {
    if (!rb.has(id)) continue;
    const node = idx.nodeById.get(id);
    if (node) out.push({ node, inDirect: inDirect.has(id) });
  }
  return out.sort(
    (x, y) =>
      Number(y.node.strong) - Number(x.node.strong) ||
      (y.node.weight ?? 0) - (x.node.weight ?? 0) ||
      x.node.df - y.node.df ||
      x.node.id.localeCompare(y.node.id),
  );
}

export type PersonaSource = "ingest" | "ner" | "fuzzy" | "watchlist";

export const PERSONA_SOURCE_LABELS: Record<PersonaSource, string> = {
  ingest: "input data (e.g. DROZD)",
  ner: "NER (model output)",
  fuzzy: "OCR/ASR, approximate match",
  watchlist: "watchlist of names",
};

/**
 * Parses the evidence text of a mentions_persona edge (written by lib/graph/link.ts) into its source. Both the
 * English wording and the Polish one of graphs built before the English labels are recognised.
 */
export function personaSourceOf(evidence: string): PersonaSource {
  if (/input data|danych wejściowych/i.test(evidence)) return "ingest";
  if (/\bNER\b/.test(evidence)) return "ner";
  if (/OCR|ASR|approximate|przybliżon/i.test(evidence)) return "fuzzy";
  return "watchlist";
}

/** All sources in a mentions_persona evidence text (several ways are joined with "; "). */
export function personaSourcesOf(evidence: string): PersonaSource[] {
  return [...new Set(evidence.split(";").map((part) => personaSourceOf(part)))];
}

export interface PersonaMention {
  /** Persona node id (null when only the name is known, e.g. an older graph.json). */
  nodeId: string | null;
  name: string;
  sources: PersonaSource[];
}

/** Personas an ad mentions, with how each was found (from mentions_persona edges). */
export function personaMentions(idx: GraphIndex, itemKey: string): PersonaMention[] {
  const byId = new Map<string, PersonaMention>();
  for (const e of idx.out.get(`item:${itemKey}`) ?? []) {
    if (e.type !== "mentions_persona") continue;
    const p = idx.nodeById.get(e.target);
    if (!p) continue;
    const cur = byId.get(p.id) ?? { nodeId: p.id, name: typeof p.data.name === "string" ? p.data.name : p.label, sources: [] };
    for (const src of personaSourcesOf(e.evidence)) if (!cur.sources.includes(src)) cur.sources.push(src);
    byId.set(p.id, cur);
  }
  if (byId.size) return [...byId.values()];
  const names = idx.nodeById.get(`item:${itemKey}`)?.data.personas;
  return Array.isArray(names) ? names.filter((n): n is string => typeof n === "string").map((name) => ({ nodeId: null, name, sources: [] })) : [];
}

const EMPTY_ATTRIBUTES: CampaignAttributes = { personas: [], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null };

/** Campaign attributes with safe defaults (graph.json files from before attributes existed). */
export function campaignAttributes(c: Campaign): CampaignAttributes {
  const a = (c as Partial<Campaign>).attributes;
  if (!a) return EMPTY_ATTRIBUTES;
  return {
    personas: Array.isArray(a.personas) ? a.personas : [],
    cyrillic: typeof a.cyrillic === "number" ? a.cyrillic : 0,
    cloakingSuspected: typeof a.cloakingSuspected === "number" ? a.cloakingSuspected : 0,
    deepfakeScoreMax: typeof a.deepfakeScoreMax === "number" ? a.deepfakeScoreMax : null,
  };
}

export interface PersonaOption {
  id: string;
  name: string;
  /** Campaigns (of any size) whose ads mention the persona. */
  campaigns: number;
  /** Ads that mention the persona. */
  ads: number;
}

/** Persona filter options: every persona named in any campaign, most widespread first. */
export function personaOptions(campaigns: Campaign[]): PersonaOption[] {
  const byId = new Map<string, PersonaOption>();
  for (const c of campaigns) {
    for (const p of campaignAttributes(c).personas) {
      const cur = byId.get(p.id) ?? { id: p.id, name: p.name, campaigns: 0, ads: 0 };
      cur.campaigns += 1;
      cur.ads += p.count;
      byId.set(p.id, cur);
    }
  }
  // Polish collation on purpose: the names are Polish (Ł after L), the UI language does not change that
  return [...byId.values()].sort((x, y) => y.campaigns - x.campaigns || y.ads - x.ads || x.name.localeCompare(y.name, "pl"));
}

export function campaignHasPersona(c: Campaign, personaId: string | null): boolean {
  return !personaId || campaignAttributes(c).personas.some((p) => p.id === personaId);
}

export interface WeightParts {
  base: number;
  listFactor: number;
  idf: number;
  ubiquity?: number;
}

export function weightPartsOf(node: GraphNode): WeightParts | null {
  const p = node.data.weightParts as Partial<WeightParts> | undefined;
  if (!p || typeof p.base !== "number" || typeof p.listFactor !== "number" || typeof p.idf !== "number") return null;
  return { base: p.base, listFactor: p.listFactor, idf: p.idf, ubiquity: typeof p.ubiquity === "number" ? p.ubiquity : undefined };
}

/** "type 0.95 × list 0.05 × inverse frequency 0.505 × ubiquity 1" */
export function weightFormula(parts: WeightParts): string {
  const terms = [`type ${parts.base}`, `list ${parts.listFactor}`, `inverse frequency ${parts.idf}`];
  if (parts.ubiquity !== undefined) terms.push(`ubiquity ${parts.ubiquity}`);
  return terms.join(" × ");
}

export const SIMILARITY_LABELS: Record<string, string> = {
  similar_image: "similar creative (dHash)",
  similar_image_semantic: "same creative template (CLIP)",
  similar_text: "similar text",
  similar_dom: "same page template (DOM simhash)",
  similar_audio: "same audio track (Chromaprint)",
  similar_voice: "same speaker voice (SpeechBrain)",
};

export function similarityLabel(t: EdgeType | null): string {
  return t ? (SIMILARITY_LABELS[t] ?? t) : "similarity";
}

/**
 * Plural form of a noun: an English pair `[singular, plural]` gives "1 case", "2 cases". A three-form array is the
 * Polish set (1 kampania, 2–4 kampanie, 5+ kampanii, 12–14 kampanii) still passed by callers outside this file
 * until they switch to English pairs.
 */
export function plural(n: number, forms: readonly [string, string] | readonly [string, string, string]): string {
  if (n === 1) return forms[0];
  if (forms.length === 2) return forms[1];
  const lastTwo = n % 100;
  const last = n % 10;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? forms[1] : forms[2];
}
