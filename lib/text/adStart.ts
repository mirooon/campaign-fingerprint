/**
 * Weekday and hour an ad started (I28, B-357): from the first-shown date of the ad library. Campaigns of
 * one operator often start on the same day of the week and at the same hour, so the distribution over a
 * campaign is a description of the operator's rhythm for the reviewer, never a link. Pure functions.
 */

export interface AdStart {
  /** Day of the week, Monday = 0 … Sunday = 6, in UTC. */
  weekday: number;
  /** Hour 0–23 in UTC; null when the library gives only a date. */
  hour: number | null;
}

/** Weekday and hour of the start given as a date ("2026-11-02") or a date with time, or null when it cannot be read. */
export function adStart(value: string | null | undefined): AdStart | null {
  const v = value?.trim();
  if (!v) return null;
  const withTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v);
  const ms = Date.parse(withTime ? v.replace(" ", "T") : `${v.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return { weekday: (d.getUTCDay() + 6) % 7, hour: withTime ? d.getUTCHours() : null };
}

/** Number of starts per weekday, Monday first (seven counts). */
export function weekdayCounts(starts: AdStart[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const s of starts) counts[s.weekday]++;
  return counts;
}
