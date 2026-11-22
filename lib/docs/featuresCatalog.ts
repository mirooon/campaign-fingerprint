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

/** Where a pivot type acts in linking. */
export type PivotLevel = "kampania" | "grupa" | "tylko z innym śladem";

export interface PivotRow {
  type: string;
  label: string | null;
  weight: number | null;
  level: PivotLevel;
  /** What the trace is and where it comes from (TYPE_INFO.what). */
  origin: string | null;
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
  pivots: PivotRow[];
  linkingFeatures: FeatureRow[];
  attributes: FeatureRow[];
  techniques: Array<{ key: string; name: string; what: string; shop: boolean }>;
  topics: Array<{ id: string; label: string | null; sub: string[] }>;
  hooks: Array<{ id: string; label: string | null }>;
  undescribed: string[];
}

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

/** Collects the catalog from the registries; anything without a Polish label ends up in `undescribed`. */
export function collectCatalog(root: string, config: LinkConfig = DEFAULT_LINK_CONFIG, narrative: NarrativeConfig = DEFAULT_NARRATIVE_CONFIG): CatalogData {
  const undescribed: string[] = [];
  const rules = config.campaignRules;
  const familyOnly = new Set(rules.familyOnlyKinds ?? []);
  const notAlone = new Set([...rules.notAloneKinds, ...(config.nonStrongTypes ?? []), ...(rules.contentKinds ?? [])]);
  const infoOf = (t: string): TypeInfo | undefined => (TYPE_INFO as Record<string, TypeInfo | undefined>)[t];

  const types = [...ENTITY_TYPES.filter((t) => t !== "item"), ...SIMILARITY_EDGE_TYPES] as string[];
  const pivots: PivotRow[] = types.map((type) => {
    const similarity = (SIMILARITY_EDGE_TYPES as readonly string[]).includes(type);
    const weight = similarity ? similarityWeight(type, config) : ((config.typeWeights as Record<string, number | undefined>)[type] ?? null);
    const level: PivotLevel = familyOnly.has(type) ? "grupa" : notAlone.has(type) ? "tylko z innym śladem" : "kampania";
    const info = infoOf(type);
    if (!info) undescribed.push(`ślad łączący: ${type} (brak wpisu w TYPE_INFO)`);
    if (weight === null) undescribed.push(`ślad łączący: ${type} (brak wagi w konfiguracji)`);
    const sourceFeatures = Object.entries(FEATURE_INFO)
      .filter(([key]) => key.toLowerCase() === type.replace(/_/g, "").toLowerCase())
      .map(([, f]) => f.name);
    return { type, label: info?.name ?? null, weight, level, origin: info?.what ?? null, sourceFeatures, similarity };
  });

  const featureRow = (key: string): FeatureRow => {
    const f = FEATURE_INFO[key];
    return { key, name: f?.name ?? key, source: f?.source ?? "", role: f ? ROLE_LABEL[f.role] : "brak opisu" };
  };
  const featureKeys = readFeatureKeys(root);
  const allKeys = [...new Set([...Object.keys(FEATURE_INFO), ...featureKeys])];
  for (const key of featureKeys) if (!FEATURE_INFO[key]) undescribed.push(`atrybut: ${key} (jest w FEATURE_KEYS, brak wpisu w FEATURE_INFO)`);
  const linkingFeatures = allKeys.filter((k) => FEATURE_INFO[k] && FEATURE_INFO[k].role !== "describes").map(featureRow);
  const attributes = allKeys.filter((k) => !FEATURE_INFO[k] || FEATURE_INFO[k].role === "describes").map(featureRow);

  const techKeys = [...new Set([...Object.keys(TECHNIQUE_INFO), ...Object.keys(TECHNIQUE_LABEL)])];
  const techniques = techKeys.map((key) => {
    const info = TECHNIQUE_INFO[key];
    if (!info) undescribed.push(`technika: ${key} (brak wpisu w TECHNIQUE_INFO)`);
    if (!TECHNIQUE_LABEL[key] && !info?.name) undescribed.push(`technika: ${key} (brak nazwy)`);
    return { key, name: TECHNIQUE_LABEL[key] ?? info?.name ?? key, what: info?.what ?? "", shop: SHOP_TECHNIQUES.has(key) };
  });

  const topics = Object.entries(narrative.topics).map(([id, t]) => {
    if (!NARRATIVE_LABEL[id]) undescribed.push(`temat narracji: ${id}`);
    return { id, label: NARRATIVE_LABEL[id] ?? null, sub: Object.keys(t.sub ?? {}) };
  });
  const hooks = Object.keys(narrative.hooks).map((id) => {
    if (!NARRATIVE_LABEL[id]) undescribed.push(`haczyk narracji: ${id}`);
    return { id, label: NARRATIVE_LABEL[id] ?? null };
  });

  return { pivots, linkingFeatures, attributes, techniques, topics, hooks, undescribed };
}

