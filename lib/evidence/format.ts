/** Formatting of values in the documents of the evidence pack. Pure. */

/** UTC time for a reader: the date alone at midnight, otherwise `YYYY-MM-DD HH:MM UTC`; "?" for a missing or unreadable value. */
export function formatUtc(iso: string | null | undefined): string {
  if (!iso) return "?";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "?";
  const d = new Date(t).toISOString();
  return d.slice(11, 16) === "00:00" ? d.slice(0, 10) : `${d.slice(0, 10)} ${d.slice(11, 16)} UTC`;
}

/** Time range for a document: "from – to" in UTC as above; a single time when both ends are equal. */
export function formatRange(from: string | null | undefined, to: string | null | undefined): string {
  const a = formatUtc(from);
  const b = formatUtc(to ?? from);
  return a === b ? a : `${a} – ${b}`;
}
