/**
 * Seed recipes: search recipes made from the base itself. For every campaign of two or more records, its strong
 * pivots that are not down-weighted (an IP outside a CDN, a distinctive file, a path identifier) become urlscan
 * queries, so the scheduler looks for new pages that share infrastructure with a known campaign. The output holds
 * the values of real campaigns, so it is written outside the repository (`--seed-recipes`). Pure.
 */
import type { CampaignsFile, EntityType, EvidenceGraph, GraphNode } from "../graph/model";
import type { WatchRecipe } from "./recipes";

/** urlscan query for a pivot of the given type, or null when urlscan has no way to search that kind of trait. */
const QUERIES: Partial<Record<EntityType, (key: string) => string | null>> = {
  ip: (key) => `page.ip:"${key}"`,
  asset: (key) => (key.startsWith("/") ? `filename:"${key.replace(/(["\\])/g, "\\$1")}"` : null),
  path_id: (key) => `page.url:*${key}*`,
};

/** How often a seed recipe is asked. */
const SEED_EVERY = "1d";

/**
 * One urlscan recipe per distinct strong, undiscounted pivot (held by at least two records) of each campaign with two
 * or more records. A pivot shared by several campaigns is listed once, under the first. A certificate is left out:
 * urlscan cannot be searched by it (certificates are the CT source's job).
 */
export function seedRecipes(graph: EvidenceGraph, campaigns: CampaignsFile): WatchRecipe[] {
  const nodeById = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const out: WatchRecipe[] = [];
  for (const c of campaigns.campaigns) {
    if (c.size < 2) continue;
    for (const e of c.topEvidence) {
      const node = nodeById.get(e.key);
      const query = node && e.count >= 2 && node.strong && !node.discounts.length ? QUERIES[node.type]?.(node.key) : null;
      if (!node || !query || seen.has(query)) continue;
      seen.add(query);
      out.push({ id: `ziarno-${c.id}-${node.type}-${out.length + 1}`, description: `campaign ${c.id}: ${node.type} ${node.key} (from the base)`, source: "urlscan", query, every: SEED_EVERY });
    }
  }
  return out;
}