/** Renders the catalog as Markdown (Polish). `date` and `commit` go to the totals section. */
export function renderCatalog(data: CatalogData, config: LinkConfig, date: string, commit: string): string {
  const rules = config.campaignRules;
  const out: string[] = [];
  out.push("# Katalog cech");
  out.push("");
  out.push("Plik generowany: `bun run features:catalog`. Nie edytuj ręcznie.");
  out.push("");
  out.push(`Łączenie działa tak: każdy ślad ma wagę (typ × lista × częstość występowania), a materiały trafiają do jednej kampanii, gdy łączy je mocny ślad albo co najmniej ${rules.minEvidenceKinds} różne rodzaje śladów; ślady „tylko z innym śladem” nigdy nie łączą samodzielnie, a ślady „grupy” łączą tylko podobne kampanie (szczegóły i progi w [METODYKA.md](METODYKA.md)).`);
  out.push("");
  out.push("## 1. Ślady łączące");
  out.push("");
  out.push(`Próg mocnego śladu: ${config.strongThreshold}; minimalny wynik krawędzi: ${config.minLinkScore}; wspólny ślad występujący w więcej niż ${config.maxPivotDf} materiałach jest pomijany (maxPivotDf). Poziom: **kampania** (może łączyć w jedną kampanię), **grupa** (tylko podobne kampanie), **tylko z innym śladem** (wspiera, nie łączy samodzielnie).`);
  out.push("");
  out.push("| Typ | Nazwa | Waga | Poziom | Skąd |");
  out.push("|---|---|---|---|---|");
  for (const p of data.pivots.filter((p) => p.label && p.weight !== null)) {
    const kind = p.similarity ? " (podobieństwo dwóch materiałów)" : "";
    out.push(`| \`${p.type}\` | ${cell(p.label)}${kind} | ${p.weight} | ${p.level} | ${cell(p.origin)}${p.sourceFeatures.length ? ` Cecha materiału: ${cell(p.sourceFeatures.join(", "))}.` : ""} |`);
  }
  out.push("");
  out.push("### Cechy materiału, które łączą albo pomagają");
  out.push("");
  out.push("| Klucz | Nazwa | Rola | Skąd |");
  out.push("|---|---|---|---|");
  for (const f of data.linkingFeatures) out.push(`| \`${f.key}\` | ${cell(f.name)} | ${f.role} | ${cell(f.source)} |`);
  out.push("");
  out.push("## 2. Atrybuty materiału i kampanii");
  out.push("");
  out.push("Opisują materiał, nie łączą go z innymi.");
  out.push("");
  out.push("| Klucz | Nazwa | Skąd |");
  out.push("|---|---|---|");
  for (const f of data.attributes.filter((f) => f.role !== "brak opisu")) out.push(`| \`${f.key}\` | ${cell(f.name)} | ${cell(f.source)} |`);
  out.push("");
  out.push("## 3. Techniki manipulacji");
  out.push("");
  out.push("Pole `techniques[]`. Atrybut i ślad grupy, nie dowód jednej kampanii. Techniki sklepowe tylko opisują stronę sklepu.");
  out.push("");
  out.push("| Klucz | Nazwa | Opis |");
  out.push("|---|---|---|");
  for (const t of data.techniques) out.push(`| \`${t.key}\` | ${cell(t.name)}${t.shop ? " (sklep)" : ""} | ${cell(t.what)} |`);
  out.push("");
  out.push("## 4. Tematy i haczyki narracji");
  out.push("");
  out.push("**Tematy** (o czym jest reklama; w nawiasie podkategorie):");
  out.push("");
  for (const t of data.topics) out.push(`- \`${t.id}\`: ${cell(t.label ?? t.id)}${t.sub.length ? ` (${t.sub.join(", ")})` : ""}`);
  out.push("");
  out.push("**Haczyki** (forma przekazu, niezależna od tematu):");
  out.push("");
  for (const h of data.hooks) out.push(`- \`${h.id}\`: ${cell(h.label ?? h.id)}`);
  out.push("");
  out.push("## Bez opisu");
  out.push("");
  if (data.undescribed.length === 0) out.push("Wszystko w rejestrach ma polską nazwę i opis.");
  else for (const u of data.undescribed) out.push(`- ${u}`);
  out.push("");
  out.push("## 5. Podsumowanie");
  out.push("");
  out.push("| Sekcja | Liczba |");
  out.push("|---|---|");
  out.push(`| Ślady łączące (typy) | ${data.pivots.length} (kampania: ${data.pivots.filter((p) => p.level === "kampania").length}, grupa: ${data.pivots.filter((p) => p.level === "grupa").length}, tylko z innym śladem: ${data.pivots.filter((p) => p.level === "tylko z innym śladem").length}) |`);
  out.push(`| Cechy materiału łączące albo pomagające | ${data.linkingFeatures.length} |`);
  out.push(`| Atrybuty materiału i kampanii | ${data.attributes.length} |`);
  out.push(`| Techniki manipulacji | ${data.techniques.length} |`);
  out.push(`| Tematy narracji | ${data.topics.length} |`);
  out.push(`| Haczyki narracji | ${data.hooks.length} |`);
  out.push(`| Bez opisu | ${data.undescribed.length} |`);
  out.push("");
  out.push(`Wygenerowano: ${date}, commit \`${commit}\`.`);
  out.push("");
  return out.join("\n");
}
