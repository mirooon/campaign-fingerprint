/**
 * `cache:freeze`: a live run leaves the answers it got in `.cache/` (pages, DNS, RDAP, crt.sh, ASN). This
 * turns them into a fixtures folder (`frozen.json`) that `--offline` replays, so a run made with network
 * access can be repeated without it, e.g. in the container. The cache holds parsed answers (not the raw
 * responses of the hand-recorded fixtures), so the frozen file has its own format and its own sources.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AsnInfo } from "../osint/asn";
import { asnCacheKey } from "../osint/asn";
import type { CtResult } from "../osint/ct";
import { ctCacheKey } from "../osint/ct";
import type { DnsRecords, DnsRecordType } from "../osint/dns";
import type { FetchPageResult } from "../osint/fetchPage";
import { fetchPage } from "../osint/fetchPage";
import { canonicalIp } from "../osint/ip";
import type { RdapInfo } from "../osint/rdap";
import { rdapCacheKey } from "../osint/rdap";
import { toAsciiHost } from "../osint/urls";
import { pageCacheKey, type EnrichmentSources } from "./sources";

/** Cache namespaces that hold what the sources fetch. */
export const FROZEN_NAMESPACES = ["page", "binary", "dns", "rdap", "ct", "asn"] as const;

/** One entry of a cache directory. */
export interface CacheDumpEntry {
  namespace: string;
  key: string;
  value: unknown;
}

/** Content of `frozen.json`. */
export interface FrozenData {
  version: 1;
  /** Pages by `pageCacheKey` (address and User-Agent). */
  pages: Record<string, FetchPageResult>;
  /** Favicons and images fetched by address, base64, by address. */
  binaries: Record<string, string>;
  /** DNS answers by name; every record type that was asked for is filled, the others stay empty. */
  dns: Record<string, DnsRecords>;
  /** RDAP by ASCII domain. */
  rdap: Record<string, RdapInfo>;
  /** crt.sh by ASCII domain. */
  ct: Record<string, CtResult>;
  /** Origin ASN by canonical IP. */
  asn: Record<string, AsnInfo>;
}

const DNS_FIELD: Record<DnsRecordType, "a" | "aaaa" | "cname" | "ns" | "mx" | "txt"> = { A: "a", AAAA: "aaaa", CNAME: "cname", NS: "ns", MX: "mx", TXT: "txt" };

/**
 * Reads the entries of the namespaces above from a cache directory (`<dir>/<namespace>/<xx>/<hash>.json`).
 * Entries are taken whatever their age: the point is the record of the run, not freshness. Reads files.
 */
export async function readCacheDump(cacheDir: string): Promise<CacheDumpEntry[]> {
  const out: CacheDumpEntry[] = [];
  for (const namespace of FROZEN_NAMESPACES) {
    const nsDir = path.join(cacheDir, namespace);
    let shards: string[];
    try {
      shards = readdirSync(nsDir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue; // nothing cached in this namespace
      throw e;
    }
    for (const shard of shards.sort()) {
      for (const file of readdirSync(path.join(nsDir, shard)).filter((f) => f.endsWith(".json")).sort()) {
        const entry = JSON.parse(readFileSync(path.join(nsDir, shard, file), "utf8")) as { key?: string; value?: unknown };
        if (typeof entry.key === "string" && entry.value !== undefined && entry.value !== null) out.push({ namespace, key: entry.key, value: entry.value });
      }
    }
  }
  return out;
}

/** Empty DNS answer for a name. */
function emptyDns(name: string): DnsRecords {
  return { name, a: [], aaaa: [], cname: [], ns: [], mx: [], txt: [], errors: {} };
}

/**
 * Cache entries -> frozen data. DNS answers asked for different record types of one name are merged;
 * entries whose key is not one of the source keys (e.g. crt.sh pattern searches) are left out.
 */
export function freezeEntries(entries: CacheDumpEntry[]): FrozenData {
  const frozen: FrozenData = { version: 1, pages: {}, binaries: {}, dns: {}, rdap: {}, ct: {}, asn: {} };
  for (const { namespace, key, value } of entries) {
    if (namespace === "page" && key.startsWith("GET2 ")) frozen.pages[key] = value as FetchPageResult;
    else if (namespace === "binary" && key.startsWith("GET-BIN ")) frozen.binaries[key.slice(8)] = (value as { base64: string }).base64;
    else if (namespace === "rdap" && key.startsWith("rdap:")) frozen.rdap[key.slice(5)] = value as RdapInfo;
    else if (namespace === "ct" && key.startsWith("ct:")) frozen.ct[key.slice(3)] = value as CtResult;
    else if (namespace === "asn" && key.startsWith("origin:")) frozen.asn[key.slice(7)] = value as AsnInfo;
    else if (namespace === "dns") {
      const m = /^dns:([^:]+):([^:]*):/.exec(key);
      if (!m) continue;
      const answer = value as DnsRecords;
      const merged = frozen.dns[m[1]] ?? emptyDns(m[1]);
      for (const type of m[2].split(",").filter((t): t is DnsRecordType => t in DNS_FIELD)) {
        const field = DNS_FIELD[type];
        merged[field] = [...answer[field]];
        if (answer.errors[type]) merged.errors[type] = answer.errors[type];
      }
      frozen.dns[m[1]] = merged;
    }
  }
  return frozen;
}

/**
 * Offline sources that answer from frozen data. What was not frozen answers like the recorded fixtures do
 * for an unknown address: a page with status 404, no DNS records, no RDAP, CT or ASN data.
 */
export function frozenSources(data: FrozenData): EnrichmentSources {
  const notFound = async () => ({ status: 404, headers: { "content-type": "text/plain" }, body: Buffer.from("not in frozen cache"), truncated: false, remoteAddress: null });
  return {
    mode: "offline",
    fetchPage: async (url, fo = {}) => data.pages[pageCacheKey(url, fo.userAgent)] ?? fetchPage(url, { hop: notFound, userAgent: fo.userAgent }),
    fetchBinary: async (url) => (data.binaries[url] ? Buffer.from(data.binaries[url], "base64") : null),
    dns: async (name, types) => {
      const have = data.dns[name.toLowerCase()];
      const out = emptyDns(name.toLowerCase());
      if (!have) return out;
      for (const type of types) {
        const field = DNS_FIELD[type];
        out[field] = [...have[field]];
        if (have.errors[type]) out.errors[type] = have.errors[type];
      }
      return out;
    },
    rdap: async (domain) => data.rdap[rdapCacheKey(toAsciiHost(domain) ?? domain).slice(5)] ?? null,
    ct: async (domain) => data.ct[ctCacheKey(toAsciiHost(domain) ?? domain).slice(3)] ?? null,
    asn: async (ip) => data.asn[asnCacheKey(canonicalIp(ip) ?? ip).slice(7)] ?? null,
  };
}
