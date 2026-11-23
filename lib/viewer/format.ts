/**
 * Formats for the GUI: decimal point (0.82), short en-GB dates (9 Oct 2026, 08:24) and English plurals.
 * Pure functions, no React.
 */

/** Singular and plural form of a noun ("sample", "samples"); a third form is accepted and ignored. */
export type Forms = readonly [singular: string, plural: string, ...rest: string[]];

/** English plural: 1 campaign, 0 or 2+ campaigns. */
export function plural(n: number, forms: Forms): string {
  return n === 1 ? forms[0] : forms[1];
}

/** 0.8234 -> "0.82" (fixed digits, decimal point). */
export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(d: Date, timeZone: string): { y: number; m: number; day: number; hh: string; mm: string } {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), day: Number(p.day), hh: p.hour, mm: p.minute };
}

/**
 * ISO date -> "9 Oct 2026" or "9 Oct 2026, 08:24". A date at midnight UTC (date-only data) is shown
 * without the time and without a time-zone shift; other times in Warsaw time (Europe/Warsaw).
 */
export function fmtDate(iso: string | null | undefined, opts: { time?: boolean; timeZone?: string } = {}): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso) || /T00:00:00(\.0+)?Z$/.test(iso);
  if (dateOnly) return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const p = parts(d, opts.timeZone ?? "Europe/Warsaw");
  const date = `${p.day} ${MONTHS[p.m - 1]} ${p.y}`;
  return opts.time === false ? date : `${date}, ${p.hh}:${p.mm}`;
}

/** Date range of a campaign: "5 Sep 2026 – 20 Oct 2026"; a single date when both ends are the same day. */
export function fmtRange(from: string | null | undefined, to: string | null | undefined): string {
  if (!from && !to) return "—";
  if (!from || !to) return fmtDate(from ?? to, { time: false });
  const a = fmtDate(from, { time: false });
  const b = fmtDate(to, { time: false });
  return a === b ? a : `${a} – ${b}`;
}

/** Elapsed time "1 min 05 s" / "42 s". */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, "0")} s`;
}

/** "1 sample", "3 samples" ... */
export function count(n: number, forms: Forms): string {
  return `${n} ${plural(n, forms)}`;
}

export const MATERIAL: Forms = ["sample", "samples"];
export const CAMPAIGN: Forms = ["campaign", "campaigns"];
/** A sample left alone: a campaign of one sample, which still has its own K number. */
export const SINGLE_MATERIAL: Forms = ["single sample", "single samples"];
export const CASE: Forms = ["case", "cases"];
export const FILE: Forms = ["file", "files"];
export const TRACE: Forms = ["shared trace", "shared traces"];
export const FEATURE: Forms = ["feature", "features"];
export const PREMISE: Forms = ["evidence item", "evidence items"];
export const GROUP: Forms = ["similar-campaign group", "similar-campaign groups"];
export const ERROR: Forms = ["error", "errors"];
