/**
 * Generator of docs/CECHY.md: the catalog of every trace that links ads into campaigns and every
 * attribute that only describes them. Everything is read from the code registries (plain.ts,
 * graph/config.ts, graph/model.ts, text/narrative.ts, FEATURE_KEYS of analyzeMaterial.ts), so
 * re-running it after new pivot types or attributes land picks them up. No case data is used.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_LINK_CONFIG, type LinkConfig } from "@/lib/graph/config";
import { ENTITY_TYPES, SIMILARITY_EDGE_TYPES } from "@/lib/graph/model";
import { DEFAULT_NARRATIVE_CONFIG, type NarrativeConfig } from "@/lib/text/narrative";
import { FEATURE_INFO, NARRATIVE_LABEL, ROLE_LABEL, SHOP_TECHNIQUES, TECHNIQUE_INFO, TECHNIQUE_LABEL, TYPE_INFO, type TypeInfo } from "@/lib/viewer/plain";
import { FEATURE_HIGHLIGHTS, HIGHLIGHTS_SAMPLE, highlightedTypes, type FeatureHighlight } from "./featureHighlights";

/** Heading of the highlighted-traces section; its GitHub anchor is HIGHLIGHTS_ANCHOR. */
export const HIGHLIGHTS_HEADING = "Traces that typical tools do not give";
/** GitHub anchor of HIGHLIGHTS_HEADING (lower case, punctuation dropped, spaces to hyphens). */
export const HIGHLIGHTS_ANCHOR = "traces-that-typical-tools-do-not-give";

/** Where a pivot type acts in linking. */
export type PivotLevel = "campaign" | "group" | "only with another trace";

export interface PivotRow {
  type: string;
  label: string | null;
  weight: number | null;
  level: PivotLevel;
  /** What the trace is and where it comes from (TYPE_INFO.what). */
  origin: string | null;
  /** Why it matters when linking (TYPE_INFO.why). */
  why: string | null;
  /** Synthetic example value (TYPE_INFO.example). */
  example: string | null;
  /** Listed in the highlighted-traces section (FEATURE_HIGHLIGHTS). */
  highlighted: boolean;
  /** Names of the material features that feed this type (FEATURE_INFO with a matching key). */
  sourceFeatures: string[];
  /** Similarity edge between two ads (not an entity). */
  similarity: boolean;
}

export interface FeatureRow {
  key: string;
  name: string;
  source: string;
  role: string;
}

export interface CatalogData {
  /** Traces that typical tools do not give (featureHighlights.ts). */
  highlights: FeatureHighlight[];
  pivots: PivotRow[];
  linkingFeatures: FeatureRow[];
  attributes: FeatureRow[];
  techniques: Array<{ key: string; name: string; what: string; shop: boolean }>;
  topics: Array<{ id: string; label: string | null; sub: string[] }>;
  hooks: Array<{ id: string; label: string | null }>;
  undescribed: string[];
}

/** Role of an attribute that has no entry in FEATURE_INFO (left out of the attribute table). */
const NO_DESCRIPTION = "no description";

