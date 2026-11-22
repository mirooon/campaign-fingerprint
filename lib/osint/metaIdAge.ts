/**
 * Approximate creation date of a Meta ad from its identifier (B-343). Identifiers that start with 1202 grow
 * with time, so an id between two ids of known date gets a date by linear interpolation. The anchors come from
 * the cases of the same dataset (an ad with an id and a first-shown date from the ad library); an id outside the
 * range of the anchors, or fewer than two anchors, gives no date. The result is an attribute for the timeline of
 * a campaign, never a trace. Pure functions.
 */

/** A known pair: identifier and its date (ISO, `YYYY-MM-DD` or longer). */
export interface MetaIdAnchor {
  id: string;
  date: string;
}

/** Shape of the identifiers that are time-ordered: 1202 followed by 14 digits (18 digits in all). */
const TIMED_ID = /^1202\d{14}$/;

/** Whether the string is an identifier whose size follows time. */
export function isTimedMetaId(id: string): boolean {
  return TIMED_ID.test(id ?? "");
}

/**
 * Date (`YYYY-MM-DD`) of `id` interpolated between the two nearest anchors, or null (no anchors on both sides,
 * an id of another shape, anchors that disagree about the order of ids and dates).
 */
export function adCreatedApprox(id: string, anchors: MetaIdAnchor[]): string | null {
  if (!isTimedMetaId(id)) return null;
  const pts = anchors
    .filter((a) => isTimedMetaId(a.id) && Number.isFinite(Date.parse(a.date)))
    .map((a) => ({ n: BigInt(a.id), t: Date.parse(a.date) }))
    .sort((x, y) => (x.n < y.n ? -1 : x.n > y.n ? 1 : 0));
  const n = BigInt(id);
  let lo: (typeof pts)[number] | null = null;
  let hi: (typeof pts)[number] | null = null;
  for (const p of pts) {
    if (p.n <= n) lo = p;
    else if (!hi) hi = p;
  }
  if (!lo || !hi) return null;
  if (hi.t < lo.t) return null;
  const span = hi.n - lo.n;
  const frac = span === 0n ? 0 : Number(((n - lo.n) * 1_000_000n) / span) / 1_000_000;
  return new Date(lo.t + frac * (hi.t - lo.t)).toISOString().slice(0, 10);
}
