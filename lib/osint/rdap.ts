/**
 * RDAP domain lookups through the rdap.org bootstrap redirector.
 *
 * `parseRdap` is pure and tolerant of registry differences; `lookupRdap`
 * performs one passive HTTPS GET (cached for a week, 404 cached as null).
 */
import { createCache, TTL, type FileCache } from "../cache";
import { toAsciiHost } from "./urls";

export interface RdapInfo {
  domain: string;
  registrar: string | null;
  registrarIanaId: string | null;
  created: string | null;
  expires: string | null;
  updated: string | null;
  status: string[];
  nameservers: string[];
  abuseEmail: string | null;
  source: string | null;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RdapLookupOptions {
  /** Request timeout in ms. Default 10000. */
  timeoutMs?: number;
  /** File cache; `false` disables caching. Default: namespace "rdap", TTL 1 week. */
  cache?: FileCache | false;
  fetchImpl?: FetchLike;
}

export class RdapHttpError extends Error {
  constructor(
    readonly domain: string,
    readonly status: number,
  ) {
    super(`RDAP lookup for ${domain} failed: HTTP ${status}`);
    this.name = "RdapHttpError";
  }
}

const RDAP_BOOTSTRAP = "https://rdap.org/domain/";
const USER_AGENT = "hacknation-osint-starter/0.1 (passive RDAP lookup)";

type JsonRecord = Record<string, unknown>;

function asRecord(v: unknown): JsonRecord | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as JsonRecord) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function normHost(h: string): string {
  return h.trim().replace(/\.$/, "").toLowerCase();
}

function toIsoDate(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? s : new Date(t).toISOString();
}

function roles(entity: JsonRecord): string[] {
  return asArray(entity.roles)
    .map((r) => (typeof r === "string" ? r.toLowerCase() : ""))
    .filter(Boolean);
}

/** Value of a vCard (jCard) property, e.g. "fn" or "email". */
function vcardValue(entity: JsonRecord, prop: string): string | null {
  const vcard = asArray(entity.vcardArray);
  const props = asArray(vcard[1]);
  for (const p of props) {
    const entry = asArray(p);
    if (typeof entry[0] === "string" && entry[0].toLowerCase() === prop) {
      const value = entry[3];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (Array.isArray(value)) {
        const joined = value.filter((x): x is string => typeof x === "string" && x.trim() !== "").join(" ");
        if (joined) return joined.trim();
      }
    }
  }
  return null;
}

/** Depth-first walk over entities and their nested entities. */
function walkEntities(list: unknown, visit: (e: JsonRecord) => void, depth = 0): void {
  if (depth > 5) return;
  for (const raw of asArray(list)) {
    const e = asRecord(raw);
    if (!e) continue;
    visit(e);
    walkEntities(e.entities, visit, depth + 1);
  }
}

function findEntity(root: JsonRecord, role: string): JsonRecord | null {
  let found: JsonRecord | null = null;
  walkEntities(root.entities, (e) => {
    if (!found && roles(e).includes(role)) found = e;
  });
  return found;
}

/** Parses an RDAP domain response (RFC 9083). Never throws. */
export function parseRdap(json: unknown, domain: string): RdapInfo {
  const root = asRecord(json) ?? {};
  const info: RdapInfo = {
    domain: normHost(asString(root.ldhName) ?? domain),
    registrar: null,
    registrarIanaId: null,
    created: null,
    expires: null,
    updated: null,
    status: [],
    nameservers: [],
    abuseEmail: null,
    source: null,
  };

  const registrar = findEntity(root, "registrar");
  if (registrar) {
    info.registrar =
      vcardValue(registrar, "fn") ?? asString(registrar.name) ?? asString(registrar.handle) ?? null;
    for (const pid of asArray(registrar.publicIds)) {
      const rec = asRecord(pid);
      if (rec && asString(rec.type)?.toLowerCase() === "iana registrar id") {
        info.registrarIanaId = asString(rec.identifier) ?? (typeof rec.identifier === "number" ? String(rec.identifier) : null);
        break;
      }
    }
  }

  for (const raw of asArray(root.events)) {
    const ev = asRecord(raw);
    if (!ev) continue;
    const action = asString(ev.eventAction)?.toLowerCase();
    const date = toIsoDate(ev.eventDate);
    if (!action || !date) continue;
    if (action === "registration" && !info.created) info.created = date;
    else if (action === "expiration" && !info.expires) info.expires = date;
    else if (action === "last changed" && !info.updated) info.updated = date;
  }

  info.status = [
    ...new Set(
      asArray(root.status)
        .map((s) => (typeof s === "string" ? s.trim().toLowerCase() : ""))
        .filter(Boolean),
    ),
  ].sort();

  info.nameservers = [
    ...new Set(
      asArray(root.nameservers)
        .map((raw) => {
          const ns = asRecord(raw);
          const name = ns ? (asString(ns.ldhName) ?? asString(ns.unicodeName)) : null;
          return name ? normHost(name) : "";
        })
        .filter(Boolean),
    ),
  ].sort();

  const abuse = findEntity(root, "abuse");
  const abuseEmail = abuse ? vcardValue(abuse, "email") : null;
  info.abuseEmail = abuseEmail ? abuseEmail.replace(/^mailto:/i, "").toLowerCase() : null;

  for (const raw of asArray(root.links)) {
    const link = asRecord(raw);
    if (link && asString(link.rel)?.toLowerCase() === "self") {
      info.source = asString(link.href);
      if (info.source) break;
    }
  }

  return info;
}

/**
 * Whether RDAP statuses say the domain is off the air (registrar or registry hold). `holds` are the
 * statuses that count, lower case without spaces ("clienthold"); RDAP writes "client hold", EPP
 * "clientHold", so spaces and case are ignored. Empty statuses → false.
 */
export function rdapSuspended(status: string[] | null | undefined, holds: string[]): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
  const want = new Set(holds.map(norm));
  return (status ?? []).some((s) => want.has(norm(s)));
}

let defaultCache: FileCache | null = null;
function getDefaultCache(): FileCache {
  if (!defaultCache) defaultCache = createCache({ namespace: "rdap", defaultTtlMs: TTL.week });
  return defaultCache;
}

/**
 * RDAP lookup for a registrable domain. Returns null when the registry has no
 * record (HTTP 404); throws RdapHttpError on other HTTP failures.
 */
/** Cache key of an RDAP answer for an ASCII domain. Also read by `cache:freeze`. */
export function rdapCacheKey(asciiDomain: string): string {
  return `rdap:${asciiDomain}`;
}

export async function lookupRdap(domain: string, opts: RdapLookupOptions = {}): Promise<RdapInfo | null> {
  const ascii = toAsciiHost(domain);
  if (!ascii) throw new Error(`Invalid domain for RDAP: ${domain}`);
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = opts.timeoutMs ?? 10_000;

  const run = async (): Promise<RdapInfo | null> => {
    const res = await fetchImpl(`${RDAP_BOOTSTRAP}${encodeURIComponent(ascii)}`, {
      headers: { Accept: "application/rdap+json, application/json;q=0.9", "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new RdapHttpError(ascii, res.status);
    const json: unknown = await res.json();
    return parseRdap(json, ascii);
  };

  if (opts.cache === false) return run();
  const cache = opts.cache ?? getDefaultCache();
  return cache.wrap(rdapCacheKey(ascii), run);
}
