/**
 * Register of reports made about a campaign (to a platform, CERT, an authority): who, when, in what
 * category, with what outcome. It is kept by the analyst as JSON lines (one entry per report, also
 * the entries of the platforms' statements under art. 22(3) DSA) and read with `--prior`. The pack
 * uses it for `prior_reports`, for the list of reports waiting for a reaction (reminder to repeat)
 * and for the ads that appeared after the first report, the sign that the report changed nothing.
 * Pure functions; the file stays with the script.
 */

export interface ReportEntry {
  campaign_id: string | null;
  recipient: string;
  /** ISO UTC of the report. */
  reported_utc: string;
  category: string;
  /** Outcome as written by the analyst ("wysłane", "usunięte", "odrzucone", …). */
  status: string;
  /** ISO UTC of the recipient's reaction; null while there is none. */
  response_utc: string | null;
  /** The recipient's reference number or link, when it gave one. */
  reference: string | null;
}

/** Days after which a report without a reaction is listed as waiting. */
export const REPORT_WAIT_DAYS = 14;

const DAY = 86_400_000;
/** Trimmed text, or null for anything that is not a non-empty string. */
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** ISO UTC of a date string, or null for a missing or unreadable one. */
function iso(v: unknown): string | null {
  const s = str(v);
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** One report from a parsed object; null when the recipient, a readable date or the status is missing. */
function toEntry(o: Record<string, unknown>): ReportEntry | null {
  const reported = iso(o.reported_utc);
  const recipient = str(o.recipient);
  const status = str(o.status);
  if (!reported || !recipient || !status) return null;
  return { campaign_id: str(o.campaign_id), recipient, reported_utc: reported, category: str(o.category) ?? "nieokreślona", status, response_utc: iso(o.response_utc), reference: str(o.reference) };
}

/** Reports from JSON lines or from a JSON array; every line or element that cannot be read is returned with its number (1-based) and the reason. */
export function parseReports(text: string): { entries: ReportEntry[]; errors: Array<{ line: number; reason: string }> } {
  const entries: ReportEntry[] = [];
  const errors: Array<{ line: number; reason: string }> = [];
  const add = (o: unknown, line: number): void => {
    const e = o && typeof o === "object" ? toEntry(o as Record<string, unknown>) : null;
    if (e) entries.push(e);
    else errors.push({ line, reason: "brak odbiorcy, daty zgłoszenia (reported_utc) albo statusu" });
  };
  if (text.trimStart().startsWith("[")) {
    try {
      (JSON.parse(text) as unknown[]).forEach((o, i) => add(o, i + 1));
    } catch (e) {
      errors.push({ line: 1, reason: `to nie jest poprawny JSON: ${(e as Error).message}` });
    }
    return { entries, errors };
  }
  text.split("\n").forEach((raw, i) => {
    if (!raw.trim()) return;
    try {
      add(JSON.parse(raw), i + 1);
    } catch (e) {
      errors.push({ line: i + 1, reason: `to nie jest poprawny JSON: ${(e as Error).message}` });
    }
  });
  return { entries, errors };
}

/** Reports without a reaction for longer than `waitDays`, oldest first, with their age in whole days. */
export function pendingReports(entries: ReportEntry[], now: Date, waitDays: number = REPORT_WAIT_DAYS): Array<{ entry: ReportEntry; days: number }> {
  return entries
    .filter((e) => !e.response_utc)
    .map((e) => ({ entry: e, days: Math.floor((now.getTime() - Date.parse(e.reported_utc)) / DAY) }))
    .filter((p) => p.days > waitDays)
    .sort((a, b) => b.days - a.days);
}

/** Ads first seen after the earliest report: the campaign went on after the notice. Null without reports. */
export function continuationAfterNotice(entries: ReportEntry[], ads: Array<{ item_id: string; first_seen_utc: string | null }>): { first_report_utc: string; ads_first_seen_after: string[] } | null {
  const first = entries.map((e) => e.reported_utc).sort()[0];
  if (!first) return null;
  return { first_report_utc: first, ads_first_seen_after: ads.filter((a) => a.first_seen_utc && a.first_seen_utc > first).map((a) => a.item_id) };
}
