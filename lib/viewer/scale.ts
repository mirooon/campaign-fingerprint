/**
 * Readability of a verdict (B-022): where the best score of a sample falls against the two thresholds
 * (joining into a campaign, and into a group of similar campaigns), and the one-line reason when a rule
 * changed the outcome ("score above the threshold, but different accounts, so a similar-campaign group"). Pure functions.
 */
import type { MaterialItemResult, MaterialLink } from "@/lib/pipeline/analyzeMaterial";
import { fmtNum } from "./format";

/** Threshold of a group of similar campaigns when the base does not state it (`familyMinScore` of the weights). */
export const DEFAULT_FAMILY_MIN_SCORE = 0.3;

export interface ScaleThresholds {
  /** `minLinkScore`: from here samples may join one campaign. */
  campaign: number;
  /** `familyMinScore`: from here campaigns of different operators form a group of similar campaigns. */
  family: number;
}

export type Zone = "new" | "family" | "campaign";

export interface VerdictScale {
  zone: Zone;
  /** The known sample with the highest score, whatever the rule made of it; null when there is none. */
  closest: { id: string; score: number } | null;
  thresholds: ScaleThresholds;
  sentence: string;
}

/** Name of each zone of the scale in the interface. */
export const ZONE_LABEL: Record<Zone, string> = { new: "new pattern", family: "similar-campaign group", campaign: "campaign" };

/** Why a link above the campaign threshold still does not make a campaign, as a clause of a sentence. */
const RULE_REASON: Record<string, string> = {
  single_kind: "it is only one kind of trace (e.g. a page template alone)",
  account_conflict: "these are different page-builder accounts, i.e. different operators",
  below: "it is too weak",
};

/** Link with the highest score to a known sample (also one below the threshold), or null without links. */
export function closestLink(item: MaterialItemResult): MaterialLink | null {
  return [...item.links].sort((a, b) => b.score - a.score)[0] ?? null;
}

/** Family threshold from the base's rule descriptions ("… ≥ 0.3"); the default when the base does not give it. */
export function familyThresholdFromRules(rules: string[] | undefined | null): number {
  const rule = (rules ?? []).find((r) => r.startsWith("group of similar campaigns"));
  const m = rule?.match(/≥\s*(\d+(?:[.,]\d+)?)\s*$/);
  return m ? Number(m[1].replace(",", ".")) : DEFAULT_FAMILY_MIN_SCORE;
}

/**
 * Zone, closest sample and the sentence for a sample: for a new pattern the closest known sample with
 * its score and the campaign threshold; for a known campaign the score against the threshold; for a group of
 * similar campaigns the score and the rule that kept it from the campaign ("one kind of trace", "different accounts").
 */
export function verdictScale(item: MaterialItemResult, thresholds: ScaleThresholds): VerdictScale {
  const best = closestLink(item);
  const closest = best ? { id: best.other, score: best.score } : null;
  const campaignT = fmtNum(thresholds.campaign);
  if (item.verdict === "known_campaign" || item.verdict === "duplicate") {
    return { zone: "campaign", closest, thresholds, sentence: best ? `Score ${fmtNum(best.score)} with sample ${best.other} exceeds the campaign linking threshold ${campaignT}.` : "The sample belongs to the campaign without a score of its own (duplicate)." };
  }
  if (item.verdict === "similar_campaigns" && best) {
    const reason = RULE_REASON[best.rule] ?? `rule “${best.rule}” does not let it through`;
    const over = best.score >= thresholds.campaign;
    const head = over
      ? `Score ${fmtNum(best.score)} is above the campaign linking threshold (${campaignT}), but ${reason}, so this is`
      : `Score ${fmtNum(best.score)} is below the campaign linking threshold (${campaignT}), but above the similar-campaign group threshold (${fmtNum(thresholds.family)}), so this is`;
    return { zone: "family", closest, thresholds, sentence: `${head} a group of similar campaigns, not the same campaign.` };
  }
  return {
    zone: "new",
    closest,
    thresholds,
    sentence: best ? `The closest known sample (${best.other}${best.otherCampaign ? `, campaign ${best.otherCampaign}` : ""}) has a score of ${fmtNum(best.score)}; the campaign linking threshold is ${campaignT}.` : "No known sample shares a trace with this sample.",
  };
}

/**
 * The campaign nearest to a sample that is outside it: the highest-scoring link of the sample to a member of
 * another campaign. `links` are the pairs of the graph, `assignments` maps a sample to its campaign. Null when the
 * sample has no link to another campaign.
 */
export function nearestCampaignOf(materialId: string, links: Array<{ a: string; b: string; score: number }>, assignments: Record<string, string>): { campaign: string; material: string; score: number } | null {
  const own = assignments[materialId];
  let best: { campaign: string; material: string; score: number } | null = null;
  for (const l of links) {
    const other = l.a === materialId ? l.b : l.b === materialId ? l.a : null;
    const campaign = other ? assignments[other] : undefined;
    if (!other || !campaign || campaign === own) continue;
    if (!best || l.score > best.score) best = { campaign, material: other, score: l.score };
  }
  return best;
}
