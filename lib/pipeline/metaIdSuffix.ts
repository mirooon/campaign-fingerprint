/**
 * Measurement of the hypothesis that the last four digits of Meta identifiers (campaign, ad set, ad, `adid` of
 * an fbclid) agree within one operator's account (B-349, open question O-18). The hypothesis is measured
 * before it is used: how often the suffixes of one case agree, how often suffixes of different cases coincide,
 * and how many coincidences chance alone would give. Only when the coincidences between cases exceed chance
 * and match the same ad accounts of the ad library may a weak `meta_id_suffix` attribute be added to
 * `notAloneKinds`. Pure functions; the CLI is scripts/meta-id-suffix.ts.
 */

/** Meta identifiers: 15 to 20 digits. */
const META_ID = /^\d{15,20}$/;

/** Result of the measurement. */
export interface MetaIdSuffixReport {
  /** Cases with at least two Meta identifiers. */
  casesWithTwoIds: number;
  /** Of those, the cases whose identifiers all share the same last four digits. */
  casesInAgreement: number;
  /** Cases with at least one identifier. */
  casesWithId: number;
  /** Pairs of cases sharing a suffix although they differ in the identifiers. */
  crossCasePairs: number;
  /** Pairs of cases compared. */
  pairsCompared: number;
  /** Expected number of such pairs when the suffixes are random (pairs / 10 000). */
  expectedByChance: number;
  /** The pairs: `[caseA, caseB, suffix]`. */
  coincidences: Array<[string, string, string]>;
}

/** Last four digits of an identifier, or null when it is not a Meta identifier. */
export function metaIdSuffix(id: string): string | null {
  return META_ID.test(id) ? id.slice(-4) : null;
}

/**
 * The report for `cases`: case key to its Meta identifiers. Pairs are counted by the first suffix of each case
 * and only when the cases share no identifier (the same ad is not a coincidence).
 */
export function metaIdSuffixReport(cases: Map<string, string[]>): MetaIdSuffixReport {
  const keys = [...cases.keys()].sort();
  const ids = new Map(keys.map((k) => [k, [...new Set((cases.get(k) ?? []).filter((i) => metaIdSuffix(i)))]]));
  const withId = keys.filter((k) => (ids.get(k) ?? []).length > 0);
  const two = withId.filter((k) => (ids.get(k) ?? []).length >= 2);
  const agree = two.filter((k) => new Set((ids.get(k) ?? []).map((i) => i.slice(-4))).size === 1);
  const coincidences: Array<[string, string, string]> = [];
  let pairs = 0;
  for (let i = 0; i < withId.length; i++) {
    for (let j = i + 1; j < withId.length; j++) {
      const a = ids.get(withId[i]) ?? [];
      const b = ids.get(withId[j]) ?? [];
      if (a.some((x) => b.includes(x))) continue;
      pairs++;
      const sa = new Set(a.map((x) => x.slice(-4)));
      const shared = b.map((x) => x.slice(-4)).find((s) => sa.has(s));
      if (shared) coincidences.push([withId[i], withId[j], shared]);
    }
  }
  return { casesWithTwoIds: two.length, casesInAgreement: agree.length, casesWithId: withId.length, crossCasePairs: coincidences.length, pairsCompared: pairs, expectedByChance: pairs / 10_000, coincidences };
}
