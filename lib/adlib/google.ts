/**
 * Google Ads Transparency Center as a common-interface source, through the public BigQuery dataset
 * `bigquery-public-data.google_ads_transparency_center` (EEA + Turkey) and `scripts/py/google_atc.py`.
 * There is no official API and no scraping here. Access needs a Google account with a BigQuery sandbox
 * project (`gcloud auth application-default login`); without it `available()` is false.
 *
 * What the dataset gives: the advertiser account ID (`AR…`, stable when the display name changes), its
 * disclosed and legal name, country and verification status, the funder (`ad_funded_by`), regions and
 * dates of display. What it does not give: the ad text, the creative file and the landing domain, so the
 * records have no `landingUrl` and a keyword can only match advertiser names. There is no promise that a
 * search finds the ads of a known campaign.
 *
 * Every query is bounded by `ADLIB_CONFIG.google.maxBytesBilled` (BigQuery bills whole columns): the
 * script takes the richest level of detail that fits and `parseGoogleOutput` says what is missing.
 */
import { createCache, type FileCache } from "../cache";
import type { EnvMap } from "../media/asr";
import { defaultRunner, type ToolRunner } from "../media/tools";
import path from "node:path";
import { ADLIB_CONFIG, googleMaxBytes } from "./config";
import { createGoogleRpcSource, looksLikeDomain } from "./googleRpc";
import type { AdLibrarySource, AdRecord, AdSearchQuery } from "./types";

const HOW_TO_GET_ACCESS =
  "gcloud auth application-default login and gcloud config set project <project with a BigQuery sandbox> (without ADC the bq CLI also works after gcloud auth login); pip install google-cloud-bigquery";
const ADVERTISER_ID_RE = /^AR\d+$/;
const CREATIVE_ID_RE = /^CR\d+$/;

export interface GoogleSourceOptions {
  run?: ToolRunner;
  env?: EnvMap;
  now?: () => string;
  /** Result cache per query (default: the repository cache, namespace `adlib-google`). */
  cache?: FileCache;
  /** Source of the search by domain (the unofficial public RPC, off by default); default: `createGoogleRpcSource`. */
  rpc?: AdLibrarySource;
  /** Receives remarks about a search (e.g. columns left out by the byte limit). */
  onNote?: (message: string) => void;
}

interface GoogleRow {
  advertiser_id?: string | null;
  creative_id?: string | null;
  creative_page_url?: string | null;
  advertiser_disclosed_name?: string | null;
  advertiser_legal_name?: string | null;
  advertiser_location?: string | null;
  advertiser_verification_status?: string | null;
  ad_funded_by?: string | null;
  regions?: string[] | null;
  first_shown?: string | null;
  last_shown?: string | null;
}

interface GoogleOutput {
  rows?: GoogleRow[];
  detail?: "dates" | "regions" | "identity" | "lean";
  error?: string;
  kind?: string;
  howToGetAccess?: string;
}

/** Trimmed text, or undefined for a missing or blank value. */
const clean = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
/** Whether `a` equals `b` ignoring case (false for a missing `b`). */
const sameName = (a: string, b: string | undefined) => !!b && a.toLowerCase() === b.toLowerCase();
/** Day of the dataset ("2026-10-01") as an ISO time at 00:00 UTC; undefined when missing or unreadable. */
const day = (v: unknown): string | undefined => {
  const s = clean(v);
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};

/** Verification status of the dataset as a flag: `null` for a status the library does not state or that is not known. */
function verifiedFlag(status: string | undefined): boolean | null {
  if (!status) return null;
  if (/^verified$/i.test(status)) return true;
  if (/^(unverified|not[_ ]verified)$/i.test(status)) return false;
  return null;
}

/** Remarks about what the level of detail of an answer leaves out (empty for the richest level). */
function detailNotes(detail: GoogleOutput["detail"]): string[] {
  const hint = "raise ADLIB_BQ_MAX_BYTES to get them (the query uses up the BigQuery quota)";
  if (detail === "lean") return [`Google: the byte limit allowed only the basic columns, without the advertiser name, legal name, verification status, regions and dates; ${hint}`];
  if (detail === "identity") return [`Google: the byte limit allowed names and verification status, without regions and dates shown; ${hint}`];
  if (detail === "regions") return [`Google: the byte limit allowed regions, without dates shown; ${hint}`];
  return [];
}

/**
 * Records of the helper's stdout. A refused or failed query throws with the helper's message (the
 * estimate and the way out for an over-limit query, the access commands for a missing one), so an empty
 * result is never confused with a failure. `notes` tells what the level of detail left out.
 */
