import { describe, expect, it } from "vitest";
import type { CampaignFamily, NearMiss, NearMissesFile, NearMissRule } from "@/lib/graph/model";
import { apartLine, familyApartLines, nearMissNotes, nearMissRows, notJoinedReason, ONE_KIND_APART, singleMaterialNote, singleMaterialRule } from "./nearMissView";
import { fmtNum } from "./format";
import { NEAR_MISS_RULE_INFO, typeInfo } from "./plain";

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
    expect(row.traces).toEqual([typeInfo("page_template")!.name, typeInfo("hidden_fields")!.name]);
  });

  it("names a trace without a dictionary entry by its kind and marks discounted ones", () => {
    const [row] = nearMissRows(file([pair({ sharedKinds: ["tracker_host", "domain"], discounted: [{ kind: "domain", rule: "domains:cdn.example", factor: 0.02 }] })]));
    expect(row.traces).toContain("tracker_host");
    expect(row.traces).toContain(`${typeInfo("domain")!.name} (discounted trace)`);
  });

  it("no pairs, no rows", () => {
    expect(nearMissRows(file([]))).toEqual([]);
  });
});

describe("nearMissNotes", () => {
  it("one line per campaign the record came close to: 'Close to campaign X, but not joined because …'", () => {
    const notes = nearMissNotes([
      { campaign: "K03", other: "x1", score: 0.4, rule: "account-conflict", reason: "r", sharedKinds: [] },
      { campaign: "K07", other: "x2", score: 0.2, rule: "family-only-kind", reason: "r", sharedKinds: [] },
    ]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(/^Close to campaign K03, but not joined because /);
    expect(notes[0].toLowerCase()).toContain(NEAR_MISS_RULE_INFO["account-conflict"].text.toLowerCase());
  });

  it("nothing when the record has no near misses", () => {
    expect(nearMissNotes(undefined)).toEqual([]);
    expect(nearMissNotes([])).toEqual([]);
  });
});

describe("singleMaterialRule", () => {
  const nm = file([pair({ a: "s1", b: "k1", rule: "kit-only" })]);

  it("takes the rule of the pair from near-misses.json, in either order", () => {
    expect(singleMaterialRule("s1", "k1", nm, undefined)).toBe("kit-only");
    expect(singleMaterialRule("k1", "s1", nm, { other: "s1", rule: "account-conflict" })).toBe("kit-only");
  });

  it("falls back to the rule computed on the server for a pair the list cut, only for the same material", () => {
    expect(singleMaterialRule("s1", "k2", nm, { other: "k2", rule: "account-conflict" })).toBe("account-conflict");
    expect(singleMaterialRule("s1", "k2", null, { other: "k2", rule: "split-by-clustering" })).toBe("split-by-clustering");
    expect(singleMaterialRule("s1", "k2", nm, { other: "k3", rule: "account-conflict" })).toBeNull();
    expect(singleMaterialRule("s1", "k2", null, undefined)).toBeNull();
  });
});

describe("singleMaterialNote", () => {
  const nearest = (score: number) => ({ campaign: "K04", material: "136-x", score });

  it("no link: the material has no links", () => {
    expect(singleMaterialNote(null, 0.15, null)).toBe("No links to other samples.");
  });

  it("below the threshold: short 'below the threshold', no rule", () => {
    expect(singleMaterialNote(nearest(0.1), 0.15, "below-min-score")).toBe(`Closest to campaign K04 (sample 136-x), score ${fmtNum(0.1)}, below the linking threshold ${fmtNum(0.15)}.`);
  });

  it("at or above the threshold: the rule and its reason, worded as 'but not joined because …'", () => {
    const line = singleMaterialNote(nearest(0.9), 0.15, "kit-only");
    expect(line).toBe(`Closest to campaign K04 (sample 136-x), score ${fmtNum(0.9)}, above the linking threshold ${fmtNum(0.15)}, but not joined (rule “${NEAR_MISS_RULE_INFO["kit-only"].term}”) because ${notJoinedReason("kit-only")}`);
    expect(line).toContain(`because ${notJoinedReason("kit-only")}`);
    expect(singleMaterialNote(nearest(0.15), 0.15, "account-conflict")).toContain(`above the linking threshold ${fmtNum(0.15)}, but not joined (rule “${NEAR_MISS_RULE_INFO["account-conflict"].term}”)`);
  });

  it("above the threshold without a recorded rule: says so instead of leaving the score unexplained", () => {
    expect(singleMaterialNote(nearest(0.9), 0.15, null)).toBe(`Closest to campaign K04 (sample 136-x), score ${fmtNum(0.9)}, above the linking threshold ${fmtNum(0.15)}, but not joined. The reason is not in the saved data of this base.`);
  });
});

describe("familyApartLines", () => {
  const family = (apart: string[]): CampaignFamily => ({ id: "R01", campaigns: ["K01", "K02"], members: [], size: 4, topEvidence: [], apart });
  const ip = [{ kind: "ip", rule: "hosting:big", factor: 0.1 }, { kind: "asset", rule: "assets:popular", factor: 0.1 }];

  it("one kind refused as kit-only: the kit counts as one kind, discounted traces outside the kit are named", () => {
    const nm = file([pair({ familyId: "R01", rule: "kit-only", discounted: ip }), pair({ a: "a2", familyId: "R01", rule: "kit-only" }), pair({ a: "a3", familyId: "R02", rule: "too-few-evidence-kinds" })]);
    expect(familyApartLines(family([ONE_KIND_APART]), nm)).toEqual([`only page-kit features link them, counted together as one kind of evidence; ${typeInfo("ip")!.name} discounted as a trace of many sites`]);
  });

  it("without the list, or with another one-kind rule in the group: the stored words with the kit clause", () => {
    const generic = `${ONE_KIND_APART} (page-kit features count together as one kind)`;
    expect(familyApartLines(family([ONE_KIND_APART]), null)).toEqual([generic]);
    const mixed = file([pair({ familyId: "R01", rule: "kit-only" }), pair({ a: "a2", familyId: "R01", rule: "content-only-with-infra" })]);
    expect(familyApartLines(family([ONE_KIND_APART]), mixed)).toEqual([generic]);
  });

  it("other entries stay as stored; an account conflict pair does not count as one kind", () => {
    const conflict = "different page-builder accounts (aaaa…, bbbb…)";
    const nm = file([pair({ familyId: "R01", rule: "account-conflict" }), pair({ a: "a2", familyId: "R01", rule: "kit-only" })]);
    expect(familyApartLines(family([conflict, ONE_KIND_APART, "only the content links them"]), nm)).toEqual([conflict, "only page-kit features link them, counted together as one kind of evidence", "only the content links them"]);
  });
});

describe("apartLine", () => {
  it("explains the one-kind entry and keeps other entries", () => {
    expect(apartLine(ONE_KIND_APART)).toBe("only one kind of evidence links them (page-kit features count together as one kind)");
    expect(apartLine("only the content links them")).toBe("only the content links them");
  });
});
