/** Reading of the Lista Ostrzeżeń CERT (the daily `domains.json`): pure parsing, the download is done in `scripts/watch.ts`. */

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Field names under which a list entry that is an object holds its domain (the list's format has changed between versions). */
const DOMAIN_FIELDS = ["DomainAddress", "domain", "Domain", "name", "host"];

/** Host name of one entry: scheme, path, port and a leading `*.` removed, lower case; null when it is not a host name. */
function hostOf(entry: string): string | null {
  const host = entry.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/^\*\./, "");
  return HOST.test(host) ? host : null;
}

/**
 * Domains of a list file: a JSON array of names or of objects with a domain field, or one name per line (`#` starts a
 * comment). Entries that are not host names are left out; the result is lower case, without duplicates, in file order.
 */
export function parseCertlist(text: string): string[] {
  let entries: string[];
  try {
    const json: unknown = JSON.parse(text);
    if (!Array.isArray(json)) return [];
    entries = json.flatMap((e): string[] => {
      if (typeof e === "string") return [e];
      const obj = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
      const field = DOMAIN_FIELDS.find((f) => typeof obj[f] === "string");
      return field ? [obj[field] as string] : [];
    });
  } catch {
    // not JSON: the plain-text form of the list, one name per line
    entries = text.split(/\r?\n/).filter((l) => !l.trim().startsWith("#"));
  }
  return [...new Set(entries.map(hostOf).filter((h): h is string => h !== null))];
}
