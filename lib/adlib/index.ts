/**
 * Registry of ad-library sources and the search across them. `searchSources` is pure orchestration over
 * injected sources (no files, no network of its own); `createSources` builds the real ones.
 */
import type { EnvMap } from "../media/asr";
import type { ToolRunner } from "../media/tools";
import { ADLIB_CONFIG } from "./config";
import { createGoogleSource } from "./google";
import { createMetaSource } from "./meta";
import { createTikTokSource } from "./tiktok";
import { createXSource } from "./x";
import { AD_PLATFORMS, type AdLibrarySource, type AdPlatform, type AdRecord, type AdSearchQuery } from "./types";

export { adRecordToCaseDir } from "./caseDir";
export { adRecordToItem } from "./toItem";
export type { AdLibrarySource, AdPlatform, AdRecord, AdSearchQuery } from "./types";

export interface SourceOptions {
  run?: ToolRunner;
  env?: EnvMap;
  now?: () => string;
  onNote?: (message: string) => void;
  /** Meta `getAd` also fetches the creative with yt-dlp. */
  creatives?: boolean;
  /** File of the X ads repository export (default: X_ADS_FILE). */
  xFile?: string;
}

/** The sources of every platform, built from the environment (keys, Python, `bq`). */
export function createSources(opts: SourceOptions = {}): Record<AdPlatform, AdLibrarySource> {
  return {
    meta: createMetaSource(opts),
    google: createGoogleSource(opts),
    tiktok: createTikTokSource({ env: opts.env, now: opts.now }),
    x: createXSource({ env: opts.env, now: opts.now, file: opts.xFile }),
  };
}

/**
 * The queries of a search. A query that names a keyword or an advertiser stays as it is; otherwise the
 * default phrases and the names of public persons (impersonated in scam ads) each become a keyword query
 * with the same country, dates and limit.
 */
export function defaultQueries(base: AdSearchQuery, keywords: readonly string[], personaNames: readonly string[]): AdSearchQuery[] {
  if (base.keyword || base.advertiser) return [base];
  return [...keywords, ...personaNames].map((keyword) => ({ ...base, keyword }));
}

export interface SearchAllResult {
  records: AdRecord[];
  /** Sources that were not searched: unavailable, or not meant for default queries. */
  skipped: Array<{ platform: AdPlatform; reason: string; howToGetAccess?: string }>;
  /** Sources whose search failed (the others were still searched). */
  errors: Array<{ platform: AdPlatform; message: string }>;
}

/**
 * Searches the given platforms with the queries and merges the records (one per platform and ad ID).
 * An unavailable source is listed with its reason; a failing one is listed with the error and does not stop the rest.
 * With `defaultQueries` set, platforms whose search is paid by the query (Google: BigQuery bills whole columns
 * and a keyword only matches advertiser names) are skipped, so a bare `search` never spends their limit.
 */
export async function searchSources(
  sources: Partial<Record<AdPlatform, AdLibrarySource>>,
  platforms: readonly AdPlatform[],
  queries: AdSearchQuery[],
  opts: { defaultQueries?: boolean } = {},
): Promise<SearchAllResult> {
  const out: SearchAllResult = { records: [], skipped: [], errors: [] };
  const seen = new Set<string>();
  for (const platform of platforms) {
    const source = sources[platform];
    if (!source) {
      out.skipped.push({ platform, reason: "no source" });
      continue;
    }
    if (opts.defaultQueries && !ADLIB_CONFIG.defaultQueryPlatforms.includes(platform)) {
      out.skipped.push({ platform, reason: "default queries skipped: every query uses up the quota and a keyword matches advertiser names only (give --keyword or --advertiser)" });
      continue;
    }
    const access = await source.available();
    if (!access.ok) {
      out.skipped.push({ platform, reason: access.reason ?? "unavailable", ...(access.howToGetAccess ? { howToGetAccess: access.howToGetAccess } : {}) });
      continue;
    }
    for (const q of queries) {
      try {
        for (const rec of await source.search(q)) {
          const key = `${rec.platform}:${rec.adId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.records.push(rec);
        }
      } catch (e) {
        out.errors.push({ platform, message: (e as Error).message });
        break;
      }
    }
  }
  return out;
}

export { AD_PLATFORMS };
