/**
 * Passive DNS lookups (A/AAAA/CNAME/NS/MX/TXT) via node:dns/promises with a
 * per-query timeout, normalised output and a file cache.
 *
 * "No data" answers (ENODATA / ENOTFOUND / NXDOMAIN) are returned as empty
 * arrays; real failures (timeouts, SERVFAIL, refused) are recorded in `errors`.
 * Env: DNS_SERVERS="1.1.1.1,9.9.9.9" overrides the system resolvers.
 */
import { Resolver } from "node:dns/promises";
import { CACHE_TTL, createCache, type FileCache } from "../cache";
import { toAsciiHost } from "./urls";

export type DnsRecordType = "A" | "AAAA" | "CNAME" | "NS" | "MX" | "TXT";

export const ALL_DNS_TYPES: readonly DnsRecordType[] = ["A", "AAAA", "CNAME", "NS", "MX", "TXT"];

export interface DnsRecords {
  name: string;
  a: string[];
  aaaa: string[];
  cname: string[];
  ns: string[];
  mx: string[];
  txt: string[];
  errors: Partial<Record<DnsRecordType, string>>;
}

/** Minimal resolver surface (matches node:dns/promises Resolver); injectable for tests. */
export interface DnsResolverLike {
  resolve4(name: string): Promise<string[]>;
  resolve6(name: string): Promise<string[]>;
  resolveCname(name: string): Promise<string[]>;
  resolveNs(name: string): Promise<string[]>;
  resolveMx(name: string): Promise<Array<{ priority: number; exchange: string }>>;
  resolveTxt(name: string): Promise<string[][]>;
}

export interface DnsOptions {
  types?: DnsRecordType[];
  /** Per-query timeout in ms. Default 5000. */
  timeoutMs?: number;
  /** Resolver IPs. Default: env DNS_SERVERS (comma list), else the system resolvers. */
  servers?: string[];
  /** File cache; `false` disables caching. Default: namespace "dns", TTL 1 day. */
  cache?: FileCache | false;
  /** Custom resolver (tests). */
  resolver?: DnsResolverLike;
}

const DEFAULT_TIMEOUT_MS = 5000;

/** Error codes that mean "the name/record does not exist", not a failure. */
const NO_DATA_CODES = new Set(["ENODATA", "ENOTFOUND", "NXDOMAIN", "ENONAME", "NOTFOUND", "NODATA"]);

let defaultCache: FileCache | null = null;
function getDefaultCache(): FileCache {
  if (!defaultCache) defaultCache = createCache({ namespace: "dns", defaultTtlMs: CACHE_TTL.dns });
  return defaultCache;
}

function envServers(): string[] | undefined {
  const raw = process.env.DNS_SERVERS;
  if (!raw) return undefined;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : undefined;
}

function createResolver(timeoutMs: number, servers?: string[]): DnsResolverLike {
  let resolver: Resolver;
  try {
    resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  } catch {
    resolver = new Resolver();
  }
  if (servers && servers.length) resolver.setServers(servers);
  return resolver;
}

function errorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code) return code.replace(/^DNS_/, "");
  }
  if (err instanceof Error && err.message) return err.message;
  return "unknown";
}

