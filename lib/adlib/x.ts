/**
 * X (the DSA ads repository) as a common-interface source: IMPORT of the repository's CSV export, which
 * the user downloads (`X_ADS_FILE` or `adlib --x-file`). The repository is described as a page where one
 * queries an account, a country and a date range and gets a CSV (see ZRODLA-METADANYCH.md); the pages of X
 * refused an automatic read in this version, so the column names below are matched loosely (several
 * spellings per field) and NOT verified against a real export. The file is never fetched by the program.
 */
import { existsSync, readFileSync } from "node:fs";
import type { EnvMap } from "../media/asr";
import { parseCsv } from "../pipeline/ingest";
import { ADLIB_CONFIG } from "./config";
import type { AdLibrarySource, AdRecord, AdSearchQuery } from "./types";

const HOW_TO_GET_ACCESS = "download the CSV export of the X ad repository (instructions and status: docs/ZRODLA-METADANYCH.md), save the file and give it in X_ADS_FILE or --x-file";

/** Spellings of each column in the export, compared after folding case, spaces, dashes and underscores. */
const COLUMNS = {
  id: ["adid", "id", "adidentifier", "idreklamy"],
  advertiser: ["advertiser", "advertisername", "account", "accountname", "reklamodawca"],
  payer: ["fundedby", "fundingentity", "paidfor", "paidby", "payer", "platnik"],
  url: ["adurl", "url", "link", "adlink"],
  start: ["startdate", "start", "firstshown", "begindate", "datastartu"],
  end: ["enddate", "end", "lastshown", "stopdate", "datakonca"],
  country: ["country", "countries", "targetcountry", "region", "kraj"],
} as const;

/** Header spelling folded for comparison: lower case, letters and digits only. */
const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** ISO time of a date in the export ("2026-11-01" or with a time); undefined when missing or unreadable. */
const date = (v: string | undefined): string | undefined => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};

/** Records of the export's text. Throws with the missing columns when the file has no ad ID or advertiser column. */
export function parseXExport(content: string, fetchedAt: string): AdRecord[] {
  const rows = parseCsv(content);
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  /** Header of the column that holds a field, or undefined when the export has none. */
  const col = (field: keyof typeof COLUMNS) => headers.find((h) => (COLUMNS[field] as readonly string[]).includes(fold(h)));
  const c = Object.fromEntries((Object.keys(COLUMNS) as Array<keyof typeof COLUMNS>).map((f) => [f, col(f)])) as Record<keyof typeof COLUMNS, string | undefined>;
  const missing = (["id", "advertiser"] as const).filter((f) => !c[f]);
  if (missing.length) throw new Error(`X: the file does not look like an ad repository export, missing columns: ${missing.join(", ")} (present: ${headers.join(", ")})`);
  /** Trimmed value of a field in a row, undefined when the column or the value is missing. */
  const val = (row: Record<string, string>, f: keyof typeof COLUMNS) => (c[f] ? row[c[f] as string]?.trim() || undefined : undefined);
  return rows.flatMap((row): AdRecord[] => {
    const adId = val(row, "id");
    if (!adId) return [];
    const name = val(row, "advertiser");
    const payer = val(row, "payer");
    const country = val(row, "country");
    return [
      {
        platform: "x",
        adId,
        libraryUrl: val(row, "url") ?? `https://x.com/i/ads/${adId}`,
        fetchedAt,
        ...(name ? { advertiser: { name } } : {}),
        payers: payer ? [payer] : [],
        firstSeen: date(val(row, "start")),
        lastSeen: date(val(row, "end")),
        regions: country ? country.split(/[;,|]/).map((x) => x.trim().toUpperCase()).filter(Boolean) : [],
        creatives: [],
      },
    ];
  });
}

export interface XOptions {
  env?: EnvMap;
  /** File of the export; default: the X_ADS_FILE variable. */
  file?: string;
  now?: () => string;
}

/** X source over a downloaded export; `available()` is false without a readable file. */
export function createXSource(opts: XOptions = {}): AdLibrarySource {
  const env = opts.env ?? process.env;
  const now = opts.now ?? (() => new Date().toISOString());
  /** Path of the export: the option, else the environment variable. */
  const file = () => opts.file ?? env[ADLIB_CONFIG.x.fileEnv];
  /** All records of the export file. */
  const load = (): AdRecord[] => parseXExport(readFileSync(file() as string, "utf8"), now());
  return {
    platform: "x",
    async available() {
      const f = file();
      if (!f) return { ok: false, reason: `no export file (${ADLIB_CONFIG.x.fileEnv} or --x-file)`, howToGetAccess: HOW_TO_GET_ACCESS };
      return existsSync(f) ? { ok: true } : { ok: false, reason: `file ${f} does not exist`, howToGetAccess: HOW_TO_GET_ACCESS };
    },
    async search(q: AdSearchQuery) {
      /** Case-insensitive substring test; false for a missing text. */
      const has = (hay: string | undefined, needle: string) => !!hay && hay.toLowerCase().includes(needle.toLowerCase());
      const from = q.from ? Date.parse(q.from) : null;
      const to = q.to ? Date.parse(q.to) : null;
      return load()
        .filter((r) => !q.advertiser || has(r.advertiser?.name, q.advertiser))
        // an export has no ad text: a keyword can only match the advertiser and the funder
        .filter((r) => !q.keyword || has(r.advertiser?.name, q.keyword) || (r.payers ?? []).some((p) => has(p, q.keyword as string)))
        .filter((r) => !q.country || (r.regions ?? []).includes(q.country.toUpperCase()))
        .filter((r) => from === null || !r.lastSeen || Date.parse(r.lastSeen) >= from)
        .filter((r) => to === null || !r.firstSeen || Date.parse(r.firstSeen) <= to)
        .slice(0, q.limit ?? Number.POSITIVE_INFINITY);
    },
    async getAd(adId: string) {
      return load().find((r) => r.adId === adId) ?? null;
    },
  };
}
