/**
 * urlscan.io as a source of copies of dead pages: searches the scans that already exist (by full
 * address, then by domain in date windows) and reads the public result page of the best one: request
 * list with resource hashes, screenshot, and (only with an API key) the DOM of the saved page.
 *
 * Passive: it never submits a scan. Anonymous search is limited (about 100 requests an hour; a 429
 * resets after about 18 minutes), so requests go through one queue with a pause between them, and
 * after a 429 the source asks nothing more until the time given in `Retry-After`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_ARCHIVE_CONFIG, type ArchiveConfig } from "./config";
import { ArchiveLookupError, fetchHttp, type ArchiveHttp, type ArchiveHttpResponse } from "./http";
import type { ArchivedCopy, ArchiveSource } from "./types";

const API = "https://urlscan.io";
const USER_AGENT = "hacknation-osint-starter/0.1 (passive lookup)";
const DAY_MS = 86_400_000;
const SIGNUP = "Darmowy klucz API: konto na https://urlscan.io/user/signup, klucz w ustawieniach konta; podaj go w zmiennej URLSCAN_API_KEY";

export interface UrlscanOptions {
  http?: ArchiveHttp;
  /** Clock override for tests. */
  now?: () => Date;
  config?: ArchiveConfig;
  /** API key; default: env URLSCAN_API_KEY. Without it search works, the DOM of saved pages is left out. */
  apiKey?: string;
  /** Folder for the screenshots of copies; without it no screenshot is fetched. */
  screenshotDir?: string;
  /** Pause between queued requests; default: setTimeout. Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** One search hit: the fields of the scan record the copy takes over. */
interface ScanRecord {
  id: string;
  time: string;
  pageUrl: string;
  meta: NonNullable<ArchivedCopy["meta"]>;
}

const asString = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Scan records of a search answer (`results[]`); records without an id, time or address are left out. */
export function parseSearch(json: unknown): ScanRecord[] {
  const results = (json as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: ScanRecord[] = [];
  for (const r of results as Array<Record<string, Record<string, unknown> | string | undefined>>) {
    const task = (typeof r.task === "object" ? r.task : {}) as Record<string, unknown>;
    const page = (typeof r.page === "object" ? r.page : {}) as Record<string, unknown>;
    const id = asString(r._id);
    const time = asString(task.time);
    const pageUrl = asString(page.url) ?? asString(task.url);
    if (!id || !time || !pageUrl || Number.isNaN(Date.parse(time))) continue;
    const meta: ScanRecord["meta"] = {};
    for (const [key, v] of [["ip", page.ip], ["asn", page.asn], ["server", page.server], ["tlsIssuer", page.tlsIssuer], ["title", page.title]] as const) {
      const s = asString(v);
      if (s) meta[key] = s;
    }
    out.push({ id, time: new Date(time).toISOString(), pageUrl, meta });
  }
  return out;
}

/** Text of an HTML fragment as shown: entities of the few kinds urlscan writes decoded. */
function unescapeHtml(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/**
 * Request list of a scan from its public result page: address, SHA-256 of the resource, server IP and
 * type of every request, then the failed requests (address only, type "failed"). Parsed from the page
 * because anonymous access has no HAR; the page's layout is the only contract, so an unrecognised
 * page gives [] and the caller records that the list is missing.
 */
export function parseResultRequests(html: string): NonNullable<ArchivedCopy["requests"]> {
  const out: NonNullable<ArchivedCopy["requests"]> = [];
  const marks = [...html.matchAll(/<dt><b>Full URL<\/b><\/dt><dd>(.*?)<\/dd>/gs)];
  let prevEnd = 0;
  marks.forEach((m, i) => {
    const block = html.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : html.length);
    const before = html.slice(prevEnd, m.index);
    prevEnd = m.index + m[0].length;
    const types = [...before.matchAll(/<span class="bold">([^<]+)<\/span>\s*<br\/><small class="d-none d-sm-inline">([^<]*)<\/small>/g)];
    const sha = /Resource Hash<\/b><\/dt><dd><tt><a [^>]*>([0-9a-f]{64})<\/a>/.exec(block)?.[1];
    const ip = /<a href="\/ip\/([^"]+)">/.exec(block)?.[1];
    const type = types.at(-1)?.[1];
    out.push({ url: unescapeHtml(m[1]).trim(), ...(sha ? { sha256: sha } : {}), ...(ip ? { ip } : {}), ...(type ? { type } : {}) });
  });
  const failed = html.indexOf("<h3>Failed requests</h3>");
  if (failed >= 0) {
    for (const m of html.slice(failed).matchAll(/<dt>URL<\/dt><dd class="break-all">(.*?)<\/dd>/gs)) out.push({ url: unescapeHtml(m[1]).trim(), type: "failed" });
  }
  return out;
}