class DnsTimeoutError extends Error {
  readonly code = "ETIMEOUT";
  constructor(name: string, type: string, ms: number) {
    super(`DNS ${type} ${name} timed out after ${ms} ms`);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, name: string, type: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DnsTimeoutError(name, type, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function normHost(h: string): string {
  return h.trim().replace(/\.$/, "").toLowerCase();
}

function uniqSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function normalizeName(name: string): string {
  const trimmed = normHost(name);
  return toAsciiHost(trimmed) ?? trimmed;
}

async function queryType(resolver: DnsResolverLike, name: string, type: DnsRecordType): Promise<string[]> {
  switch (type) {
    case "A":
      return uniqSorted(await resolver.resolve4(name));
    case "AAAA":
      return uniqSorted((await resolver.resolve6(name)).map((ip) => ip.toLowerCase()));
    case "CNAME":
      return uniqSorted((await resolver.resolveCname(name)).map(normHost));
    case "NS":
      return uniqSorted((await resolver.resolveNs(name)).map(normHost));
    case "MX": {
      const records = await resolver.resolveMx(name);
      const sorted = [...records].sort(
        (a, b) => a.priority - b.priority || normHost(a.exchange).localeCompare(normHost(b.exchange)),
      );
      const seen = new Set<string>();
      const out: string[] = [];
      for (const r of sorted) {
        const host = normHost(r.exchange);
        if (host && !seen.has(host)) {
          seen.add(host);
          out.push(host);
        }
      }
      return out;
    }
    case "TXT":
      return uniqSorted((await resolver.resolveTxt(name)).map((chunks) => chunks.join("")));
  }
}

const FIELD: Record<DnsRecordType, keyof Omit<DnsRecords, "name" | "errors">> = {
  A: "a",
  AAAA: "aaaa",
  CNAME: "cname",
  NS: "ns",
  MX: "mx",
  TXT: "txt",
};

async function resolveUncached(
  name: string,
  types: DnsRecordType[],
  timeoutMs: number,
  resolver: DnsResolverLike,
): Promise<DnsRecords> {
  const out: DnsRecords = { name, a: [], aaaa: [], cname: [], ns: [], mx: [], txt: [], errors: {} };
  const results = await Promise.allSettled(
    types.map((type) => withTimeout(queryType(resolver, name, type), timeoutMs, name, type)),
  );
  results.forEach((res, i) => {
    const type = types[i];
    if (res.status === "fulfilled") {
      out[FIELD[type]] = res.value;
      return;
    }
    const err: unknown = res.reason;
    if (err instanceof DnsTimeoutError) {
      out.errors[type] = "timeout";
      return;
    }
    const code = errorCode(err);
    if (!NO_DATA_CODES.has(code)) out.errors[type] = code;
  });
  return out;
}

/** Resolves the requested record types for a name (default: all six). */
export async function resolveDns(name: string, opts: DnsOptions = {}): Promise<DnsRecords> {
  const normalized = normalizeName(name);
  const types = [...new Set(opts.types ?? ALL_DNS_TYPES)].sort() as DnsRecordType[];
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const servers = opts.servers ?? envServers();
  const run = () =>
    resolveUncached(normalized, types, timeoutMs, opts.resolver ?? createResolver(timeoutMs, servers));

  if (opts.cache === false) return run();
  if (opts.cache) return wrapCached(opts.cache, normalized, types, servers, run);
  // An injected resolver without an explicit cache is a test double: keep it out of the shared cache.
  if (opts.resolver) return run();
  return wrapCached(getDefaultCache(), normalized, types, servers, run);
}

/** Cache key of a DNS answer: name, the (sorted) record types and the resolvers asked. Also read by `cache:freeze`. */
export function dnsCacheKey(name: string, types: DnsRecordType[], servers?: string[]): string {
  return `dns:${name}:${types.join(",")}:${(servers ?? []).join(",")}`;
}

function wrapCached(
  cache: FileCache,
  name: string,
  types: DnsRecordType[],
  servers: string[] | undefined,
  run: () => Promise<DnsRecords>,
): Promise<DnsRecords> {
  return cache.wrap(dnsCacheKey(name, types, servers), run, {
    shouldCache: (r) => Object.keys(r.errors).length < types.length,
  });
}

export interface TxtOptions {
  timeoutMs?: number;
  servers?: string[];
  resolver?: DnsResolverLike;
}

/**
 * TXT lookup returning joined strings; [] when the name has no TXT data.
 * Throws on real failures (timeout, SERVFAIL, ...).
 */
export async function resolveTxt(name: string, opts: TxtOptions = {}): Promise<string[]> {
  const normalized = normalizeName(name);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const resolver = opts.resolver ?? createResolver(timeoutMs, opts.servers ?? envServers());
  try {
    const chunks = await withTimeout(resolver.resolveTxt(normalized), timeoutMs, normalized, "TXT");
    return chunks.map((c) => c.join(""));
  } catch (err) {
    if (err instanceof DnsTimeoutError) throw err;
    if (NO_DATA_CODES.has(errorCode(err))) return [];
    throw err;
  }
}