export function parseGoogleOutput(stdout: string, fetchedAt: string): { records: AdRecord[]; notes: string[] } {
  const start = stdout.indexOf("{");
  let json: GoogleOutput;
  try {
    json = start < 0 ? {} : JSON.parse(stdout.slice(start));
  } catch {
    throw new Error("Google: invalid output of the google_atc.py script");
  }
  if (json.error) throw new Error(`Google: ${json.error}${json.howToGetAccess ? `. ${json.howToGetAccess}` : ""}`);
  if (!Array.isArray(json.rows)) throw new Error("Google: invalid output of the google_atc.py script (no rows field)");
  const records = json.rows.flatMap((r): AdRecord[] => {
    const adId = clean(r.creative_id);
    if (!adId) return [];
    const id = clean(r.advertiser_id);
    const disclosed = clean(r.advertiser_disclosed_name);
    const legal = clean(r.advertiser_legal_name);
    const funder = clean(r.ad_funded_by);
    const name = disclosed ?? legal ?? id;
    return [
      {
        platform: "google",
        adId,
        libraryUrl: clean(r.creative_page_url) ?? `https://adstransparency.google.com/advertiser/${id ?? ""}/creative/${adId}`,
        fetchedAt,
        ...(name ? { advertiser: { name, id, legalName: legal, location: clean(r.advertiser_location), verified: verifiedFlag(clean(r.advertiser_verification_status)) } } : {}),
        // a funder equal to the advertiser says nothing new; only a different one is a payer
        payers: funder && !sameName(funder, disclosed) && !sameName(funder, legal) ? [funder] : [],
        firstSeen: day(r.first_shown),
        lastSeen: day(r.last_shown),
        regions: Array.isArray(r.regions) ? r.regions : [],
        creatives: [],
        raw: r,
      },
    ];
  });
  return { records, notes: detailNotes(json.detail) };
}

/** Google source: search and lookup through `google_atc.py` (BigQuery), with a per-query result cache. */
export function createGoogleSource(opts: GoogleSourceOptions = {}): AdLibrarySource {
  const env = opts.env ?? process.env;
  const run = opts.run ?? defaultRunner;
  const now = opts.now ?? (() => new Date().toISOString());
  const cache = opts.cache ?? createCache({ namespace: "adlib-google", defaultTtlMs: ADLIB_CONFIG.google.cacheTtlMs });
  const python = env[ADLIB_CONFIG.google.pythonEnv] || ADLIB_CONFIG.google.defaultPython;
  const script = path.join(process.cwd(), "scripts", "py", "google_atc.py");
  const rpc = opts.rpc ?? createGoogleRpcSource({ env, now });

  /** Runs the helper with the given arguments; the result of a successful query is cached by its arguments. */
  async function query(args: string[]): Promise<{ records: AdRecord[]; notes: string[] }> {
    const maxBytes = googleMaxBytes(env);
    const full = [script, ...args, "--max-bytes", String(maxBytes)];
    const result = await cache.wrap(
      JSON.stringify(full),
      async () => {
        const r = await run(python, full, { timeoutMs: ADLIB_CONFIG.google.timeoutMs });
        if (r.timedOut) throw new Error("Google: the BigQuery query timed out");
        if (r.code === null) throw new Error(`Google: could not start ${python} (${r.stderr.trim().slice(0, 120)})`);
        return parseGoogleOutput(r.stdout, now());
      },
      { ttlMs: ADLIB_CONFIG.google.cacheTtlMs },
    );
    for (const n of result.notes) opts.onNote?.(n);
    return result;
  }

  /** Whether BigQuery can be used now (`google_atc.py --check`), with the reason and the way to get access. */
  async function bigQueryAvailable(): Promise<{ ok: boolean; reason?: string; howToGetAccess?: string }> {
    const r = await run(python, [script, "--check"], { timeoutMs: 60_000 });
    if (r.code === null) return { ok: false, reason: `could not start ${python}: ${r.stderr.trim().slice(0, 120)}`, howToGetAccess: HOW_TO_GET_ACCESS };
    try {
      const j = JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))) as { ok?: boolean; reason?: string | null };
      return j.ok ? { ok: true } : { ok: false, reason: j.reason ?? "no access to BigQuery", howToGetAccess: HOW_TO_GET_ACCESS };
    } catch {
      return { ok: false, reason: `the google_atc.py script returned no answer (${(r.stderr.trim().split("\n").pop() ?? "").slice(0, 120)})`, howToGetAccess: HOW_TO_GET_ACCESS };
    }
  }

  /** Search in the BigQuery dataset: by advertiser (ID or name), advertiser-name keyword, display country and dates. */
  async function searchBigQuery(q: AdSearchQuery): Promise<AdRecord[]> {
    const args = ["--limit", String(q.limit ?? ADLIB_CONFIG.google.rowLimit)];
    if (q.advertiser) args.push("--advertiser", q.advertiser);
    if (q.keyword) args.push("--keyword", q.keyword);
    if (q.country) args.push("--country", q.country);
    if (q.from) args.push("--from", q.from);
    if (q.to) args.push("--to", q.to);
    // all creatives of an advertiser account: those displayed in the EEA, not only in Turkey
    if (q.advertiser && ADVERTISER_ID_RE.test(q.advertiser) && !q.country) args.push("--regions", ADLIB_CONFIG.google.eeaRegions.join(","));
    return (await query(args)).records;
  }

  return {
    platform: "google",
    async available() {
      const viaBigQuery = await bigQueryAvailable();
      if (viaBigQuery.ok) return viaBigQuery;
      // the search by domain still works through the RPC when it is switched on
      return (await rpc.available()).ok ? { ok: true } : viaBigQuery;
    },
    async search(q: AdSearchQuery) {
      if (looksLikeDomain(q.keyword)) {
        // BigQuery has no landing domain: a domain can only be searched through the RPC
        const a = await rpc.available();
        if (!a.ok) throw new Error(`Google: searching by domain needs the unofficial RPC. ${a.howToGetAccess ?? ""}`.trim());
        return rpc.search(q);
      }
      return searchBigQuery(q);
    },
    async getAd(adId: string) {
      if (!CREATIVE_ID_RE.test(adId)) return null;
      return (await query(["--creative", adId, "--limit", "1"])).records[0] ?? null;
    },
  };
}
