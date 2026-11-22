/**
 * Configuration of the ad-library sources: limits, defaults and lists (no numbers in the adapters).
 */
import type { EnvMap } from "../media/asr";

const GIB = 1024 ** 3;

export const ADLIB_CONFIG = {
  /** Meta search defaults when the query gives none. */
  meta: { country: "PL", limit: 25 },
  google: {
    /**
     * Highest number of bytes one BigQuery query may bill (`maximum_bytes_billed`; the script also refuses
     * a query whose dry-run estimate is higher). BigQuery bills whole columns: on 22.11 all creatives of one
     * advertiser ID cost 10.4 GB with the IDs, format, country and funder, 19.7 GB with the names and
     * verification status (`identity` level), 21.9 GB with the regions and 34.5 GB with the dates. The
     * script takes the richest level that fits, so a lower limit gives records without the legal name.
     * Env ADLIB_BQ_MAX_BYTES (e.g. "20GB") overrides it.
     */
    maxBytesBilled: 10 * GIB,
    /** Rows per query (BigQuery bills the columns, not the rows, so the limit only shortens the answer). */
    rowLimit: 100,
    /** Python of the helper script (needs `google-cloud-bigquery` for Application Default Credentials; else the `bq` CLI is used). */
    pythonEnv: "ADLIB_PYTHON",
    defaultPython: "python3",
    /** A query's rows are kept so that the same search is not billed again. */
    cacheTtlMs: 24 * 3_600_000,
    timeoutMs: 600_000,
    /**
     * Regions of the dataset that count as the European Economic Area (EU27, Iceland, Liechtenstein, Norway):
     * a search by advertiser ID returns the creatives displayed there, not those shown in Turkey only.
     */
    eeaRegions: [
      "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
      "IS", "LI", "NO",
    ],
  },
  /** Platforms searched by the default queries (phrases and persona names): where a phrase matches the ad text. */
  defaultQueryPlatforms: ["meta", "tiktok", "x"] as readonly string[],
  /**
   * Google ATC through its public web RPC (`googleRpc.ts`; unofficial, off by default). Region codes are
   * Google geo-target IDs; the endpoint and the field numbers of the answers were written from public
   * descriptions of the web client and NOT verified against the live service in this version.
   */
  googleRpc: {
    enableEnv: "ADLIB_GOOGLE_RPC",
    base: "https://adstransparency.google.com/anji/_/rpc",
    regionCodes: { PL: 2616, DE: 2276, FR: 2250, IT: 2380, ES: 2724, GB: 2826, CZ: 2203, SK: 2703 } as Readonly<Record<string, number>>,
    pageSize: 40,
    suggestionLimit: 10,
    timeoutMs: 30_000,
    userAgent: "odcisk-kampanii (research; passive reading of the public Ads Transparency Center)",
  },
  /**
   * TikTok Commercial Content Library API (needs an approved application: TIKTOK_CLIENT_KEY and
   * TIKTOK_CLIENT_SECRET). The endpoints, fields and answer shape were written from public descriptions
   * and are NOT verified against the live API in this version.
   */
  tiktok: {
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    queryUrl: "https://open.tiktokapis.com/v2/research/adlib/ad/query/",
    fields: "ad.id,ad.first_shown_date,ad.last_shown_date,ad.image_urls,ad.videos,advertiser.business_id,advertiser.business_name",
    adUrl: "https://library.tiktok.com/ads/detail/?ad_id=",
    maxCount: 50,
    timeoutMs: 30_000,
  },
  /** X (ads repository): the file of the repository's CSV export, downloaded by the user. */
  x: { fileEnv: "X_ADS_FILE" },
  /** Phrases of the default search (`adlib search` without --keyword): typical wording of investment-scam ads. */
  defaultKeywords: ["inwestycja", "zarabiaj", "platforma AI"],
} as const;

/** "20GB", "20GiB", "512MB" or a plain number of bytes -> bytes; `null` for an unreadable value. */
export function parseByteSize(text: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb|kib|mib|gib|tib)?\s*$/i.exec(text);
  if (!m) return null;
  const unit = (m[2] ?? "b").toLowerCase().replace("ib", "b");
  const pow = { b: 0, kb: 1, mb: 2, gb: 3, tb: 4 }[unit] ?? 0;
  return Math.round(Number(m[1]) * 1024 ** pow);
}

/** Byte limit of a Google query: ADLIB_BQ_MAX_BYTES when it is readable, else the configured default. */
export function googleMaxBytes(env: EnvMap = process.env): number {
  const fromEnv = env.ADLIB_BQ_MAX_BYTES ? parseByteSize(env.ADLIB_BQ_MAX_BYTES) : null;
  return fromEnv ?? ADLIB_CONFIG.google.maxBytesBilled;
}
