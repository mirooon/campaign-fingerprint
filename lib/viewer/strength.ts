/**
 * One scale of premise strength for the whole GUI (§6.1) and the words for verdict confidence.
 * Strength of a premise: Wysoka / Średnia / Wymaga potwierdzenia / Pominięta (+ "Opis, nie dowód"
 * for attributes). Confidence of a verdict: pewne / prawdopodobne / niepewne. The two scales never
 * share words.
 */
import type { LinkVerdict } from "@/lib/graph/cluster";

export type Strength = "high" | "medium" | "confirm" | "skipped" | "descriptive";

/** Page-kit traits and personas: alone they need a second kind of trace (method.rules). */
export const DEFAULT_KIT_ONLY = ["similar_dom", "comment", "asset", "hidden_fields", "page_template", "favicon", "endpoint", "param_schema", "persona"] as const;

/** Types that never count for a campaign, only for groups of similar campaigns (modus operandi). */
export const FAMILY_ONLY_TYPES = new Set(["technique"]);

/** Below this weight a non-strong premise needs confirmation. */
export const MEDIUM_MIN_WEIGHT = 0.1;

/**
 * KIT_ONLY from campaigns.json → method.rules: the list in parentheses of the campaign rule
 * ("sama cecha zestawu stron lub persona (similar_dom, comment, …) wymaga drugiego rodzaju dowodu").
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

/** Type of a premise: the shared node type or the similarity type (null when the backend did not say). */
export function evidenceType(ev: EvidenceLike): string | null {
  return ev.pivotType ?? ev.edgeType ?? null;
}

/**
 * Level of one premise. Without the type (older backend) the scale has only Wysoka, Średnia and
 * Pominięta.
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
  high: { label: "Wysoka", caption: "łączy samodzielnie", rank: 0 },
  medium: { label: "Średnia", caption: "liczy się razem z innymi", rank: 1 },
  confirm: { label: "Wymaga potwierdzenia", caption: "potrzebny drugi rodzaj śladu", rank: 2 },
  skipped: { label: "Pominięta", caption: "wspólna dla wielu niezależnych stron", rank: 3 },
  descriptive: { label: "Opis, nie dowód", caption: "pomaga filtrować, nie łączy", rank: 4 },
};

export const STRENGTH_ORDER: Strength[] = ["high", "medium", "confirm", "skipped", "descriptive"];

/** Strongest first: by level, then by weight. */
export function sortByStrength<T extends EvidenceLike>(evs: T[], kitOnly?: Set<string>): T[] {
  return [...evs].sort((a, b) => STRENGTH_INFO[evidenceStrength(a, kitOnly)].rank - STRENGTH_INFO[evidenceStrength(b, kitOnly)].rank || b.weight - a.weight);
}

export type Confidence = "certain" | "likely" | "uncertain";

export const CONFIDENCE_INFO: Record<Confidence, { label: string; short: string; rank: number; help: string }> = {
  certain: { label: "pewne", short: "pewne", rank: 0, help: "Najlepsze powiązanie z kampanią ma przesłankę o wysokiej sile." },
  likely: { label: "prawdopodobne", short: "prawdopodobne", rank: 1, help: "Siła powiązania z kampanią wynosi co najmniej 0,5." },
  uncertain: { label: "niepewne (blisko progu)", short: "niepewne", rank: 2, help: "Powiązanie jest słabe albo go nie ma. Warto sprawdzić ręcznie." },
};

/** Campaign rule for a pair (LinkVerdict) in plain Polish. */
export function ruleText(rule: LinkVerdict | string, minLinkScore: number): string {
  switch (rule) {
    case "campaign":
      return "łączy w kampanię";
    case "below":
      return `za słabe: poniżej progu łączenia (${String(minLinkScore).replace(".", ",")})`;
    case "single_kind":
      return "tylko jeden rodzaj śladu, np. sam szablon strony. To wskazuje na podobną kampanię, nie na tę samą";
    case "account_conflict":
      return "różne konta na platformie stron, czyli różni operatorzy";
    default:
      return String(rule);
  }
}