/** Escapes a value for a Markdown table cell. */
function cell(text: string | null | undefined): string {
  return (text ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}

/** Parses the string keys of `const FEATURE_KEYS = [...]` out of analyzeMaterial.ts (the array is not exported). */
export function readFeatureKeys(root: string): string[] {
  const src = readFileSync(path.join(root, "lib/pipeline/analyzeMaterial.ts"), "utf8");
  const body = /const FEATURE_KEYS = \[([\s\S]*?)\];/.exec(src)?.[1] ?? "";
  return [...body.matchAll(/"([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
}

/** Weight of a similarity edge type from `config.similarity`, or null when the config has none. */
function similarityWeight(type: string, config: LinkConfig): number | null {
  const s = config.similarity;
  const map: Record<string, number | undefined> = {
    similar_image: s.imageWeight,
    similar_image_semantic: s.imageSemantic.weight,
    similar_text: s.text.weight,
    similar_dom: s.dom.weight,
    similar_audio: s.audio.weight,
    similar_voice: s.voice.weight,
  };
  return map[type] ?? null;
}

/**
 * Collects the catalog from the registries; anything without a label ends up in `undescribed`, and so
 * does a key of the highlights registry that is neither a described pivot type nor a described attribute.
 */
export function collectCatalog(
  root: string,
  config: LinkConfig = DEFAULT_LINK_CONFIG,
  narrative: NarrativeConfig = DEFAULT_NARRATIVE_CONFIG,
  highlights: FeatureHighlight[] = FEATURE_HIGHLIGHTS,
): CatalogData {
  const undescribed: string[] = [];
  const starred = highlightedTypes(highlights);
  const rules = config.campaignRules;
  const familyOnly = new Set(rules.familyOnlyKinds ?? []);
  const notAlone = new Set([...rules.notAloneKinds, ...(config.nonStrongTypes ?? []), ...(rules.contentKinds ?? [])]);
  const infoOf = (t: string): TypeInfo | undefined => (TYPE_INFO as Record<string, TypeInfo | undefined>)[t];

  const types = [...ENTITY_TYPES.filter((t) => t !== "item"), ...SIMILARITY_EDGE_TYPES] as string[];
  const pivots: PivotRow[] = types.map((type) => {
    const similarity = (SIMILARITY_EDGE_TYPES as readonly string[]).includes(type);
    const weight = similarity ? similarityWeight(type, config) : ((config.typeWeights as Record<string, number | undefined>)[type] ?? null);
    const level: PivotLevel = familyOnly.has(type) ? "group" : notAlone.has(type) ? "only with another trace" : "campaign";
    const info = infoOf(type);
    if (!info) undescribed.push(`linking trace: ${type} (no entry in TYPE_INFO)`);
    if (weight === null) undescribed.push(`linking trace: ${type} (no weight in the configuration)`);
    const sourceFeatures = Object.entries(FEATURE_INFO)
      .filter(([key]) => key.toLowerCase() === type.replace(/_/g, "").toLowerCase())
      .map(([, f]) => f.name);
    return { type, label: info?.name ?? null, weight, level, origin: info?.what ?? null, why: info?.why ?? null, example: info?.example ?? null, highlighted: starred.has(type), sourceFeatures, similarity };
  });
  for (const h of highlights) {
    for (const t of h.types) if (!infoOf(t) || !types.includes(t)) undescribed.push(`highlighted trace “${h.title}”: ${t} (no trace type or no entry in TYPE_INFO)`);
    for (const a of h.attributes) if (!FEATURE_INFO[a]) undescribed.push(`highlighted trace “${h.title}”: ${a} (no entry in FEATURE_INFO)`);
  }

  const featureRow = (key: string): FeatureRow => {
    const f = FEATURE_INFO[key];
    return { key, name: f?.name ?? key, source: f?.source ?? "", role: f ? ROLE_LABEL[f.role] : NO_DESCRIPTION };
  };
  const featureKeys = readFeatureKeys(root);
  const allKeys = [...new Set([...Object.keys(FEATURE_INFO), ...featureKeys])];
  for (const key of featureKeys) if (!FEATURE_INFO[key]) undescribed.push(`attribute: ${key} (in FEATURE_KEYS, no entry in FEATURE_INFO)`);
  const linkingFeatures = allKeys.filter((k) => FEATURE_INFO[k] && FEATURE_INFO[k].role !== "describes").map(featureRow);
  const attributes = allKeys.filter((k) => !FEATURE_INFO[k] || FEATURE_INFO[k].role === "describes").map(featureRow);

  const techKeys = [...new Set([...Object.keys(TECHNIQUE_INFO), ...Object.keys(TECHNIQUE_LABEL)])];
  const techniques = techKeys.map((key) => {
    const info = TECHNIQUE_INFO[key];
    if (!info) undescribed.push(`technique: ${key} (no entry in TECHNIQUE_INFO)`);
    if (!TECHNIQUE_LABEL[key] && !info?.name) undescribed.push(`technique: ${key} (no name)`);
    return { key, name: TECHNIQUE_LABEL[key] ?? info?.name ?? key, what: info?.what ?? "", shop: SHOP_TECHNIQUES.has(key) };
  });

  const topics = Object.entries(narrative.topics).map(([id, t]) => {
    if (!NARRATIVE_LABEL[id]) undescribed.push(`narrative topic: ${id}`);
    return { id, label: NARRATIVE_LABEL[id] ?? null, sub: Object.keys(t.sub ?? {}) };
  });
  const hooks = Object.keys(narrative.hooks).map((id) => {
    if (!NARRATIVE_LABEL[id]) undescribed.push(`narrative hook: ${id}`);
    return { id, label: NARRATIVE_LABEL[id] ?? null };
  });

  return { highlights, pivots, linkingFeatures, attributes, techniques, topics, hooks, undescribed };
}

/** Writes the highlighted-traces section: mechanism, what typical tools miss, and the aggregate result on the sample. */
function renderHighlights(out: string[], highlights: FeatureHighlight[]): void {
  if (!highlights.length) return;
  out.push(`## ${HIGHLIGHTS_HEADING}`);
  out.push("");
  out.push(`Typical OSINT tools link pages by domain, IP address, WHOIS and DNS records, certificate and image hash. We collect those traces too (section 1); below are the ones we read ourselves from the code of the page, links, identifiers and recordings. “On the sample” gives only counts from the run on ${HIGHLIGHTS_SAMPLE.materials} samples of the organiser's set (commit \`${HIGHLIGHTS_SAMPLE.commit}\`), without values; a pair is two samples linked by that evidence. In the table of section 1 these types have ★.`);
  out.push("");
  for (const h of highlights) {
    out.push(`### ${h.title}`);
    out.push("");
    out.push([...h.types, ...h.attributes].map((k) => `\`${k}\``).join(" · "));
    out.push("");
    out.push(`- **How we read it:** ${h.how}`);
    out.push(`- **What typical tools miss:** ${h.missed}`);
    out.push(`- **On the sample:** ${h.sample}`);
    out.push("");
  }
}

/** Renders the catalog as Markdown. `date` and `commit` go to the totals section. */
export function renderCatalog(data: CatalogData, config: LinkConfig, date: string, commit: string): string {
  const out: string[] = [];
  out.push("# Feature catalog");
  out.push("");
  out.push("Generated file: `bun run features:catalog`. Do not edit by hand.");
  out.push("");
  out.push(`Linking works like this: every trace has a weight (type × list × frequency), and samples go into one campaign when a strong trace links them or at least one kind of trace of the “campaign” level does (pair score after discounts from ${config.minLinkScore}); “only with another trace” traces do not link on their own unless they stay strong after discounts and rarity (from ${config.strongThreshold}, e.g. a form backend with a client ID), and “group” traces link only similar campaigns (details and thresholds in [METODYKA.md](METODYKA.md)).`);
  out.push("");
  renderHighlights(out, data.highlights);
  out.push("## 1. Linking traces");
  out.push("");
  out.push(`Strong trace threshold: ${config.strongThreshold}; minimum edge score: ${config.minLinkScore}; a shared trace found in more than ${config.maxPivotDf} samples is skipped (maxPivotDf). Level: **campaign** (can link into one campaign), **group** (similar campaigns only), **only with another trace** (supports, does not link on its own).`);
  out.push("");
  if (data.pivots.some((p) => p.highlighted)) {
    out.push(`★ marks a trace described in more detail in the section [${HIGHLIGHTS_HEADING}](#${HIGHLIGHTS_ANCHOR}).`);
    out.push("");
  }
  out.push("| Type | Name | Weight | Level | Source | Why | Example |");
  out.push("|---|---|---|---|---|---|---|");
  for (const p of data.pivots.filter((p) => p.label && p.weight !== null)) {
    const kind = p.similarity ? " (similarity of two samples)" : "";
    const star = p.highlighted ? " ★" : "";
    out.push(`| \`${p.type}\` | ${cell(p.label)}${kind}${star} | ${p.weight} | ${p.level} | ${cell(p.origin)}${p.sourceFeatures.length ? ` Sample feature: ${cell(p.sourceFeatures.join(", "))}.` : ""} | ${cell(p.why)} | ${cell(p.example)} |`);
  }
  out.push("");
  out.push("### Sample features that link or help");
  out.push("");
  out.push("| Key | Name | Role | Source |");
  out.push("|---|---|---|---|");
  for (const f of data.linkingFeatures) out.push(`| \`${f.key}\` | ${cell(f.name)} | ${f.role} | ${cell(f.source)} |`);
  out.push("");
  out.push("## 2. Attributes of the sample and the campaign");
  out.push("");
  out.push("They describe the sample and do not link it to others.");
  out.push("");
  out.push("| Key | Name | Source |");
  out.push("|---|---|---|");
  for (const f of data.attributes.filter((f) => f.role !== NO_DESCRIPTION)) out.push(`| \`${f.key}\` | ${cell(f.name)} | ${cell(f.source)} |`);
  out.push("");
  out.push("## 3. Manipulation techniques");
  out.push("");
  out.push("Field `techniques[]`. An attribute and a group trace, not proof of one campaign. Shop techniques only describe the shop page.");
  out.push("");
  out.push("| Key | Name | Description |");
  out.push("|---|---|---|");
  for (const t of data.techniques) out.push(`| \`${t.key}\` | ${cell(t.name)}${t.shop ? " (shop)" : ""} | ${cell(t.what)} |`);
  out.push("");
  out.push("## 4. Narrative topics and hooks");
  out.push("");
  out.push("**Topics** (what the ad is about; subcategories in brackets):");
  out.push("");
  for (const t of data.topics) out.push(`- \`${t.id}\`: ${cell(t.label ?? t.id)}${t.sub.length ? ` (${t.sub.join(", ")})` : ""}`);
  out.push("");
  out.push("**Hooks** (form of the message, independent of the topic):");
  out.push("");
  for (const h of data.hooks) out.push(`- \`${h.id}\`: ${cell(h.label ?? h.id)}`);
  out.push("");
  out.push("## No description");
  out.push("");
  if (data.undescribed.length === 0) out.push("Everything in the registries has a name and a description.");
  else for (const u of data.undescribed) out.push(`- ${u}`);
  out.push("");
  out.push("## 5. Summary");
  out.push("");
  out.push("| Section | Count |");
  out.push("|---|---|");
  out.push(`| Highlighted traces (section at the start) | ${data.highlights.length} |`);
  out.push(`| Linking traces (types) | ${data.pivots.length} (campaign: ${data.pivots.filter((p) => p.level === "campaign").length}, group: ${data.pivots.filter((p) => p.level === "group").length}, only with another trace: ${data.pivots.filter((p) => p.level === "only with another trace").length}) |`);
  out.push(`| Sample features that link or help | ${data.linkingFeatures.length} |`);
  out.push(`| Attributes of the sample and the campaign | ${data.attributes.length} |`);
  out.push(`| Manipulation techniques | ${data.techniques.length} |`);
  out.push(`| Narrative topics | ${data.topics.length} |`);
  out.push(`| Narrative hooks | ${data.hooks.length} |`);
  out.push(`| No description | ${data.undescribed.length} |`);
  out.push("");
  out.push(`Generated: ${date}, commit \`${commit}\`.`);
  out.push("");
  return out.join("\n");
}
