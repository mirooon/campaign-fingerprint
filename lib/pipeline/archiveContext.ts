/**
 * Archive step options from the command-line flag and the environment (ARCHIVE_SOURCES, ANALYZE_OFFLINE),
 * shared by `analyze-material`, `enrich` and the GUI runner so that all of them read the switches the same way.
 */
import { archiveSourceNames, createArchiveSources, type ArchiveSource } from "../osint/archive";
import { lookupRdap, type RdapInfo } from "../osint/rdap";

export interface ArchiveStepOptions {
  sources: ArchiveSource[];
  /** Set when the step is turned off for this run; the step report shows it. */
  skipReason?: string;
  /** RDAP lookup for the era check of the domain (passive, cached), used when the page sources hold no record. */
  rdap?: (domain: string) => Promise<RdapInfo | null>;
}

/**
 * Options of the archive step, or null when it is off. The step is on with the flag (both sources) or
 * when ARCHIVE_SOURCES names sources ("urlscan,wayback"; unknown names throw). ANALYZE_OFFLINE=1 (the
 * container default) keeps the step on paper but skips it with the reason, so a run without network
 * says so instead of failing; `offline` does the same for a run that works on recorded fixtures.
 * `screenshotDir` is where urlscan screenshots of copies are saved.
 */
export function archiveStepOptions(o: { enabled: boolean; offline?: boolean; env?: Record<string, string | undefined>; screenshotDir?: string }): ArchiveStepOptions | null {
  const env = o.env ?? process.env;
  const { names, error } = archiveSourceNames(env.ARCHIVE_SOURCES);
  if (error) throw new Error(error);
  if (!o.enabled && !names.length) return null;
  if (o.offline || env.ANALYZE_OFFLINE === "1") return { sources: [], skipReason: "tryb offline: bez zapytań sieciowych do archiwów" };
  return { sources: createArchiveSources(names.length ? names : ["urlscan", "wayback"], { screenshotDir: o.screenshotDir }), rdap: (domain) => lookupRdap(domain) };
}
