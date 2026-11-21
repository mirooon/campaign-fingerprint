/**
 * Polish formats for the GUI: decimal comma (0,82), short dates (9 paź 2026, 08:24) and plural forms.
 * Pure functions, no React.
 */
import { plural } from "@/components/viewer/compare";

export { plural };

/** 0.8234 -> "0,82" (fixed digits, decimal comma). */
export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(digits).replace(".", ",");
}

const MONTHS = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];

function parts(d: Date, timeZone: string): { y: number; m: number; day: number; hh: string; mm: string } {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), day: Number(p.day), hh: p.hour, mm: p.minute };
}

/**
 * ISO date -> "9 paź 2026" or "9 paź 2026, 08:24". A date at midnight UTC (date-only data) is shown
 * without the time and without a time-zone shift; other times in Polish time.
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

/** Date range of a campaign: "5 wrz – 20 paź 2026" style, full dates when the years differ. */
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

/** "3 materiały", "5 materiałów" ... */
export function count(n: number, forms: [string, string, string]): string {
  return `${n} ${plural(n, forms)}`;
}

export const MATERIAL: [string, string, string] = ["materiał", "materiały", "materiałów"];
export const CAMPAIGN: [string, string, string] = ["kampania", "kampanie", "kampanii"];
export const CASE: [string, string, string] = ["sprawa", "sprawy", "spraw"];
export const FILE: [string, string, string] = ["plik", "pliki", "plików"];
export const TRACE: [string, string, string] = ["wspólny ślad", "wspólne ślady", "wspólnych śladów"];
export const FEATURE: [string, string, string] = ["cecha", "cechy", "cech"];
export const PREMISE: [string, string, string] = ["przesłanka", "przesłanki", "przesłanek"];
export const GROUP: [string, string, string] = ["grupa podobnych", "grupy podobnych", "grup podobnych"];
