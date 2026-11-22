/**
 * Readability of a verdict (B-022): where the best score of a material falls against the two thresholds
 * (joining into a campaign, and into a group of similar campaigns), and the one-line reason when a rule
 * changed the outcome ("wynik ponad progiem, ale różne konta, więc grupa podobnych"). Pure functions.
 */
import type { MaterialItemResult, MaterialLink } from "@/lib/pipeline/analyzeMaterial";
import { fmtNum } from "./format";

/** Threshold of a group of similar campaigns when the base does not state it (`familyMinScore` of the weights). */
export const DEFAULT_FAMILY_MIN_SCORE = 0.3;

export interface ScaleThresholds {
  /** `minLinkScore`: from here materials may join one campaign. */
  campaign: number;
  /** `familyMinScore`: from here campaigns of different operators form a group of similar campaigns. */
  family: number;
}

export type Zone = "new" | "family" | "campaign";

export interface VerdictScale {
  zone: Zone;
  /** The known material with the highest score, whatever the rule made of it; null when there is none. */
  closest: { id: string; score: number } | null;
  thresholds: ScaleThresholds;
  sentence: string;
}

/** Name of each zone of the scale in the interface. */
export const ZONE_LABEL: Record<Zone, string> = { new: "nowy wzorzec", family: "grupa podobnych", campaign: "kampania" };

/** Why a link above the campaign threshold still does not make a campaign, as a clause of a sentence. */
const RULE_REASON: Record<string, string> = {
  single_kind: "to tylko jeden rodzaj śladu (np. sam szablon strony)",
  account_conflict: "to różne konta na platformie stron, czyli różni operatorzy",
  below: "jest za słaby",
};

/** Link with the highest score to a known material (also one below the threshold), or null without links. */
export function closestLink(item: MaterialItemResult): MaterialLink | null {
  return [...item.links].sort((a, b) => b.score - a.score)[0] ?? null;
}

/** Family threshold from the base's rule descriptions ("… ≥ 0.3"); the default when the base does not give it. */
export function familyThresholdFromRules(rules: string[] | undefined | null): number {
  const rule = (rules ?? []).find((r) => r.startsWith("grupa podobnych kampanii"));
  const m = rule?.match(/≥\s*(\d+(?:[.,]\d+)?)\s*$/);
  return m ? Number(m[1].replace(",", ".")) : DEFAULT_FAMILY_MIN_SCORE;
}

/**
 * Zone, closest material and the sentence for a material: for a new pattern the closest known material with
 * its score and the campaign threshold; for a known campaign the score against the threshold; for a group of
 * similar campaigns the score and the rule that kept it from the campaign ("jeden rodzaj śladu", "różne konta").
 */
export function verdictScale(item: MaterialItemResult, thresholds: ScaleThresholds): VerdictScale {
  const best = closestLink(item);
  const closest = best ? { id: best.other, score: best.score } : null;
  const campaignT = fmtNum(thresholds.campaign);
  if (item.verdict === "known_campaign" || item.verdict === "duplicate") {
    return { zone: "campaign", closest, thresholds, sentence: best ? `Wynik ${fmtNum(best.score)} z materiałem ${best.other} przekracza próg łączenia w kampanię ${campaignT}.` : "Materiał należy do kampanii bez osobnego wyniku (duplikat)." };
  }
  if (item.verdict === "similar_campaigns" && best) {
    const reason = RULE_REASON[best.rule] ?? `reguła „${best.rule}” go nie przepuszcza`;
    const over = best.score >= thresholds.campaign;
    const head = over
      ? `Wynik ${fmtNum(best.score)} jest ponad progiem łączenia w kampanię (${campaignT}), ale ${reason}, więc to`
      : `Wynik ${fmtNum(best.score)} jest poniżej progu łączenia w kampanię (${campaignT}), ale ponad progiem grupy podobnych (${fmtNum(thresholds.family)}), więc to`;
    return { zone: "family", closest, thresholds, sentence: `${head} grupa podobnych kampanii, nie ta sama kampania.` };
  }
  return {
    zone: "new",
    closest,
    thresholds,
    sentence: best ? `Najbliższy znany materiał (${best.other}${best.otherCampaign ? `, kampania ${best.otherCampaign}` : ""}) ma wynik ${fmtNum(best.score)}, próg łączenia w kampanię to ${campaignT}.` : "Żaden znany materiał nie ma wspólnego śladu z tym materiałem.",
  };
}

/**
 * The campaign nearest to a material that is outside it: the highest-scoring link of the material to a member of
 * another campaign. `links` are the pairs of the graph, `assignments` maps a material to its campaign. Null when the
 * material has no link to another campaign.
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