/** Host, path (without the trailing slash) and sorted query of an address; null when it is not an absolute URL. */
function parts(url: string): { host: string; path: string; query: string } | null {
  try {
    const u = new URL(url);
    u.searchParams.sort();
    return { host: u.host.toLowerCase(), path: u.pathname.replace(/\/+$/, ""), query: u.searchParams.toString() };
  } catch {
    return null;
  }
}

/**
 * How well a scanned address matches the wanted one: "exact" (same host, path and query), "path" (same
 * host and path, another query: the same page for another click) or null. A scan of another page of
 * the domain is not a copy of this page, so it never matches; the fragment is ignored.
 */
export function matchLevel(wanted: string, scanned: string): "exact" | "path" | null {
  const w = parts(wanted);
  const s = parts(scanned);
  if (!w || !s || w.host !== s.host || w.path !== s.path) return null;
  return w.query === s.query ? "exact" : "path";
}

/** Formats a time as urlscan's query syntax wants it: UTC, `YYYY-MM-DDTHH:MM:SS`. */
function queryTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

/**
 * Date windows of at most `stepDays` that cover [from, to] (ISO), newest first. A search holds at most
 * 100 results, so a busy domain is asked window by window.
 */
export function dateWindows(from: string, to: string, stepDays: number): Array<{ from: string; to: string }> {
  const start = Date.parse(from);
  const out: Array<{ from: string; to: string }> = [];
  for (let end = Date.parse(to); end > start; ) {
    const lo = Math.max(start, end - stepDays * DAY_MS);
    out.push({ from: queryTime(lo), to: queryTime(end) });
    end = lo;
  }
  return out;
}

/** The search query for a full address, quoted so that `?`, `&` and `:` are not read as syntax. */
function urlQuery(url: string): string {
  return `page.url:"${url.replace(/#.*$/, "").replace(/(["\\])/g, "\\$1")}"`;
}

/**
 * urlscan source. `lookup` returns the scans of the same page (full address, or the same path with
 * another query), exact matches first, then the nearest in time to `before`. Only the best copy is
 * completed with the request list, screenshot and (with a key) the DOM; what could not be fetched is
 * named in the copy's `notes`.
 */
