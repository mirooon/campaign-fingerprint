/**
 * Status of a domain on the CERT Polska Warning List from a LOCAL copy of the
 * list (`domains.json`, format v2): no online queries, so the status is as old as the copy and says
 * so (`copyUtc`). Pure functions; reading the file is left to the caller (lib/evidence/certListFile.ts).
 */

export interface CertListEntry {
  registerPositionId: number | string | null;
  /** Domain or host as listed, lower case, without the trailing dot. */
  domain: string;
  /** ISO UTC. */
  insertDate: string | null;
  /** ISO UTC; null while the entry is valid. */
  deleteDate: string | null;
}

export interface CertListSnapshot {
  entries: CertListEntry[];
  /** When the local copy was made (file modification time), ISO UTC; null when unknown. */
  copyUtc: string | null;
}

export interface CertStatus {
  /** active: on the list now; removed: the entry expired; absent: never listed in this copy; unchecked: no local copy. */
  status: "active" | "removed" | "absent" | "unchecked";
  registerPositionId: number | string | null;
  insertDate: string | null;
  deleteDate: string | null;
  /** The listed name that matched (the host itself or a parent domain), null when none. */
  matched: string | null;
  copyUtc: string | null;
}

/** Trimmed text, or null for anything that is not a non-empty string. */
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** ISO UTC of a date string, or null for a missing or unreadable one. */
function iso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Entries of a `domains.json` (v2) text: fields RegisterPositionId, DomainAddress, InsertDate, DeleteDate.
 * Rows without an address are skipped; text that is not a JSON array is an error.
 */
export function parseCertList(text: string): CertListEntry[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("not a CERT domain list (a JSON array was expected)");
  const entries: CertListEntry[] = [];
  for (const row of data as Array<Record<string, unknown>>) {
    const domain = str(row?.DomainAddress)?.toLowerCase().replace(/\.$/, "");
    if (!domain) continue;
    const id = row.RegisterPositionId;
    entries.push({
      registerPositionId: typeof id === "number" || typeof id === "string" ? id : null,
      domain,
      insertDate: iso(row.InsertDate),
      deleteDate: iso(row.DeleteDate),
    });
  }
  return entries;
}

/** True while the entry has no delete date or the delete date is still ahead of `now`. */
const isActive = (e: CertListEntry, now: Date): boolean => !e.deleteDate || Date.parse(e.deleteDate) > now.getTime();

/**
 * Status of `host` on the list copy. A listed parent domain covers its subdomains (CERT recommends
 * blocking subdomains). An active entry wins over an expired one; among several of the same kind
 * the latest insert date is taken.
 */
export function certStatus(snapshot: CertListSnapshot | null, host: string, now: Date): CertStatus {
  const none = { registerPositionId: null, insertDate: null, deleteDate: null, matched: null, copyUtc: snapshot?.copyUtc ?? null };
  if (!snapshot) return { status: "unchecked", ...none };
  const name = host.toLowerCase().replace(/\.$/, "");
  const covers = (e: CertListEntry) => name === e.domain || name.endsWith(`.${e.domain}`);
  const hits = snapshot.entries.filter(covers).sort((a, b) => (b.insertDate ?? "").localeCompare(a.insertDate ?? ""));
  const pick = hits.find((e) => isActive(e, now)) ?? hits[0];
  if (!pick) return { status: "absent", ...none };
  return { status: isActive(pick, now) ? "active" : "removed", registerPositionId: pick.registerPositionId, insertDate: pick.insertDate, deleteDate: pick.deleteDate, matched: pick.domain, copyUtc: snapshot.copyUtc };
}
