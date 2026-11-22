/**
 * Reads the local copy of the CERT Warning List (path in CERT_LIST_FILE or given by the caller).
 * The only I/O of the CERT status; the rules are in certList.ts. A missing or unreadable file is
 * reported with the reason, never silently treated as "not listed".
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { parseCertList, type CertListSnapshot } from "./certList";

export type CertListLoad = { snapshot: CertListSnapshot; reason: null } | { snapshot: null; reason: string };

/** Loads the list copy from `file` (default: env CERT_LIST_FILE); `reason` says why there is no snapshot. */
export function loadCertList(file: string | undefined = process.env.CERT_LIST_FILE): CertListLoad {
  if (!file) return { snapshot: null, reason: "nie podano lokalnej kopii listy (CERT_LIST_FILE albo --cert-list)" };
  if (!existsSync(file)) return { snapshot: null, reason: `brak pliku listy: ${file}` };
  try {
    return { snapshot: { entries: parseCertList(readFileSync(file, "utf8")), copyUtc: statSync(file).mtime.toISOString() }, reason: null };
  } catch (e) {
    return { snapshot: null, reason: `nie udało się wczytać listy ${file}: ${(e as Error).message}` };
  }
}
