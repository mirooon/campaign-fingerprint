/**
 * Enrichment sources: the only place that touches the network.
 *
 * - liveSources(): passive lookups (one GET per page/hop, DNS, RDAP, crt.sh, Team Cymru),
 *   all cached in ./.cache.
 * - fixtureSources(dir): the same interface backed by recorded raw responses
 *   (HTML pages, DNS answers, raw RDAP JSON, raw crt.sh JSON, raw Cymru TXT), so the
 *   offline mode exercises the real parsers and redirect logic with zero network access.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CACHE_TTL, createCache } from "../cache";
import { lookupAsn, type AsnInfo } from "../osint/asn";
import { lookupCt, parseCrtSh, type CtResult } from "../osint/ct";
import { resolveDns, type DnsRecords, type DnsRecordType } from "../osint/dns";
import { fetchBinary, fetchPage, type FetchPageResult, type HopFn } from "../osint/fetchPage";
import { lookupRdap, parseRdap, type RdapInfo } from "../osint/rdap";
import { frozenSources, type FrozenData } from "./freeze";

export interface FetchOptions {
  /** Override the browser User-Agent (used by the opt-in cloaking check). */
  userAgent?: string;
}

export interface EnrichmentSources {
  mode: "live" | "offline";
  fetchPage(url: string, opts?: FetchOptions): Promise<FetchPageResult>;
  fetchBinary(url: string): Promise<Buffer | null>;
  dns(name: string, types: DnsRecordType[]): Promise<DnsRecords>;
  rdap(domain: string): Promise<RdapInfo | null>;
  ct(domain: string): Promise<CtResult | null>;
  asn(ip: string): Promise<AsnInfo | null>;
  /** Request URLs recorded with a page (HAR of a case, request list of a scan); offline fixtures only. */
  requestsFor?(url: string): string[] | null;
}

export interface LiveSourceOptions {
  fetchTimeoutMs?: number;
  /** Skip crt.sh (slow); also via env CT=off. */
  skipCt?: boolean;
  referer?: string;
}

function emptyDns(name: string): DnsRecords {
  return { name, a: [], aaaa: [], cname: [], ns: [], mx: [], txt: [], errors: {} };
}

/** Cache key of a fetched page: address and the User-Agent sent. Also read by `cache:freeze`. */
export function pageCacheKey(url: string, userAgent?: string): string {
  return `GET2 ${url} UA=${userAgent ?? "default"}`;
}

/** Cache key of a fetched binary (favicon, image) by address. Also read by `cache:freeze`. */
export function binaryCacheKey(url: string): string {
  return `GET-BIN ${url}`;
}

/**
 * Passive network sources with the answers cached in `.cache/` (pages, binaries, DNS, RDAP, crt.sh, ASN).
 * `cache:freeze` turns that cache into replayable fixtures.
 */
export function liveSources(opts: LiveSourceOptions = {}): EnrichmentSources {
  const pageCache = createCache({ namespace: "page", defaultTtlMs: CACHE_TTL.page });
  const binaryCache = createCache({ namespace: "binary", defaultTtlMs: CACHE_TTL.binary });
  const skipCt = opts.skipCt ?? /^(off|0|false|no)$/i.test(process.env.CT ?? "");
  return {
    mode: "live",
    fetchPage: (url, fo = {}) =>
      pageCache.wrap(
        pageCacheKey(url, fo.userAgent),
        () => fetchPage(url, { timeoutMs: opts.fetchTimeoutMs ?? 8_000, referer: opts.referer, userAgent: fo.userAgent }),
        // Do not cache transient failures.
        { shouldCache: (r) => r.errorCode !== "timeout" && r.errorCode !== "network" },
      ),
    fetchBinary: async (url) => {
      // cached as base64 JSON so that `cache:freeze` can replay favicons and images without the network
      const hit = await binaryCache.wrap(
        binaryCacheKey(url),
        async () => {
          const data = (await fetchBinary(url, { timeoutMs: opts.fetchTimeoutMs ?? 8_000 })).data;
          return data ? { base64: data.toString("base64") } : null;
        },
        { shouldCache: (v) => v !== null },
      );
      return hit ? Buffer.from(hit.base64, "base64") : null;
    },
    dns: (name, types) => resolveDns(name, { types }),
    rdap: (domain) => lookupRdap(domain),
    ct: (domain) => (skipCt ? Promise.resolve(null) : lookupCt(domain)),
    asn: (ip) => lookupAsn(ip),
  };
}

