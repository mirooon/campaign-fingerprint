/**
 * IP -> ASN mapping through Team Cymru's DNS interface (passive TXT lookups):
 *   <reversed-ipv4>.origin.asn.cymru.com   -> "ASN | prefix | CC | registry | allocated"
 *   <ipv6-nibbles>.origin6.asn.cymru.com   -> same format
 *   AS<n>.asn.cymru.com                    -> "ASN | CC | registry | allocated | AS name"
 */
import { createCache, TTL, type FileCache } from "../cache";
import { resolveTxt } from "./dns";
import { canonicalIp, parseCidr, parseIp, reverseIPv4, reverseIPv6Nibbles } from "./ip";

export interface AsnInfo {
  ip: string;
  /** Primary origin ASN (first listed); null when the IP is not announced. */
  asn: number | null;
  /** All origin ASNs (MOAS prefixes list several). */
  asns: number[];
  prefix: string | null;
  country: string | null;
  registry: string | null;
  allocated: string | null;
  asName: string | null;
}

export interface CymruOrigin {
  asns: number[];
  prefix: string | null;
  country: string | null;
  registry: string | null;
  allocated: string | null;
}

export interface CymruAsName {
  asn: number;
  country: string | null;
  registry: string | null;
  allocated: string | null;
  asName: string | null;
}

export interface AsnLookupOptions {
  /** TXT resolver (tests / fixtures). Default: dns.resolveTxt. */
  txt?: (name: string) => Promise<string[]>;
  /** File cache; `false` disables caching. Default: namespace "asn", TTL 1 week. */
  cache?: FileCache | false;
  /** DNS timeout in ms for the default resolver. Default 5000. */
  timeoutMs?: number;
}

export function cymruOriginQuery(ip: string): string | null {
  const parsed = parseIp(ip);
  if (!parsed) return null;
  if (parsed.version === 4) {
    const rev = reverseIPv4(ip);
    return rev ? `${rev}.origin.asn.cymru.com` : null;
  }
  const nibbles = reverseIPv6Nibbles(ip);
  return nibbles ? `${nibbles}.origin6.asn.cymru.com` : null;
}

export function cymruAsNameQuery(asn: number): string {
  return `AS${asn}.asn.cymru.com`;
}

function fields(txt: string): string[] {
  return txt
    .trim()
    .replace(/^"+|"+$/g, "")
    .split("|")
    .map((f) => f.trim());
}

function orNull(v: string | undefined): string | null {
  return v && v.trim() ? v.trim() : null;
}

function parseAsns(field: string | undefined): number[] {
  if (!field) return [];
  const out: number[] = [];
  for (const tok of field.split(/\s+/)) {
    const n = Number(tok.replace(/^AS/i, ""));
    if (Number.isInteger(n) && n > 0 && n <= 4294967295 && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Parses one origin TXT answer: "13335 | 104.16.0.0/13 | US | arin | 2014-03-28". */
export function parseCymruOrigin(txt: string): CymruOrigin | null {
  const f = fields(txt);
  const asns = parseAsns(f[0]);
  if (!asns.length) return null;
  const prefix = orNull(f[1]);
  return {
    asns,
    prefix: prefix && parseCidr(prefix) ? prefix : null,
    country: orNull(f[2])?.toUpperCase() ?? null,
    registry: orNull(f[3])?.toLowerCase() ?? null,
    allocated: orNull(f[4]),
  };
}

/** Picks the most specific prefix among several origin TXT answers. */
export function pickCymruOrigin(answers: string[]): CymruOrigin | null {
  let best: CymruOrigin | null = null;
  let bestLen = -1;
  for (const a of answers) {
    const parsed = parseCymruOrigin(a);
    if (!parsed) continue;
    const len = parsed.prefix ? (parseCidr(parsed.prefix)?.prefix ?? 0) : 0;
    if (len > bestLen) {
      best = parsed;
      bestLen = len;
    }
  }
  return best;
}

/** Parses an AS name TXT answer: "13335 | US | arin | 2010-07-14 | CLOUDFLARENET - Cloudflare, Inc., US". */
export function parseCymruAsName(txt: string): CymruAsName | null {
  const f = fields(txt);
  const asn = parseAsns(f[0])[0];
  if (!asn) return null;
  return {
    asn,
    country: orNull(f[1])?.toUpperCase() ?? null,
    registry: orNull(f[2])?.toLowerCase() ?? null,
    allocated: orNull(f[3]),
    asName: orNull(f.slice(4).join("|")),
  };
}

let defaultCache: FileCache | null = null;
function getDefaultCache(): FileCache {
  if (!defaultCache) defaultCache = createCache({ namespace: "asn", defaultTtlMs: TTL.week });
  return defaultCache;
}

/** Cache key of the origin lookup for a canonical IP. Also read by `cache:freeze`. */
export function asnCacheKey(canonicalIpAddress: string): string {
  return `origin:${canonicalIpAddress}`;
}

/**
 * Maps an IP to its origin ASN(s) and AS name. Returns null when the IP is
 * invalid or not announced. Errors of the origin query propagate; a failing
 * AS-name query only leaves `asName` null.
 */
export async function lookupAsn(ip: string, opts: AsnLookupOptions = {}): Promise<AsnInfo | null> {
  const canonical = canonicalIp(ip);
  if (!canonical) return null;
  const query = cymruOriginQuery(canonical);
  if (!query) return null;
  const txt = opts.txt ?? ((name: string) => resolveTxt(name, { timeoutMs: opts.timeoutMs }));
  const cache = opts.cache === false ? null : (opts.cache ?? (opts.txt ? null : getDefaultCache()));

  const asNameFor = async (asn: number): Promise<string | null> => {
    const fetchName = async () => {
      const answers = await txt(cymruAsNameQuery(asn));
      for (const a of answers) {
        const parsed = parseCymruAsName(a);
        if (parsed?.asName) return parsed.asName;
      }
      return null;
    };
    try {
      return cache ? await cache.wrap(`asname:${asn}`, fetchName) : await fetchName();
    } catch {
      return null;
    }
  };

  const run = async (): Promise<AsnInfo | null> => {
    const origin = pickCymruOrigin(await txt(query));
    if (!origin) return null;
    const asn = origin.asns[0] ?? null;
    return {
      ip: canonical,
      asn,
      asns: origin.asns,
      prefix: origin.prefix,
      country: origin.country,
      registry: origin.registry,
      allocated: origin.allocated,
      asName: asn !== null ? await asNameFor(asn) : null,
    };
  };

  return cache ? cache.wrap(asnCacheKey(canonical), run) : run();
}
