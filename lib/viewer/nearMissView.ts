/**
 * Logic of the "Celowo nie połączone" view: rows of the near-miss table and the notes of a new material
 * card. Texts in plain words come from lib/viewer/plain.ts; the data are written by `build-graph`
 * (`near-misses.json`) and `analyze-material` (`MaterialItemResult.nearMisses`).
 */
import type { NearMissRule, NearMissesFile } from "@/lib/graph/model";
import type { MaterialNearMiss } from "@/lib/graph/nearMiss";
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
  return (nearMisses ?? []).map((n) => `Blisko kampanii ${n.campaign}, ale nie dołączony, bo ${lowerFirst(NEAR_MISS_RULE_INFO[n.rule].text)}`);
}

/** The sentence with a lower-case first letter, so it continues "…, bo ". */
function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
