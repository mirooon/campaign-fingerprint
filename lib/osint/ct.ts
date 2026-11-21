/**
 * Certificate Transparency lookups through crt.sh (JSON output).
 *
 * crt.sh is slow and frequently answers 429/5xx or an HTML error page, so
 * `lookupCt` retries with exponential backoff + jitter and caches successes.
 * `parseCrtSh` is pure: it merges precertificate/leaf duplicates by serial and
 * normalises SAN names (lower-case, "*." stripped).
 */
import { createCache, TTL, type FileCache } from "../cache";
import { toAsciiHost } from "./urls";

export interface CertInfo {
  /** crt.sh id (lowest id of the merged precert/leaf pair). */
  id: string;
  serial: string | null;
  /** Issuer organisation (O=), else CN=, else the raw issuer DN. */
  issuer: string;
  /** Raw issuer DN as reported by crt.sh. */
  issuerName: string;
  commonName: string | null;
  sanDomains: string[];
  notBefore: string | null;
  notAfter: string | null;
  entryTimestamp: string | null;
}

export interface CtResult {
  domain: string;
  certs: CertInfo[];
  truncated: boolean;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CtLookupOptions {
  /** Per-attempt timeout in ms. Default 30000. */
  timeoutMs?: number;
  /** Retries after the first attempt. Default 3. */
  retries?: number;
  /** File cache; `false` disables caching. Default: namespace "ct", TTL 1 day. */
  cache?: FileCache | false;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Base backoff delay in ms. Default 2000. */
  baseDelayMs?: number;
  /** Max certificates kept after merging. Default 200. */
  maxCerts?: number;
}

const CRT_SH = "https://crt.sh/";
const USER_AGENT = "hacknation-osint-starter/0.1 (passive CT lookup)";
const MAX_RETRY_AFTER_MS = 60_000;

type JsonRecord = Record<string, unknown>;

function asRecord(v: unknown): JsonRecord | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as JsonRecord) : null;
}

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** crt.sh timestamps are UTC without a zone designator. */
function toIso(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`;
  const t = Date.parse(withZone);
  return Number.isNaN(t) ? s : new Date(t).toISOString();
}

/** Extracts an attribute (e.g. "O", "CN") from an X.500 DN string, handling quoted values. */
export function dnAttribute(dn: string, attr: string): string | null {
  const re = new RegExp(`(?:^|[,/]\\s*)${attr}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|([^,/]+))`, "i");
  const m = re.exec(dn);
  if (!m) return null;
  const value = (m[1] ?? m[2] ?? "").replace(/\\(.)/g, "$1").trim();
  return value || null;
}

function issuerLabel(issuerName: string): string {
  return dnAttribute(issuerName, "O") ?? dnAttribute(issuerName, "CN") ?? issuerName;
}

const HOSTNAME_RE = /^(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9-]{1,63}$/;

function normalizeSan(name: string): string | null {
  let n = name.trim().toLowerCase().replace(/\.$/, "");
  if (!n || n.includes("@") || n.includes(" ")) return null;
  while (n.startsWith("*.")) n = n.slice(2);
  const ascii = toAsciiHost(n) ?? n;
  return HOSTNAME_RE.test(ascii) ? ascii : null;
}

function sanList(nameValue: unknown, commonName: string | null): string[] {
  const names: string[] = [];
  const raw = asString(nameValue);
  if (raw) names.push(...raw.split(/\r?\n/));
  if (commonName) names.push(commonName);
  const out = new Set<string>();
  for (const n of names) {
    const norm = normalizeSan(n);
    if (norm) out.add(norm);
  }
  return [...out].sort();
}

function idNumber(id: string): number {
  const n = Number(id);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/** Parses crt.sh `output=json` rows into de-duplicated certificates. Never throws. */
export function parseCrtSh(json: unknown, domain: string, maxCerts = 200): CtResult {
  const result: CtResult = { domain: domain.trim().toLowerCase(), certs: [], truncated: false };
  if (!Array.isArray(json)) return result;

  const merged = new Map<string, CertInfo>();
  for (const raw of json) {
    const row = asRecord(raw);
    if (!row) continue;
    const id = asString(row.id);
    if (!id) continue;
    const serial = asString(row.serial_number)?.toLowerCase() ?? null;
    const issuerName = asString(row.issuer_name) ?? "";
    const commonName = asString(row.common_name)?.toLowerCase() ?? null;
    const cert: CertInfo = {
      id,
      serial,
      issuer: issuerName ? issuerLabel(issuerName) : "unknown",
      issuerName,
      commonName,
      sanDomains: sanList(row.name_value, commonName),
      notBefore: toIso(row.not_before),
      notAfter: toIso(row.not_after),
      entryTimestamp: toIso(row.entry_timestamp),
    };
    // Precertificate and final certificate share issuer + serial.
    const key = serial ? `${issuerName}|${serial}` : `id:${id}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, cert);
      continue;
    }
    const keepNew = idNumber(cert.id) < idNumber(existing.id);
    const base = keepNew ? cert : existing;
    const other = keepNew ? existing : cert;
    merged.set(key, {
      ...base,
      commonName: base.commonName ?? other.commonName,
      sanDomains: [...new Set([...base.sanDomains, ...other.sanDomains])].sort(),
      notBefore: base.notBefore ?? other.notBefore,
      notAfter: base.notAfter ?? other.notAfter,
      entryTimestamp:
        base.entryTimestamp && other.entryTimestamp
          ? base.entryTimestamp < other.entryTimestamp
            ? base.entryTimestamp
            : other.entryTimestamp
          : (base.entryTimestamp ?? other.entryTimestamp),
    });
  }

  const certs = [...merged.values()].sort((a, b) => {
    if (a.notBefore && b.notBefore && a.notBefore !== b.notBefore) return a.notBefore < b.notBefore ? 1 : -1;
    if (a.notBefore && !b.notBefore) return -1;
    if (!a.notBefore && b.notBefore) return 1;
    return idNumber(a.id) - idNumber(b.id);
  });
  result.truncated = certs.length > maxCerts;
  result.certs = certs.slice(0, maxCerts);
  return result;
}

