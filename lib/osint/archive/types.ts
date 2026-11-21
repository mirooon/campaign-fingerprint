/**
 * Shapes of the archive step: a public copy of a page that no longer answers (urlscan.io scan,
 * Internet Archive capture) and the sources that find such copies. Free of runtime code.
 */

/** A public copy of a page, always with where it came from and when it was made. */
export interface ArchivedCopy {
  source: "urlscan" | "wayback";
  /** Address of the page the copy shows (full, with path and query when the copy has them). */
  url: string;
  /** The urlscan result page or the Wayback capture address: where a reader can check the copy. */
  sourceUrl: string;
  /** ISO time the copy was made (scan time, capture time). */
  capturedAt: string;
  /** ISO time of our query. */
  fetchedAt: string;
  /** DOM (urlscan, with an API key) or the body of the capture (Wayback). Never the live page. */
  html?: string;
  /** Requests the page made while it loaded (urlscan), with the hash of each resource. */
  requests?: Array<{ url: string; sha256?: string; ip?: string; type?: string }>;
  /** Local file with the screenshot of the copy, when a screenshot folder was given. */
  screenshotPath?: string;
  meta?: { ip?: string; asn?: string; server?: string; tlsIssuer?: string; title?: string };
  /** The copy was found but must not feed the features (see `judgeCopy`). */
  rejected?: { reason: string };
  /** What the copy lacks and why ("DOM pominięty: brak klucza URLSCAN_API_KEY", "brak: lista żądań (HTTP 404)"). */
  notes?: string[];
}

export interface ArchiveSource {
  name: "urlscan" | "wayback";
  /** Whether the source can be asked now; `reason` says why not and `howToGetAccess` how to change it. */
  available(): Promise<{ ok: boolean; reason?: string; howToGetAccess?: string }>;
  /**
   * Copies of the page at `url`, best first. `before` (ISO) is the time the copy should be nearest to
   * (the day the material was seen; a later copy is fine), `after` (ISO) the earliest time accepted.
   * Throws ArchiveLookupError when the service could not answer (limit, timeout, network).
   */
  lookup(url: string, opts?: { before?: string; after?: string }): Promise<ArchivedCopy[]>;
}

/** What the archive lookup of one page found; goes into the material as provenance (no body). */
export type PageArchive = Omit<ArchivedCopy, "html"> & {
  /** The copy fed the page features (false: found but rejected, or the lookup gave no body). */
  used: boolean;
};

/** Result of the archive step for one landing page. */
export interface ArchiveOutcome {
  /** The copy to use; null when none was found or all were rejected. */
  copy: ArchivedCopy | null;
  /** Copies found but rejected (copies of an earlier owner of the domain, too old). */
  rejected: ArchivedCopy[];
  /** Per source: what happened, with the reason for a skipped or failed one. */
  tried: Array<{ source: ArchiveSource["name"]; status: "found" | "none" | "rejected" | "skipped" | "error"; reason?: string }>;
  /** A copy was older than the registration date of the domain (from RDAP): the page belonged to an earlier owner. */
  reRegistered: boolean;
  /** One line for the step report: "kopia z wayback z 2026-10-18" or why there is none. */
  summary: string;
}
