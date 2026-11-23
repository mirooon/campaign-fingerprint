/**
 * One scale of evidence strength for the whole GUI (§6.1) and the words for verdict confidence.
 * Strength of a piece of evidence: High / Medium / Needs corroboration / Discounted (+ "Description, not
 * evidence" for attributes). Confidence of a verdict: certain / likely / uncertain. The two scales never
 * share words.
 */
import type { LinkVerdict } from "@/lib/graph/cluster";

export type Strength = "high" | "medium" | "confirm" | "skipped" | "descriptive";

/** Page-kit traits and personas: alone they need a second kind of trace (method.rules). */
export const DEFAULT_KIT_ONLY = ["similar_dom", "comment", "asset", "hidden_fields", "page_template", "favicon", "endpoint", "param_schema", "persona"] as const;

/** Types that never count for a campaign, only for groups of similar campaigns (modus operandi). */
export const FAMILY_ONLY_TYPES = new Set(["technique"]);

/** Below this weight a piece of evidence that is not strong needs corroboration. */
export const MEDIUM_MIN_WEIGHT = 0.1;

/**
 * KIT_ONLY from campaigns.json → method.rules: the list in parentheses of the campaign rule saying that a
 * page-kit feature or a persona alone needs a second kind of evidence. The pattern matches the Polish wording
 * of older bases ("… (similar_dom, comment, …) wymaga drugiego rodzaju dowodu"), which is stored data.
 * Falls back to the default list when the rules are missing or have another wording.
 */
export function kitOnlyFromRules(rules: string[] | undefined | null): Set<string> {
  for (const r of rules ?? []) {
    if (!/wymaga drugiego rodzaju/i.test(r)) continue;
    const m = /\(([a-z_,\s]+)\)/i.exec(r);
    if (m) {
      const list = m[1].split(",").map((s) => s.trim()).filter(Boolean);
      if (list.length) return new Set(list);
    }
  }
  return new Set(DEFAULT_KIT_ONLY);
}

export interface EvidenceLike {
  strong: boolean;
  discounted: boolean;
  weight: number;
  kind?: "pivot" | "similarity";
  pivotType?: string | null;
  edgeType?: string | null;
}

/** Type of a piece of evidence: the shared node type or the similarity type (null when the backend did not say). */
export function evidenceType(ev: EvidenceLike): string | null {
  return ev.pivotType ?? ev.edgeType ?? null;
}

/**
 * Level of one piece of evidence. Without the type (older backend) the scale has only High, Medium and
 * Discounted.
 */
export function evidenceStrength(ev: EvidenceLike, kitOnly: Set<string> = new Set(DEFAULT_KIT_ONLY)): Strength {
  if (ev.discounted) return "skipped";
  if (ev.strong) return "high";
  const t = evidenceType(ev);
  if (t === null) return "medium";
  if (FAMILY_ONLY_TYPES.has(t)) return "descriptive";
  if (kitOnly.has(t) || ev.weight < MEDIUM_MIN_WEIGHT) return "confirm";
  return "medium";
}

export interface StrengthInfo {
  label: string;
  caption: string;
  /** Lower = stronger (sorting). */
  rank: number;
}

export const STRENGTH_INFO: Record<Strength, StrengthInfo> = {
  high: { label: "High", caption: "links on its own", rank: 0 },
  medium: { label: "Medium", caption: "counts together with others", rank: 1 },
  confirm: { label: "Needs corroboration", caption: "needs a second kind of trace", rank: 2 },
  skipped: { label: "Discounted", caption: "shared by many independent sites", rank: 3 },
  descriptive: { label: "Description, not evidence", caption: "helps to filter, does not link", rank: 4 },
};

export const STRENGTH_ORDER: Strength[] = ["high", "medium", "confirm", "skipped", "descriptive"];

/** Strongest first: by level, then by weight. */
export function sortByStrength<T extends EvidenceLike>(evs: T[], kitOnly?: Set<string>): T[] {
  return [...evs].sort((a, b) => STRENGTH_INFO[evidenceStrength(a, kitOnly)].rank - STRENGTH_INFO[evidenceStrength(b, kitOnly)].rank || b.weight - a.weight);
}

export type Confidence = "certain" | "likely" | "uncertain";

/**
 * Confidence as the GUI shows it: the three levels of the export, plus `no_traces` for a new sample that
 * shares no trace with any known sample. Such a sample is `uncertain` in the CSV and JSON, but on screen
 * "near the threshold" would be wrong: there is no link to put next to the threshold.
 */
export type ShownConfidence = Confidence | "no_traces";

export const CONFIDENCE_INFO: Record<ShownConfidence, { label: string; short: string; rank: number; help: string }> = {
  certain: { label: "certain", short: "certain", rank: 0, help: "The best link to a campaign has a piece of evidence of high strength." },
  likely: { label: "likely", short: "likely", rank: 1, help: "The link strength to the campaign is at least 0.5." },
  uncertain: { label: "uncertain (near the threshold)", short: "uncertain", rank: 2, help: "The link to the campaign is weak or does not cross the threshold. Worth checking by hand." },
  no_traces: { label: "no shared traces with the base", short: "no shared traces", rank: 3, help: "No known sample shares a trace with this sample, so there is no link to assess." },
};

/** Campaign rule for a pair (LinkVerdict) in plain English. */
export function ruleText(rule: LinkVerdict | string, minLinkScore: number): string {
  switch (rule) {
    case "campaign":
      return "links into a campaign";
    case "below":
      return `too weak: below the linking threshold (${String(minLinkScore)})`;
    case "single_kind":
      return "only one kind of trace, e.g. just the page template. This points to a similar campaign, not the same one";
    case "account_conflict":
      return "different page-builder accounts, so different operators";
    default:
      return String(rule);
  }
}
