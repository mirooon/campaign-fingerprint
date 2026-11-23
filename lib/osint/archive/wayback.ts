/**
 * Internet Archive (Wayback Machine) as a source of copies of dead pages: the CDX index finds the
 * captures of an address, the `id_` variant of the nearest one gives the original body.
 *
 * Passive: only reads existing captures; it never asks the archive to save a page ("Save Page Now").
 * The CDX answers slowly and often with 504, so every request has a time limit and one retry.
 */
import { DEFAULT_ARCHIVE_CONFIG, type ArchiveConfig } from "./config";
import { ArchiveLookupError, decodeBody, fetchHttp, type ArchiveHttp, type ArchiveHttpResponse } from "./http";
import type { ArchivedCopy, ArchiveSource } from "./types";

const CDX_URL = "https://web.archive.org/cdx/search/cdx";
const USER_AGENT = "hacknation-osint-starter/0.1 (passive lookup)";

export interface WaybackOptions {
  http?: ArchiveHttp;
  /** Clock override for tests. */
  now?: () => Date;
  config?: ArchiveConfig;
}

interface CdxRow {
  /** 14 digits, UTC: YYYYMMDDhhmmss. */
  timestamp: string;
  original: string;
}

/** ISO time of a CDX timestamp (YYYYMMDDhhmmss, UTC); null when the string is not 14 digits or not a date. */
export function waybackTimestamp(ts: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(ts);
  if (!m) return null;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** CDX timestamp (YYYYMMDDhhmmss, UTC) of an ISO time; null for an unparsable time. */
function cdxTime(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

/**
 * Rows of a CDX answer in `output=json` form: the first row names the columns, the rest are captures.
 * Rows without a readable timestamp or address are left out; anything that is not that shape gives [].
 */
export function parseCdx(json: unknown): CdxRow[] {
  if (!Array.isArray(json) || json.length < 2 || !Array.isArray(json[0])) return [];
  const header = json[0].map(String);
  const ti = header.indexOf("timestamp");
  const oi = header.indexOf("original");
  if (ti < 0 || oi < 0) return [];
  const rows: CdxRow[] = [];
  for (const r of json.slice(1)) {
    if (!Array.isArray(r) || typeof r[ti] !== "string" || typeof r[oi] !== "string") continue;
    if (waybackTimestamp(r[ti])) rows.push({ timestamp: r[ti], original: r[oi] });
  }
  return rows;
}

/** The capture closest in time to `target` (ISO), either side; ties go to the earlier one. Null for no rows. */
export function closestRow(rows: CdxRow[], target: string): CdxRow | null {
  const t = Date.parse(target);
  let best: { row: CdxRow; d: number } | null = null;
  for (const row of rows) {
    const d = Math.abs(Date.parse(waybackTimestamp(row.timestamp)!) - t);
    if (!best || d < best.d || (d === best.d && row.timestamp < best.row.timestamp)) best = { row, d };
  }
  return best?.row ?? null;
}

/**
 * Wayback source. `lookup` asks the CDX for captures of the address (status 200, not earlier than
 * `after`), takes the one nearest to `before` (default: now; a later capture is accepted) and fetches
 * its original body.
 */
export function createWaybackSource(opts: WaybackOptions = {}): ArchiveSource {
  const http = opts.http ?? fetchHttp;
  const now = opts.now ?? (() => new Date());
  const config = opts.config ?? DEFAULT_ARCHIVE_CONFIG;

  /** GET with the time limit and one retry after a timeout, a network error or a 5xx; 429 is not retried. */
  async function get(url: string): Promise<ArchiveHttpResponse> {
    let last = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0 && config.waybackRetryDelayMs > 0) await new Promise((r) => setTimeout(r, config.waybackRetryDelayMs));
      try {
        const res = await http(url, { headers: { "user-agent": USER_AGENT }, timeoutMs: config.waybackTimeoutMs });
        if (res.status === 429) throw new ArchiveLookupError("wayback", "Internet Archive rate limit (HTTP 429), try later", Number(res.headers["retry-after"]) || undefined);
        if (res.status < 500) return res;
        last = `HTTP ${res.status}`;
      } catch (e) {
        if (e instanceof ArchiveLookupError) throw e;
        last = e instanceof Error ? e.message : String(e);
      }
    }
    throw new ArchiveLookupError("wayback", `Internet Archive did not respond (${last}), after one retry`);
  }

  return {
    name: "wayback",
    available: async () => ({ ok: true }),
    async lookup(url, range = {}) {
      const fetchedAt = now().toISOString();
      const target = range.before ?? fetchedAt;
      const params = new URLSearchParams({ url: url.replace(/#.*$/, ""), output: "json", filter: "statuscode:200", fl: "timestamp,original", limit: String(config.waybackCdxLimit), sort: "closest" });
      params.set("closest", cdxTime(target) ?? cdxTime(fetchedAt)!);
      const from = range.after ? cdxTime(range.after) : null;
      if (from) params.set("from", from);
      const index = await get(`${CDX_URL}?${params}`);
      if (index.status !== 200) throw new ArchiveLookupError("wayback", `CDX answered HTTP ${index.status}`);
      let json: unknown;
      try {
        json = JSON.parse(index.body.toString("utf8") || "[]");
      } catch (e) {
        throw new ArchiveLookupError("wayback", `CDX returned non-JSON: ${(e as Error).message}`);
      }
      const row = closestRow(parseCdx(json), target);
      if (!row) return [];
      const page = await get(`https://web.archive.org/web/${row.timestamp}id_/${row.original}`);
      if (page.status !== 200) throw new ArchiveLookupError("wayback", `copy ${row.timestamp} cannot be fetched (HTTP ${page.status})`);
      let html: string;
      try {
        html = decodeBody(page.body, config.maxBodyBytes).toString("utf8");
      } catch (e) {
        throw new ArchiveLookupError("wayback", `copy ${row.timestamp} unreadable: ${(e as Error).message}`);
      }
      const copy: ArchivedCopy = {
        source: "wayback",
        url: row.original,
        sourceUrl: `https://web.archive.org/web/${row.timestamp}/${row.original}`,
        capturedAt: waybackTimestamp(row.timestamp)!,
        fetchedAt,
        html,
      };
      return [copy];
    },
  };
}
