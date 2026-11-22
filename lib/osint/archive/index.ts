/**
 * Archive step: finds a public copy of a page that no longer answers (urlscan.io, Internet Archive)
 * and decides whether the copy may be used. Sources are asked in a fixed order (urlscan has the
 * richer record), each answer is judged against the era of the domain, and what happened to every
 * source is kept for the step report.
 *
 * The rules (`judgeCopy`, `earliestAcceptable`) are pure; the network sits in the adapters.
 */
import { existsSync } from "node:fs";
import { CACHE_TTL, createCache, TTL, type FileCache } from "../../cache";
import { ARCHIVE_SOURCE_NAMES, DEFAULT_ARCHIVE_CONFIG, type ArchiveConfig } from "./config";
import { ArchiveLookupError } from "./http";
import type { ArchivedCopy, ArchiveOutcome, ArchiveSource } from "./types";
import { createUrlscanSource } from "./urlscan";
import { createWaybackSource } from "./wayback";

export { DEFAULT_ARCHIVE_CONFIG, type ArchiveConfig } from "./config";
export { ArchiveLookupError } from "./http";
export type { ArchivedCopy, ArchiveOutcome, ArchiveSource, PageArchive } from "./types";

const DAY_MS = 86_400_000;

/** What is known about the page and its domain, to judge whether a copy belongs to the material. */
export interface CopyContext {
  config: ArchiveConfig;
  /** ISO registration date of the domain (RDAP `created`). */
  domainCreated?: string | null;
  /** ISO date of the oldest certificate in the CT logs; used only when `domainCreated` is missing. */
  oldestCert?: string | null;
  /** ISO time the material was first seen. */
  firstSeen?: string | null;
}

const ms = (iso: string | null | undefined): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : t;
};

/**
 * Why a copy must not feed the features, or null when it may. Domains of scams are registered again
 * after they lapse, so a copy made before the current registration shows someone else's old page
 * and would link the material to a campaign it is not part of; that case sets `reRegistered` only
 * when the date comes from RDAP (the oldest certificate is weaker evidence of a change of owner).
 * A copy older than the first sighting by more than `archiveMaxAgeDays` may show another version
 * of the page. A copy made after the sighting is fine: dead pages are usually found by a later scan.
 */
export function judgeCopy(c: ArchivedCopy, ctx: CopyContext): { reason: string; reRegistered: boolean } | null {
  const at = ms(c.capturedAt);
  if (at === null) return null;
  const created = ms(ctx.domainCreated);
  const cert = created === null ? ms(ctx.oldestCert) : null;
  const registered = created ?? cert;
  if (registered !== null && at < registered) return { reason: "kopia sprzed rejestracji domeny", reRegistered: created !== null };
  const seen = ms(ctx.firstSeen);
  if (seen !== null && seen - at > ctx.config.archiveMaxAgeDays * DAY_MS) {
    return { reason: `kopia starsza od pierwszego wystąpienia materiału o więcej niż ${ctx.config.archiveMaxAgeDays} dni`, reRegistered: false };
  }
  return null;
}

/** Earliest time a copy may have, as ISO: the later of the registration date and the first sighting minus the allowed age; null when neither is known. */
export function earliestAcceptable(ctx: CopyContext): string | null {
  const registered = ms(ctx.domainCreated) ?? ms(ctx.oldestCert);
  const seen = ms(ctx.firstSeen);
  const bounds = [registered, seen === null ? null : seen - ctx.config.archiveMaxAgeDays * DAY_MS].filter((t): t is number => t !== null);
  return bounds.length ? new Date(Math.max(...bounds)).toISOString() : null;
}

/** Source names from ARCHIVE_SOURCES ("urlscan,wayback"), in the fixed order; unknown names give `error`. */
export function archiveSourceNames(value: string | undefined): { names: Array<ArchiveSource["name"]>; error?: string } {
  const wanted = (value ?? "").split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const unknown = wanted.filter((n) => !(ARCHIVE_SOURCE_NAMES as readonly string[]).includes(n));
  const names = ARCHIVE_SOURCE_NAMES.filter((n) => wanted.includes(n));
  return unknown.length ? { names, error: `nieznane źródło archiwalne: ${unknown.join(", ")} (dozwolone: ${ARCHIVE_SOURCE_NAMES.join(", ")})` } : { names };
}

export interface FindOptions {
  sources: ArchiveSource[];
  /** ISO first sighting of the material: the copy nearest to it is wanted. */
  firstSeen?: string | null;
  /** Registration date of the domain (RDAP `created`) and, without it, the oldest certificate (CT). */
  domainCreated?: string | null;
  oldestCert?: string | null;
  config?: ArchiveConfig;
}

/** The copy without its body: what goes into the dataset as the provenance of a copy. */
export function copyProvenance(c: ArchivedCopy): Omit<ArchivedCopy, "html"> {
  return Object.fromEntries(Object.entries(c).filter(([key]) => key !== "html")) as Omit<ArchivedCopy, "html">;
}

/** The day of a copy, "2026-10-02", for the report. */
const day = (c: ArchivedCopy) => c.capturedAt.slice(0, 10);

/**
 * Looks for a copy of `url` in the sources, in order, and returns the first one that may be used and has the
 * page body; a copy without the body (urlscan without a key) is returned only when no source has one.
 * A source that is not available or fails is recorded with the reason and the next one is asked. When
 * a source returns only rejected copies, it is asked once more for a copy from after the earliest
 * acceptable time (the current owner of a re-registered domain may have been archived too).
 */
