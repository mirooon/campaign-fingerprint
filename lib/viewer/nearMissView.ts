/**
 * Logic of the "Deliberately not linked" view: rows of the near-miss table, the notes of a new sample
 * card, the reason a sample of the base was left alone, and the "Different" line of a group of similar
 * campaigns. Texts in plain words come from lib/viewer/plain.ts; the data are written by `build-graph`
 * (`near-misses.json`) and `analyze-material` (`MaterialItemResult.nearMisses`).
 */
import { DEFAULT_LINK_CONFIG } from "@/lib/graph/config";
import type { CampaignFamily, NearMissRule, NearMissesFile } from "@/lib/graph/model";
import type { MaterialNearMiss } from "@/lib/graph/nearMiss";
import { fmtNum } from "./format";
import { NEAR_MISS_RULE_INFO, typeInfo } from "./plain";

export interface NearMissRow {
  a: string;
  b: string;
  score: number;
  /** Shared traces by their names in the GUI; a trace weakened by a discount is marked "discounted trace". */
  traces: string[];
  rule: NearMissRule;
  ruleName: string;
  /** Why the method did not join the pair, in plain words. */
  reasonPlain: string;
}

/** Rows for the table, in the order of the file (strongest first): pair, score, shared traces, rule, plain reason. */
export function nearMissRows(file: NearMissesFile): NearMissRow[] {
  return file.pairs.map((p) => {
    const discounted = new Set(p.discounted.map((d) => d.kind));
    return {
      a: p.a,
      b: p.b,
      score: p.score,
      traces: p.sharedKinds.map((k) => `${typeInfo(k)?.name ?? k}${discounted.has(k) ? " (discounted trace)" : ""}`),
      rule: p.rule,
      ruleName: NEAR_MISS_RULE_INFO[p.rule].term,
      reasonPlain: NEAR_MISS_RULE_INFO[p.rule].text,
    };
  });
}

/** Lines for the card of a new sample: "Close to campaign X, but not joined because …", one per known campaign; none for a record without near misses. */
export function nearMissNotes(nearMisses: MaterialNearMiss[] | undefined): string[] {
  return (nearMisses ?? []).map((n) => `Close to campaign ${n.campaign}, but not joined because ${notJoinedReason(n.rule)}`);
}

/** Plain reason of a rule that continues "…, but not joined because ": its explanation with a lower-case first letter. */
export function notJoinedReason(rule: NearMissRule): string {
  return lowerFirst(NEAR_MISS_RULE_INFO[rule].text);
}

/** The sentence with a lower-case first letter, so it continues "… because ". */
function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Rule the server computed for the link of a material left alone to its nearest campaign (`other` is the material of that campaign). */
export interface SingleRule {
  other: string;
  rule: NearMissRule;
}

/** Nearest other campaign of a material: the campaign, its material with the highest score, and that score. */
export interface NearestCampaign {
  campaign: string;
  material: string;
  score: number;
}

/**
 * Rule that kept a material left alone out of its nearest campaign: the rule of the pair in `near-misses.json`
 * (the data of the "Deliberately not linked" tab); for a pair cut from that list, the rule the server computed for
 * the same pair (`computed`, see singleRules.ts); null when neither has it.
 */
export function singleMaterialRule(material: string, other: string, file: NearMissesFile | null, computed: SingleRule | undefined): NearMissRule | null {
  const pair = file?.pairs.find((p) => (p.a === material && p.b === other) || (p.a === other && p.b === material));
  if (pair) return pair.rule;
  return computed?.other === other ? computed.rule : null;
}

/**
 * Line on the card of a sample left alone. Without links: "No links to other samples.". Below the link
 * threshold: the nearest campaign, its score and "below the linking threshold". At or above the threshold: the rule
 * that held the sample back and its reason, in the words of the analysis card ("…, but not joined because …");
 * a plain admission when the base does not record the rule.
 */
export function singleMaterialNote(nearest: NearestCampaign | null, minLinkScore: number, rule: NearMissRule | null): string {
  if (!nearest) return "No links to other samples.";
  const head = `Closest to campaign ${nearest.campaign} (sample ${nearest.material}), score ${fmtNum(nearest.score)}`;
  if (nearest.score < minLinkScore) return `${head}, below the linking threshold ${fmtNum(minLinkScore)}.`;
  const over = `${head}, above the linking threshold ${fmtNum(minLinkScore)}, but not joined`;
  return rule ? `${over} (rule “${NEAR_MISS_RULE_INFO[rule].term}”) because ${notJoinedReason(rule)}` : `${over}. The reason is not in the saved data of this base.`;
}

/** "Different" entry the base stores for a link between campaigns refused as one kind of evidence (`buildFamilies`, cluster.ts). */
export const ONE_KIND_APART = "only one kind of evidence links them";

/** One stored "Kept apart because" entry in plain words: the one-kind entry gets the kit clause, other entries stay as stored. */
export function apartLine(entry: string): string {
  return entry === ONE_KIND_APART ? `${ONE_KIND_APART} (page-kit features count together as one kind)` : entry;
}

/** Rules of a link refused as one kind of evidence (verdict "single_kind" of `campaignLinkDecision`). */
const SINGLE_KIND_RULES: ReadonlySet<NearMissRule> = new Set(["discounted-only", "kit-only", "content-only-with-infra", "too-few-content-kinds", "too-few-evidence-kinds"]);

/** Page-kit trace kinds (`campaignRules.notAloneKinds`): a discounted one is still the kit, so it is not named as left out. */
const KIT_KINDS: ReadonlySet<string> = new Set(DEFAULT_LINK_CONFIG.campaignRules.notAloneKinds);

/**
 * "Different" of a group of similar campaigns in plain words. The base stores "only one kind of evidence links them",
 * while "Shared" may list three traces: page-kit traces count together as one kind and traces shared by many
 * sites are discounted. When every pair of the group refused as one kind in `near-misses.json` is "kit-only",
 * the entry says the kit counts as one kind and names the discounted traces outside the kit (e.g. "IP address");
 * otherwise (no file, no such pair, other rules) it keeps the stored words with the kit clause. Other entries
 * ("different page-builder accounts…", "only the content…") stay as stored. Display only: the base files and the rules are unchanged.
 */
export function familyApartLines(family: CampaignFamily, file: NearMissesFile | null): string[] {
  const pairs = (file?.pairs ?? []).filter((p) => p.familyId === family.id && SINGLE_KIND_RULES.has(p.rule));
  const kitOnly = pairs.length > 0 && pairs.every((p) => p.rule === "kit-only");
  const discounted = [...new Set(pairs.flatMap((p) => p.discounted.filter((d) => !KIT_KINDS.has(d.kind)).map((d) => typeInfo(d.kind)?.name ?? d.kind)))].slice(0, 3);
  const oneKind = kitOnly
    ? `only page-kit features link them, counted together as one kind of evidence${discounted.length ? `; ${discounted.join(", ")} discounted as a trace of many sites` : ""}`
    : apartLine(ONE_KIND_APART);
  return family.apart.map((a) => (a === ONE_KIND_APART ? oneKind : a));
}
