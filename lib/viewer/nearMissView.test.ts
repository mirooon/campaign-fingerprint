import { describe, expect, it } from "vitest";
import type { NearMiss, NearMissesFile, NearMissRule } from "@/lib/graph/model";
import { nearMissNotes, nearMissRows } from "./nearMissView";
import { NEAR_MISS_RULE_INFO } from "./plain";

const RULES: NearMissRule[] = ["below-min-score", "family-only-kind", "account-conflict", "discounted-only", "kit-only", "content-only-with-infra", "too-few-content-kinds", "too-few-evidence-kinds", "split-by-clustering"];

const pair = (over: Partial<NearMiss>): NearMiss => ({
  a: "a1",
  b: "b1",
  score: 0.4,
  rule: "kit-only",
  reason: "zdanie z danymi",
  sharedKinds: ["page_template", "hidden_fields"],
  discounted: [],
  selectedBy: ["score"],
  campaignA: "K01",
  campaignB: "K02",
  familyId: null,
  ...over,
});
const file = (pairs: NearMiss[]): NearMissesFile => ({ version: 1, generatedAt: "2026-01-01T00:00:00.000Z", minLinkScore: 0.15, minScoreRatio: 0.5, maxPairs: 200, total: pairs.length, byRule: {}, pairs });

describe("near-miss rules in plain words", () => {
  it("every rule has a term, an explanation, a reason and an example", () => {
    for (const r of RULES) {
      const i = NEAR_MISS_RULE_INFO[r];
      expect(i.term && i.text && i.why && i.example, r).toBeTruthy();
    }
  });
});

describe("nearMissRows", () => {
  it("one row per pair: scores, shared traces by their names in the GUI, the rule and the plain reason", () => {
    const [row] = nearMissRows(file([pair({})]));
    expect(row).toMatchObject({ a: "a1", b: "b1", score: 0.4, rule: "kit-only", ruleName: NEAR_MISS_RULE_INFO["kit-only"].term, reasonPlain: NEAR_MISS_RULE_INFO["kit-only"].text });
    expect(row.traces).toEqual(["Szablon strony na platformie", "Ukryte pola formularza"]);
  });

  it("names a trace without a dictionary entry by its kind and marks discounted ones", () => {
    const [row] = nearMissRows(file([pair({ sharedKinds: ["tracker_host", "domain"], discounted: [{ kind: "domain", rule: "domains:cdn.example", factor: 0.02 }] })]));
    expect(row.traces).toContain("tracker_host");
    expect(row.traces).toContain("Domena (pominięty ślad)");
  });

  it("no pairs, no rows", () => {
    expect(nearMissRows(file([]))).toEqual([]);
  });
});

describe("nearMissNotes", () => {
  it("one line per campaign the record came close to: 'Blisko kampanii X, ale nie dołączony, bo …'", () => {
    const notes = nearMissNotes([
      { campaign: "K03", other: "x1", score: 0.4, rule: "account-conflict", reason: "r", sharedKinds: [] },
      { campaign: "K07", other: "x2", score: 0.2, rule: "family-only-kind", reason: "r", sharedKinds: [] },
    ]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(/^Blisko kampanii K03, ale nie dołączony, bo /);
    expect(notes[0].toLowerCase()).toContain(NEAR_MISS_RULE_INFO["account-conflict"].text.toLowerCase());
  });

  it("nothing when the record has no near misses", () => {
    expect(nearMissNotes(undefined)).toEqual([]);
    expect(nearMissNotes([])).toEqual([]);
  });
});
