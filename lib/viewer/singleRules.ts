/**
 * Server side of the reason a material of the base was left alone (card of a one-material campaign). The
 * reason comes first from `near-misses.json`, but that list is cut at `nearMiss.maxPairs`, so a pair may be
 * missing. For those the server asks the backend's own decision, `campaignLinkDecision`, the same call that
 * `findNearMisses` and the material analysis use, on the stored link with the base's weights (as the threshold
 * preview does). Nothing here changes a link, a rule or a campaign.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { campaignLinkDecision, verdictContext } from "@/lib/graph/cluster";
import { mergeConfig, type LinkConfig, type LinkConfigOverride } from "@/lib/graph/config";
import type { CampaignsFile, EvidenceGraph, NearMissRule } from "@/lib/graph/model";
import { DATA_DIR, SAMPLE_BASE } from "./data";
import type { SingleRule } from "./nearMissView";
import { nearestCampaignOf } from "./scale";

/**
 * For each material left alone whose nearest other campaign scores at least `minLinkScore`: that material of
 * the campaign and the rule that refused the link. A link the rules allow but the clustering split is
 * "split-by-clustering", as in `findNearMisses`. Keyed by the material left alone.
 */
export function singleMaterialRules(graph: EvidenceGraph, campaigns: CampaignsFile, config: LinkConfig): Record<string, SingleRule> {
  const { accountOf, infraItems } = verdictContext(graph.nodes);
  const out: Record<string, SingleRule> = {};
  for (const c of campaigns.campaigns) {
    if (c.size > 1 || !c.members[0]) continue;
    const id = c.members[0];
    const nearest = nearestCampaignOf(id, graph.links, campaigns.assignments);
    if (!nearest || nearest.score < campaigns.method.minLinkScore) continue;
    const link = graph.links.find((l) => (l.a === id && l.b === nearest.material) || (l.a === nearest.material && l.b === id));
    if (!link) continue;
    const decision = campaignLinkDecision(link, config, accountOf, infraItems);
    const rule: NearMissRule | null = decision.rule ?? (decision.verdict === "campaign" ? "split-by-clustering" : null);
    if (rule) out[id] = { other: nearest.material, rule };
  }
  return out;
}

/**
 * Weights of the base in the order of `resolveLinkConfigFile` (LINK_CONFIG, `<data>/linking.json`,
 * `<data>/../linking-default.json`, the sample's file only for the sample base), merged over the defaults like
 * `loadLinkConfig`. Kept here on purpose: this module is imported by the page (a Server Component), and the
 * pipeline modules behind those two helpers do not bundle there (Turbopack cannot resolve a dynamic asset URL).
 */
function baseLinkConfig(): LinkConfig {
  const candidates = [path.join(DATA_DIR, "linking.json"), path.join(DATA_DIR, "..", "linking-default.json"), ...(SAMPLE_BASE ? [path.join(DATA_DIR, "sample", "linking.json")] : [])];
  const file = process.env.LINK_CONFIG || candidates.find((f) => existsSync(f));
  if (!file || !existsSync(file)) return mergeConfig(null);
  return mergeConfig(JSON.parse(readFileSync(file, "utf8")) as LinkConfigOverride);
}

/**
 * `singleMaterialRules` with the weights of the base, resolved as the threshold preview and the analysis
 * resolve them (LINK_CONFIG, `<data>/linking.json`, …, built-in defaults). Empty when the weights cannot be
 * read: the cards then say the base does not record the reason, instead of the page failing.
 */
export function loadSingleMaterialRules(graph: EvidenceGraph, campaigns: CampaignsFile): Record<string, SingleRule> {
  try {
    return singleMaterialRules(graph, campaigns, baseLinkConfig());
  } catch (e) {
    console.warn(`[viewer] powody pojedynczych materiałów pominięte: ${(e as Error).message}`);
    return {};
  }
}
