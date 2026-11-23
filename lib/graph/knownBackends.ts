/**
 * Knowledge label for lead backends and validators that serve many scams, from public reports
 * (data/znane-backendy-leadow.json, each entry with its source). It only labels a premise: it does not
 * change any weight or linking rule (a backend of a service for many clients links weakly by itself).
 */
import list from "../../data/znane-backendy-leadow.json";

interface KnownBackend {
  domain: string;
  source: string;
  url: string;
}

const ENTRIES: KnownBackend[] = list.entries;

/**
 * Label "known lead backend (source: ...)" when `host` is a known backend or a subdomain of one;
 * null otherwise.
 */
export function knownBackendLabel(host: string): string | null {
  const h = host.toLowerCase();
  const hit = ENTRIES.find((e) => h === e.domain || h.endsWith(`.${e.domain}`));
  return hit ? `known lead backend (source: ${hit.source}, ${hit.url})` : null;
}
