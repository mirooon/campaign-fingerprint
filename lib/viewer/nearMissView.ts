/**
 * Logic of the "Celowo nie połączone" view: rows of the near-miss table, the notes of a new material
 * card, the reason a material of the base was left alone, and the "Różne" line of a group of similar
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
  /** Shared traces by their names in the GUI; a trace weakened by a discount is marked "pominięty ślad". */
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
      traces: p.sharedKinds.map((k) => `${typeInfo(k)?.name ?? k}${discounted.has(k) ? " (pominięty ślad)" : ""}`),
      rule: p.rule,
      ruleName: NEAR_MISS_RULE_INFO[p.rule].term,
      reasonPlain: NEAR_MISS_RULE_INFO[p.rule].text,
    };
  });
}

/** Lines for the card of a new material: "Blisko kampanii X, ale nie dołączony, bo …", one per known campaign; none for a record without near misses. */
export function nearMissNotes(nearMisses: MaterialNearMiss[] | undefined): string[] {
  return (nearMisses ?? []).map((n) => `Blisko kampanii ${n.campaign}, ale nie dołączony, bo ${notJoinedReason(n.rule)}`);
}

/** Plain reason of a rule that continues "…, ale nie dołączony, bo ": its explanation with a lower-case first letter. */
export function notJoinedReason(rule: NearMissRule): string {
  return lowerFirst(NEAR_MISS_RULE_INFO[rule].text);
}

/** The sentence with a lower-case first letter, so it continues "…, bo ". */
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
 * (the data of the "Celowo nie połączone" tab); for a pair cut from that list, the rule the server computed for
 * the same pair (`computed`, see singleRules.ts); null when neither has it.
 */
export function singleMaterialRule(material: string, other: string, file: NearMissesFile | null, computed: SingleRule | undefined): NearMissRule | null {
  const pair = file?.pairs.find((p) => (p.a === material && p.b === other) || (p.a === other && p.b === material));
  if (pair) return pair.rule;
  return computed?.other === other ? computed.rule : null;
}

/**
 * Line on the card of a material left alone. Without links: "Bez powiązań z innymi materiałami.". Below the link
 * threshold: the nearest campaign, its score and "poniżej progu łączenia". At or above the threshold: the rule
 * that held the material back and its reason, in the words of the analysis card ("…, ale nie dołączony, bo …");
 * a plain admission when the base does not record the rule.
 */
export function singleMaterialNote(nearest: NearestCampaign | null, minLinkScore: number, rule: NearMissRule | null): string {
  if (!nearest) return "Bez powiązań z innymi materiałami.";
  const head = `Najbliżej kampanii ${nearest.campaign} (materiał ${nearest.material}), wynik ${fmtNum(nearest.score)}`;
  if (nearest.score < minLinkScore) return `${head} poniżej progu łączenia ${fmtNum(minLinkScore)}.`;
  const over = `${head} ponad progiem łączenia ${fmtNum(minLinkScore)}, ale nie dołączony`;
  return rule ? `${over} (reguła „${NEAR_MISS_RULE_INFO[rule].term}”), bo ${notJoinedReason(rule)}` : `${over}. Powodu nie ma w zapisanych danych tej bazy.`;
}

/** "Różne" entry the base stores for a link between campaigns refused as one kind of evidence (`buildFamilies`, cluster.ts). */
export const ONE_KIND_APART = "only one kind of evidence links them";

/** One stored "Osobno, bo" entry in plain words: the one-kind entry gets the kit clause, other entries stay as stored. */
export function apartLine(entry: string): string {
  return entry === ONE_KIND_APART ? `${ONE_KIND_APART} (cechy zestawu stron liczą się razem jako jeden rodzaj)` : entry;
}

/** Rules of a link refused as one kind of evidence (verdict "single_kind" of `campaignLinkDecision`). */
const SINGLE_KIND_RULES: ReadonlySet<NearMissRule> = new Set(["discounted-only", "kit-only", "content-only-with-infra", "too-few-content-kinds", "too-few-evidence-kinds"]);

/** Page-kit trace kinds (`campaignRules.notAloneKinds`): a discounted one is still the kit, so it is not named as left out. */
const KIT_KINDS: ReadonlySet<string> = new Set(DEFAULT_LINK_CONFIG.campaignRules.notAloneKinds);

/**
 * "Różne" of a group of similar campaigns in plain words. The base stores "łączy je tylko jeden rodzaj dowodu",
 * while "Wspólne" may list three traces: page-kit traces count together as one kind and traces shared by many
 * sites are discounted. When every pair of the group refused as one kind in `near-misses.json` is "kit-only",
 * the entry says the kit counts as one kind and names the discounted traces outside the kit (e.g. "Adres IP");
 * otherwise (no file, no such pair, other rules) it keeps the stored words with the kit clause. Other entries
 * ("różne konta…", "tylko treść") stay as stored. Display only: the base files and the rules are unchanged.
 */
export function familyApartLines(family: CampaignFamily, file: NearMissesFile | null): string[] {
  const pairs = (file?.pairs ?? []).filter((p) => p.familyId === family.id && SINGLE_KIND_RULES.has(p.rule));
  const kitOnly = pairs.length > 0 && pairs.every((p) => p.rule === "kit-only");
  const discounted = [...new Set(pairs.flatMap((p) => p.discounted.filter((d) => !KIT_KINDS.has(d.kind)).map((d) => typeInfo(d.kind)?.name ?? d.kind)))].slice(0, 3);
  const oneKind = kitOnly
    ? `łączą je tylko cechy zestawu stron, liczone razem jako jeden rodzaj dowodu${discounted.length ? `; ${discounted.join(", ")} pominięto jako ślad wielu stron` : ""}`
    : apartLine(ONE_KIND_APART);
  return family.apart.map((a) => (a === ONE_KIND_APART ? oneKind : a));
}