export async function findArchivedCopy(url: string, opts: FindOptions): Promise<ArchiveOutcome> {
  const ctx: CopyContext = { config: opts.config ?? DEFAULT_ARCHIVE_CONFIG, domainCreated: opts.domainCreated, oldestCert: opts.oldestCert, firstSeen: opts.firstSeen };
  const before = opts.firstSeen ?? undefined;
  const tried: ArchiveOutcome["tried"] = [];
  const rejected: ArchivedCopy[] = [];
  let reRegistered = false;
  let chosen: ArchivedCopy | null = null;
  let withoutBody: ArchivedCopy | null = null;

  /** Judges the copies: rejected ones are kept with the reason, the first acceptable one is returned. */
  const judge = (copies: ArchivedCopy[]): ArchivedCopy | null => {
    let ok: ArchivedCopy | null = null;
    for (const c of copies) {
      const verdict = judgeCopy(c, ctx);
      if (!verdict) {
        ok ??= c;
        continue;
      }
      reRegistered ||= verdict.reRegistered;
      if (!rejected.some((r) => r.sourceUrl === c.sourceUrl)) rejected.push({ ...c, rejected: { reason: verdict.reason } });
    }
    return ok;
  };

  for (const source of opts.sources) {
    const av = await source.available();
    if (!av.ok) {
      tried.push({ source: source.name, status: "skipped", reason: av.reason ?? "źródło niedostępne" });
      continue;
    }
    try {
      const copies = await source.lookup(url, { ...(before ? { before } : {}) });
      const rejectedBefore = rejected.length;
      let ok = judge(copies);
      const after = earliestAcceptable(ctx);
      if (!ok && rejected.length > rejectedBefore && after) ok = judge(await source.lookup(url, { ...(before ? { before } : {}), after }));
      if (ok) {
        tried.push({ source: source.name, status: "found" });
        // a copy without the page body (urlscan without a key: the request list only) is kept, but a later source may have the body
        if (ok.html) {
          chosen = ok;
          break;
        }
        withoutBody ??= ok;
        continue;
      }
      tried.push(rejected.length > rejectedBefore ? { source: source.name, status: "rejected", reason: rejected.at(-1)!.rejected!.reason } : { source: source.name, status: "none" });
    } catch (e) {
      if (!(e instanceof ArchiveLookupError)) throw e;
      tried.push({ source: source.name, status: "error", reason: e.reason });
    }
  }

  chosen ??= withoutBody;
  let summary: string;
  if (chosen) summary = `kopia z ${chosen.source} z ${day(chosen)}`;
  else if (!opts.sources.length) summary = "brak źródeł archiwalnych (włącz urlscan lub wayback)";
  else if (rejected.length) summary = `kopia z ${rejected[0].source} z ${day(rejected[0])} odrzucona: ${rejected[0].rejected!.reason}`;
  else if (tried.every((t) => t.status === "none")) summary = `brak kopii archiwalnej (${tried.map((t) => t.source).join(", ")})`;
  else summary = `archiwa nie sprawdzone do końca, kopii nie znaleziono (${tried.map((t) => `${t.source}: ${t.reason ?? "brak kopii"}`).join("; ")})`;
  return { copy: chosen, rejected, tried, reRegistered, summary };
}

/**
 * The source with its answers kept in `cache` (a week when copies were found, a few hours when not:
 * a scan or capture may appear later). Failures are not cached. A cached copy whose screenshot file is
 * gone is asked for again. `tag` separates answers that differ by configuration (a key adds the DOM).
 */
export function withCache(source: ArchiveSource, cache: FileCache, tag: string, config: ArchiveConfig): ArchiveSource {
  return {
    name: source.name,
    available: () => source.available(),
    async lookup(url, opts = {}) {
      const key = `lookup:${tag}:${url}|${opts.before ?? ""}|${opts.after ?? ""}`;
      const hit = await cache.get<ArchivedCopy[]>(key);
      if (hit && hit.every((c) => !c.screenshotPath || existsSync(c.screenshotPath))) return hit;
      const copies = await source.lookup(url, opts);
      await cache.set(key, copies, copies.length ? config.cacheDaysFound * DAY_MS : config.cacheHoursNone * TTL.hour);
      return copies;
    },
  };
}

export interface ArchiveSourceOptions {
  config?: ArchiveConfig;
  /** Folder for the screenshots of copies (urlscan). */
  screenshotDir?: string;
  /** File cache of lookups; `false` for none. Default: namespace "archive". */
  cache?: FileCache | false;
}

/** The named sources, cached; urlscan reads its key from URLSCAN_API_KEY. */
export function createArchiveSources(names: Array<ArchiveSource["name"]>, opts: ArchiveSourceOptions = {}): ArchiveSource[] {
  const config = opts.config ?? DEFAULT_ARCHIVE_CONFIG;
  const cache = opts.cache === false ? null : (opts.cache ?? createCache({ namespace: "archive", defaultTtlMs: CACHE_TTL.archive }));
  const wrap = (source: ArchiveSource, tag: string) => (cache ? withCache(source, cache, tag, config) : source);
  return names.map((name) =>
    name === "urlscan"
      ? wrap(createUrlscanSource({ config, screenshotDir: opts.screenshotDir }), process.env.URLSCAN_API_KEY ? "urlscan:key" : "urlscan:nokey")
      : wrap(createWaybackSource({ config }), "wayback"),
  );
}
