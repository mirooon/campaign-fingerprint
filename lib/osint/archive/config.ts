/**
 * Limits and defaults of the archive step (urlscan, Wayback). Numbers live here, not in the code
 * that uses them, so a run can be repeated with other values.
 */
export interface ArchiveConfig {
  /**
   * A copy older than the first sighting of the material by more than this many days is not used:
   * the page may have changed (or the domain changed hands) since.
   */
  archiveMaxAgeDays: number;
  /** urlscan search: width of one date window; a window holds at most `urlscanPageSize` results. */
  urlscanWindowDays: number;
  /** urlscan search: results per query (the anonymous maximum). */
  urlscanPageSize: number;
  /** urlscan search: how far back to look when the caller gives no lower bound (anonymous access reaches 30 days). */
  urlscanLookbackDays: number;
  /** urlscan: copies returned per lookup (only the best one gets the request list, DOM and screenshot). */
  urlscanMaxCopies: number;
  /** urlscan search: at most this many date windows per page (each is a query against ~100 per hour). */
  urlscanMaxWindows: number;
  /** Wayback CDX: rows asked for per page address. */
  waybackCdxLimit: number;
  /** Wayback: time limit of one request in ms (CDX answers slowly, 504 is common). */
  waybackTimeoutMs: number;
  /** Wayback: pause before the single retry of a 5xx or timed out request, ms. */
  waybackRetryDelayMs: number;
  /** urlscan: time limit of one request in ms. */
  urlscanTimeoutMs: number;
  /** Largest body kept of a copy, in bytes after decompression. */
  maxBodyBytes: number;
  /** Pause between urlscan requests in ms (a queue, so a run stays far below the hourly limit). */
  urlscanMinIntervalMs: number;
  /** urlscan: wait assumed after a 429 without a Retry-After header, in seconds (the limit resets in about 18 minutes). */
  urlscanDefaultRetryAfterS: number;
  /** Cache lifetime of a lookup that found copies, in days. */
  cacheDaysFound: number;
  /** Cache lifetime of a lookup that found nothing, in hours (a scan or capture may appear later). */
  cacheHoursNone: number;
}

export const DEFAULT_ARCHIVE_CONFIG: ArchiveConfig = {
  archiveMaxAgeDays: 30,
  urlscanWindowDays: 4,
  urlscanPageSize: 100,
  urlscanLookbackDays: 30,
  urlscanMaxWindows: 8,
  urlscanMaxCopies: 5,
  waybackCdxLimit: 50,
  waybackTimeoutMs: 45_000,
  waybackRetryDelayMs: 3_000,
  urlscanTimeoutMs: 30_000,
  maxBodyBytes: 5_000_000,
  urlscanMinIntervalMs: 2_500,
  urlscanDefaultRetryAfterS: 1_080,
  cacheDaysFound: 7,
  cacheHoursNone: 6,
};

/** Names accepted in ARCHIVE_SOURCES, in the order the sources are asked (urlscan has the richer record). */
export const ARCHIVE_SOURCE_NAMES = ["urlscan", "wayback"] as const;