let defaultCache: FileCache | null = null;
function getDefaultCache(): FileCache {
  if (!defaultCache) defaultCache = createCache({ namespace: "ct", defaultTtlMs: TTL.day });
  return defaultCache;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

/**
 * Looks up certificates for a domain on crt.sh. Returns null when every
 * attempt failed (nothing is cached in that case).
 */
export async function lookupCt(domain: string, opts: CtLookupOptions = {}): Promise<CtResult | null> {
  const ascii = toAsciiHost(domain);
  if (!ascii) throw new Error(`Invalid domain for CT lookup: ${domain}`);
  return queryCrtSh(ascii, `ct:${ascii}`, opts);
}

export interface CtSearchOptions extends CtLookupOptions {
  /** Ask crt.sh to leave out expired certificates. Default true. */
  excludeExpired?: boolean;
}

/**
 * crt.sh identity patterns: letters, digits, dots and hyphens with an optional % wildcard at the
 * start and/or the end ("finance%", "%.example.com"). crt.sh rejects % in the middle
 * ("Unsupported use of '%'").
 */
const SEARCH_PATTERN_RE = /^%?[a-z0-9._-]+%?$/;

/** crt.sh answered with an error page that retrying will not fix (e.g. an unsupported pattern). */
export class CrtShQueryError extends Error {}

/**
 * crt.sh identity search with % wildcards (e.g. "finance%", "%.example.com"), used to backfill
 * recent certificates for the CT watcher. Same retries and cache as lookupCt. Wildcard searches
 * are slow on crt.sh (timeouts and 502 are common); anchor them with a long literal prefix.
 */
export async function searchCt(pattern: string, opts: CtSearchOptions = {}): Promise<CtResult | null> {
  const p = pattern.trim().toLowerCase();
  if (!SEARCH_PATTERN_RE.test(p) || p.replace(/[%._-]/g, "").length < 3) {
    throw new Error(`Invalid crt.sh search pattern (letters, digits, ".", "-"; "%" only at the start or end; at least 3 literal characters): ${pattern}`);
  }
  const excludeExpired = opts.excludeExpired ?? true;
  return queryCrtSh(p, `ct-search:${p}${excludeExpired ? ":valid" : ""}`, { maxCerts: 1000, ...opts }, excludeExpired ? "&exclude=expired" : "");
}

async function queryCrtSh(q: string, cacheKey: string, opts: CtLookupOptions, extraParams = ""): Promise<CtResult | null> {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const sleep = opts.sleep ?? defaultSleep;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const retries = Math.max(0, opts.retries ?? 3);
  const baseDelay = opts.baseDelayMs ?? 2000;
  const maxCerts = opts.maxCerts ?? 200;
  const url = `${CRT_SH}?q=${encodeURIComponent(q)}&output=json${extraParams}`;

  const run = async (): Promise<CtResult | null> => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      let hinted: number | null = null;
      try {
        const res = await fetchImpl(url, {
          headers: { Accept: "application/json", "User-Agent": USER_AGENT },
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.ok) {
          const body = await res.text();
          let json: unknown;
          try {
            json = JSON.parse(body);
          } catch {
            json = undefined; // HTML error page or truncated body: retry
          }
          if (json !== undefined) return parseCrtSh(json, q, maxCerts);
          if (/Unsupported use of/i.test(body)) throw new CrtShQueryError(`crt.sh rejected the query: ${q}`);
        } else if (res.status === 429 || res.status >= 500) {
          hinted = retryAfterMs(res);
        } else {
          return null; // other 4xx: not retryable
        }
      } catch (e) {
        if (e instanceof CrtShQueryError) throw e;
        // network error or timeout: retry
      }
      if (attempt < retries) {
        const backoff = baseDelay * 2 ** attempt + Math.floor(Math.random() * 500);
        await sleep(hinted ?? backoff);
      }
    }
    return null;
  };

  if (opts.cache === false) return run();
  const cache = opts.cache ?? getDefaultCache();
  return cache.wrap(cacheKey, run, { shouldCache: (v) => v !== null });
}
