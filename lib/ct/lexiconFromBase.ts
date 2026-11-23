/**
 * Brands for the CT watcher taken from the base itself: the brand a campaign's pages impersonate and the name of the
 * scam's own landing page or platform campaign. The watcher then recognises a new domain that carries such a name
 * together with a word of the same campaign. Pure; `base` writes the file, the watchers read it.
 */
import type { EvidenceGraph } from "../graph/model";

/** Item-node fields that hold a brand or a scam name. */
const BRAND_FIELDS = ["impersonatedBrand", "landingName", "platformCampaignName"] as const;

/** Shortest name kept: shorter ones match everything. */
const MIN_NAME_CHARS = 3;

/** Text with runs of whitespace collapsed and the ends trimmed. */
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Brands of the item nodes, de-duplicated ignoring case and spacing (first spelling kept), sorted. */
export function lexiconFromGraph(graph: EvidenceGraph): { brands: string[] } {
  const byKey = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.type !== "item") continue;
    for (const field of BRAND_FIELDS) {
      const value = node.data[field];
      if (typeof value !== "string") continue;
      const name = collapse(value);
      if (name.length >= MIN_NAME_CHARS && !byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name);
    }
  }
  return { brands: [...byKey.values()].sort((a, b) => a.localeCompare(b)) };
}

/** The lexicon file (`ct-lexicon.json` of a base), in the format `loadCtConfig` reads. */
export function ctLexiconFile(brands: string[], now: Date): { _comment: string; lexicon: { brands: string[] } } {
  return { _comment: `Generated from the base ${now.toISOString()}: impersonated brands and lander names of the campaigns (lib/ct/lexiconFromBase.ts). Do not edit: the next bun run base overwrites the file.`, lexicon: { brands } };
}