export function createUrlscanSource(opts: UrlscanOptions = {}): ArchiveSource {
  const http = opts.http ?? fetchHttp;
  const now = opts.now ?? (() => new Date());
  const config = opts.config ?? DEFAULT_ARCHIVE_CONFIG;
  const apiKey = opts.apiKey ?? process.env.URLSCAN_API_KEY ?? "";
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let blockedUntil = 0;
  let lastRequestAt = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const headers = (): Record<string, string> => ({ "user-agent": USER_AGENT, ...(apiKey ? { "api-key": apiKey } : {}) });

  /** One GET through the queue (one at a time, with a pause); a 429 starts the pause that `available` reports. */
  function request(url: string): Promise<ArchiveHttpResponse> {
    const run = queue.then(async () => {
      if (now().getTime() < blockedUntil) throw new ArchiveLookupError("urlscan", pausedReason(), Math.ceil((blockedUntil - now().getTime()) / 1000));
      const wait = lastRequestAt + config.urlscanMinIntervalMs - now().getTime();
      if (wait > 0) await sleep(wait);
      lastRequestAt = now().getTime();
      let res: ArchiveHttpResponse;
      try {
        res = await http(url, { headers: headers(), timeoutMs: config.urlscanTimeoutMs });
      } catch (e) {
        throw new ArchiveLookupError("urlscan", `urlscan nie odpowiedział (${e instanceof Error ? e.message : String(e)})`);
      }
      if (res.status === 429) {
        const retry = Number(res.headers["retry-after"]) || config.urlscanDefaultRetryAfterS;
        blockedUntil = now().getTime() + retry * 1000;
        throw new ArchiveLookupError("urlscan", pausedReason(), retry);
      }
      return res;
    });
    // the queue goes on after a failed request: that request's error reaches its own caller through `run`
    queue = run.then(undefined, () => undefined);
    return run;
  }

  function pausedReason(): string {
    return `limit zapytań urlscan (HTTP 429): kolejne zapytanie po ${new Date(blockedUntil).toISOString().slice(11, 16)} UTC (Retry-After)`;
  }

  /** Records of one search query (at most `urlscanPageSize`). */
  async function search(q: string): Promise<ScanRecord[]> {
    const res = await request(`${API}/api/v1/search/?${new URLSearchParams({ q, size: String(config.urlscanPageSize) })}`);
    if (res.status !== 200) throw new ArchiveLookupError("urlscan", `wyszukiwanie urlscan: HTTP ${res.status}`);
    try {
      return parseSearch(JSON.parse(res.body.toString("utf8")));
    } catch (e) {
      throw new ArchiveLookupError("urlscan", `wyszukiwanie urlscan zwróciło nie-JSON: ${(e as Error).message}`);
    }
  }

  /**
   * Request list, DOM and screenshot of one scan, written into the copy. A part that could not be
   * fetched (limit, error status) does not cost the copy: it is named in `notes` with the reason.
   */
  async function complete(copy: ArchivedCopy, id: string): Promise<void> {
    const notes: string[] = [];
    /** GET of one part; its failure becomes a note and returns null. */
    const part = async (what: string, url: string): Promise<Buffer | null> => {
      try {
        const res = await request(url);
        if (res.status === 200) return res.body;
        notes.push(`brak: ${what} (HTTP ${res.status})`);
      } catch (e) {
        if (!(e instanceof ArchiveLookupError)) throw e;
        notes.push(`brak: ${what} (${e.reason})`);
      }
      return null;
    };
    const page = await part("lista żądań", `${API}/result/${id}/`);
    if (page) {
      const requests = parseResultRequests(page.toString("utf8"));
      if (requests.length) copy.requests = requests;
      else notes.push("lista żądań: nie rozpoznano strony wyniku urlscan");
    }
    if (apiKey) {
      const dom = await part("DOM", `${API}/dom/${id}/`);
      if (dom) copy.html = dom.toString("utf8");
    } else notes.push("DOM pominięty: brak klucza URLSCAN_API_KEY");
    if (opts.screenshotDir) {
      const shot = await part("zrzut", `${API}/screenshots/${id}.png`);
      if (shot) {
        mkdirSync(opts.screenshotDir, { recursive: true });
        copy.screenshotPath = path.join(opts.screenshotDir, `${id}.png`);
        writeFileSync(copy.screenshotPath, shot);
      }
    }
    if (notes.length) copy.notes = notes;
  }

  return {
    name: "urlscan",
    available: async () => {
      if (now().getTime() < blockedUntil) return { ok: false, reason: pausedReason(), howToGetAccess: SIGNUP };
      return apiKey ? { ok: true } : { ok: true, reason: "bez klucza: wyszukiwanie działa, DOM zapisanych stron pominięty", howToGetAccess: SIGNUP };
    },
    async lookup(url, range = {}) {
      const fetchedAt = now().toISOString();
      const target = Date.parse(range.before ?? fetchedAt);
      const after = range.after ? Date.parse(range.after) : -Infinity;
      const wanted = parts(url);
      if (!wanted) throw new ArchiveLookupError("urlscan", `adres nie do przeszukania: ${url}`);
      const found = new Map<string, ScanRecord & { level: "exact" | "path" }>();
      const take = (records: ScanRecord[]) => {
        for (const r of records) {
          const level = matchLevel(url, r.pageUrl);
          if (level && Date.parse(r.time) >= after) found.set(r.id, { ...r, level });
        }
      };
      if (wanted.path !== "" || wanted.query !== "") take(await search(urlQuery(url)));
      if (!found.size) {
        const domainQuery = `page.domain:${wanted.host.replace(/:\d+$/, "")}`;
        const first = await search(domainQuery);
        take(first);
        if (!found.size && first.length >= config.urlscanPageSize) {
          const from = range.after ?? new Date(target - config.urlscanLookbackDays * DAY_MS).toISOString();
          const to = new Date(Math.min(now().getTime(), target + config.urlscanLookbackDays * DAY_MS)).toISOString();
          const mid = (w: { from: string; to: string }) => (Date.parse(w.from) + Date.parse(w.to)) / 2;
          const windows = dateWindows(from, to, config.urlscanWindowDays)
            .sort((a, b) => Math.abs(mid(a) - target) - Math.abs(mid(b) - target))
            .slice(0, config.urlscanMaxWindows);
          for (const w of windows) {
            take(await search(`(${domainQuery}) AND date:[${w.from} TO ${w.to}]`));
            if (found.size) break;
          }
        }
      }
      const ranked = [...found.values()]
        .sort((a, b) => Number(b.level === "exact") - Number(a.level === "exact") || Math.abs(Date.parse(a.time) - target) - Math.abs(Date.parse(b.time) - target))
        .slice(0, config.urlscanMaxCopies);
      const copies = ranked.map((r): ArchivedCopy => ({ source: "urlscan", url: r.pageUrl, sourceUrl: `${API}/result/${r.id}/`, capturedAt: r.time, fetchedAt, meta: r.meta }));
      if (copies.length) await complete(copies[0], ranked[0].id);
      return copies;
    },
  };
}