interface FixtureResponse {
  status: number;
  headers?: Record<string, string>;
  /** Path relative to the fixture directory. */
  bodyFile?: string;
  body?: string;
}

interface FixtureHttpEntry extends FixtureResponse {
  /** Alternative responses chosen when the request User-Agent contains `uaContains` (case-insensitive). */
  variants?: Array<FixtureResponse & { uaContains: string }>;
  /** URLs the page requested while it loaded (from the HAR), for traces visible only in the requests. */
  requests?: string[];
}

type FixtureDns = Record<string, Partial<Record<DnsRecordType, string[]>>>;

function readJson<T>(file: string, fallback: T): T {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
}

/** Offline sources backed by recorded raw responses in `dir`, or by the `frozen.json` of `cache:freeze` when the folder has one. */
export function fixtureSources(dir: string): EnrichmentSources {
  const frozenFile = path.join(dir, "frozen.json");
  if (existsSync(frozenFile)) return frozenSources(readJson<FrozenData>(frozenFile, { version: 1, pages: {}, binaries: {}, dns: {}, rdap: {}, ct: {}, asn: {} }));
  const http = readJson<Record<string, FixtureHttpEntry>>(path.join(dir, "http.json"), {});
  const dns = readJson<FixtureDns>(path.join(dir, "dns.json"), {});
  const cymru = readJson<Record<string, string[]>>(path.join(dir, "cymru.json"), {});
  const safeName = (s: string) => s.replace(/[^a-z0-9.-]/gi, "_");

  const hop: HopFn = async ({ url, headers }) => {
    const base = http[url.toString()];
    if (!base) {
      return { status: 404, headers: { "content-type": "text/plain" }, body: Buffer.from("not in fixtures"), truncated: false, remoteAddress: null };
    }
    const ua = (headers["user-agent"] ?? "").toLowerCase();
    const entry: FixtureResponse = base.variants?.find((v) => ua.includes(v.uaContains.toLowerCase())) ?? base;
    const body = entry.bodyFile
      ? readFileSync(path.join(dir, entry.bodyFile))
      : Buffer.from(entry.body ?? "", "utf8");
    return { status: entry.status, headers: entry.headers ?? {}, body, truncated: false, remoteAddress: null };
  };

  return {
    mode: "offline",
    fetchPage: (url, fo = {}) => fetchPage(url, { hop, userAgent: fo.userAgent }),
    fetchBinary: async (url) => (await fetchBinary(url, { hop })).data,
    dns: async (name, types) => {
      const rec = dns[name.toLowerCase()];
      const out = emptyDns(name.toLowerCase());
      if (!rec) return out;
      for (const t of types) {
        const values = rec[t] ?? [];
        const key = t.toLowerCase() as "a" | "aaaa" | "cname" | "ns" | "mx" | "txt";
        out[key] = [...values];
      }
      return out;
    },
    rdap: async (domain) => {
      const file = path.join(dir, "rdap", `${safeName(domain)}.json`);
      return existsSync(file) ? parseRdap(JSON.parse(readFileSync(file, "utf8")), domain) : null;
    },
    ct: async (domain) => {
      const file = path.join(dir, "crtsh", `${safeName(domain)}.json`);
      return existsSync(file) ? parseCrtSh(JSON.parse(readFileSync(file, "utf8")), domain) : null;
    },
    asn: (ip) => lookupAsn(ip, { txt: async (name) => cymru[name] ?? [], cache: false }),
    requestsFor: (url) => http[url]?.requests ?? null,
  };
}
