/**
 * File-based JSON cache with TTL, used by every network enricher so that
 * repeated runs (and slow sources such as crt.sh) are cheap and reproducible.
 *
 * Layout: <dir>/<namespace>/<hash[0..2]>/<sha256(key)>.json
 * Env: CACHE_DIR (default ./.cache), CACHE=off disables reads and writes.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const TTL = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
} as const;

/** Time to live of each network and model cache, by namespace: one place for the values that the evidence pack quotes as retention. */
export const CACHE_TTL = {
  page: TTL.day,
  binary: TTL.day,
  embed: TTL.week * 4,
  imagehash: TTL.week,
  ner: TTL.week * 4,
  clip: TTL.week * 4,
  speaker: TTL.week * 4,
  adlibrary: TTL.day,
  asn: TTL.week,
  ct: TTL.day,
  rdap: TTL.week,
  dns: TTL.day,
  archive: TTL.day,
} as const;

export interface CacheOptions {
  namespace: string;
  dir?: string;
  defaultTtlMs?: number;
  enabled?: boolean;
  /** Clock override for tests. */
  now?: () => number;
}

interface CacheEntry<T> {
  key: string;
  createdAt: number;
  expiresAt: number;
  value: T;
}

export interface WrapOptions<T> {
  ttlMs?: number;
  /** Return false to skip caching a result (e.g. transient failures). */
  shouldCache?: (value: T) => boolean;
}

export interface FileCache {
  readonly namespace: string;
  readonly enabled: boolean;
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  wrap<T>(key: string, fn: () => Promise<T>, opts?: WrapOptions<T>): Promise<T>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function defaultCacheDir(): string {
  return process.env.CACHE_DIR || path.join(process.cwd(), ".cache");
}

export function cacheEnabledByEnv(): boolean {
  const v = (process.env.CACHE || "").toLowerCase();
  return !(v === "off" || v === "0" || v === "false" || v === "no");
}

export function createCache(opts: CacheOptions): FileCache {
  const dir = path.join(/*turbopackIgnore: true*/ opts.dir ?? defaultCacheDir(), opts.namespace.replace(/[^a-z0-9_-]/gi, "_"));
  const defaultTtl = opts.defaultTtlMs ?? TTL.day;
  const enabled = opts.enabled ?? cacheEnabledByEnv();
  const now = opts.now ?? Date.now;
  const inflight = new Map<string, Promise<unknown>>();

  const fileFor = (key: string) => {
    const h = hashKey(key);
    return path.join(dir, h.slice(0, 2), `${h}.json`);
  };

  async function get<T>(key: string): Promise<T | undefined> {
    if (!enabled) return undefined;
    try {
      const raw = await fs.readFile(fileFor(key), "utf8");
      const entry = JSON.parse(raw) as CacheEntry<T>;
      if (entry.key !== key) return undefined; // hash collision guard
      if (entry.expiresAt <= now()) return undefined;
      return entry.value;
    } catch {
      return undefined;
    }
  }

  async function set<T>(key: string, value: T, ttlMs = defaultTtl): Promise<void> {
    if (!enabled) return;
    const file = fileFor(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const entry: CacheEntry<T> = { key, createdAt: now(), expiresAt: now() + ttlMs, value };
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(entry), "utf8");
    await fs.rename(tmp, file);
  }

  async function wrap<T>(key: string, fn: () => Promise<T>, wrapOpts: WrapOptions<T> = {}): Promise<T> {
    const cached = await get<T>(key);
    if (cached !== undefined) return cached;
    const pending = inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;
    const p = (async () => {
      try {
        const value = await fn();
        if (value !== undefined && (wrapOpts.shouldCache?.(value) ?? true)) {
          await set(key, value, wrapOpts.ttlMs ?? defaultTtl);
        }
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  async function del(key: string): Promise<void> {
    await fs.rm(fileFor(key), { force: true });
  }

  async function clear(): Promise<void> {
    await fs.rm(dir, { recursive: true, force: true });
  }

  return { namespace: opts.namespace, enabled, get, set, wrap, delete: del, clear };
}
