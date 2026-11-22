/**
 * Meta Ad Library lookup by ad-library ID (the "Identyfikator biblioteki" on a screenshot or the
 * id= in an Ad Library link), through MetaAdsCollector — no API key, no identity verification.
 *
 * Returns the DSA transparency data of the "See ad details" panel: the declared payer and
 * beneficiary (the same payer on different ads is a strong link: one paying account), whether Meta
 * took the ad down and for which policy, EU reach and the targeted audience. Works for removed ads.
 *
 * Runs scripts/py/ad_library.py with the Python of the MetaAdsCollector install: env
 * META_ADS_PYTHON, else the interpreter in the shebang of `meta-ads-collector` on PATH
 * (`uv tool install meta-ads-collector`). It uses the public web endpoint of the Ad Library, so it
 * can stop working when Meta changes the page; every failure comes back as an error, never thrown.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { EnvMap } from "../media/asr";
import { defaultRunner, which, type ToolRunner } from "../media/tools";

/** Creative of a library ad as yt-dlp reads it from the library page (`lib/adlib/ytdlp.ts`). */
export interface AdCreativeInfo {
  text: string | null;
  title: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  uploader: string | null;
  uploaderId: string | null;
  /** ISO time the ad was started (the library's timestamp), or null. */
  startedAt: string | null;
}

export interface AdLibraryInfo {
  id: string;
  payers: string[];
  beneficiaries: string[];
  /** Meta removed the ad (is_ad_taken_down). */
  takenDown: boolean | null;
  /** Names of the violated ad policies, e.g. "Prohibited Commercial Practices". */
  violations: string[];
  euReach: number | null;
  ageMin: number | null;
  ageMax: number | null;
  gender: string | null;
  locations: string[];
  pageId: string | null;
  pageName: string | null;
  pageDeleted: boolean | null;
  pageVerification: string | null;
  /** When the record was fetched (UTC ISO); absent in records cached before the field existed. */
  fetchedAt?: string | null;
  /** SHA-256 of the adapter's raw JSON record of this ID (compact JSON.stringify of the parsed answer), so the answer can be checked later. */
  rawSha256?: string | null;
  error: string | null;
  /** Creative of the ad (yt-dlp, `--ad-library`); absent when it was not asked for. */
  creative?: AdCreativeInfo | null;
  /** Why `creative` is null although it was asked for (no yt-dlp, the page did not answer). */
  creativeNote?: string | null;
}

export interface AdLibraryStatus {
  available: boolean;
  python: string | null;
  reason: string | null;
}

export const AD_LIBRARY_ID_RE = /^\d{12,20}$/;

export function adLibraryUrl(id: string): string {
  return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&id=${id}`;
}

/** Python of the MetaAdsCollector install: META_ADS_PYTHON or the shebang of the CLI. */
export async function adLibraryPython(env: EnvMap = process.env): Promise<string | null> {
  if (env.META_ADS_PYTHON) return env.META_ADS_PYTHON;
  const cli = await which("meta-ads-collector", env);
  if (!cli) return null;
  try {
    const first = (await readFile(cli, "utf8")).split("\n", 1)[0];
    const m = /^#!\s*(\S+)/.exec(first);
    return m && path.isAbsolute(m[1]) ? m[1] : null;
  } catch {
    return null;
  }
}

export async function detectAdLibrary(opts: { run?: ToolRunner; env?: EnvMap } = {}): Promise<AdLibraryStatus> {
  const run = opts.run ?? defaultRunner;
  const python = await adLibraryPython(opts.env ?? process.env);
  if (!python) return { available: false, python: null, reason: "brak meta-ads-collector (uv tool install meta-ads-collector) albo META_ADS_PYTHON" };
  const r = await run(python, ["-I", "-c", "import meta_ads_collector"], { timeoutMs: 30_000 });
  if (r.code !== 0) return { available: false, python, reason: `${python}: brak pakietu meta_ads_collector` };
  return { available: true, python, reason: null };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.map(str).filter((s): s is string => !!s))] : []);

export function emptyAdLibraryInfo(id: string, error: string | null): AdLibraryInfo {
  return {
    id, payers: [], beneficiaries: [], takenDown: null, violations: [], euReach: null, ageMin: null, ageMax: null,
    gender: null, locations: [], pageId: null, pageName: null, pageDeleted: null, pageVerification: null, error,
  };
}

/** Parses the helper's stdout into one record per requested ID. */
export function parseAdLibraryOutput(stdout: string, ids: string[]): Record<string, AdLibraryInfo> {
  const out: Record<string, AdLibraryInfo> = Object.fromEntries(ids.map((id) => [id, emptyAdLibraryInfo(id, "brak odpowiedzi")]));
  const start = stdout.indexOf("{");
  if (start < 0) return out;
  let ads: Record<string, Record<string, unknown>> = {};
  try {
    ads = (JSON.parse(stdout.slice(start)) as { ads?: typeof ads }).ads ?? {};
  } catch {
    return out;
  }
  for (const id of ids) {
    const r = ads[id];
    if (!r) continue;
    if (str(r.error)) {
      out[id] = emptyAdLibraryInfo(id, str(r.error));
      continue;
    }
    const pageId = r.pageId === null || r.pageId === undefined ? null : String(r.pageId);
    out[id] = {
      id,
      payers: strs(r.payers),
      beneficiaries: strs(r.beneficiaries),
      takenDown: bool(r.takenDown),
      violations: strs(r.violations),
      euReach: num(r.euReach),
      ageMin: num(r.ageMin),
      ageMax: num(r.ageMax),
      gender: str(r.gender),
      locations: strs(r.locations),
      pageId: pageId && /^\d+$/.test(pageId) && pageId !== "0" ? pageId : null,
      pageName: str(r.pageName),
      pageDeleted: bool(r.pageDeleted),
      pageVerification: str(r.pageVerification),
      fetchedAt: null,
      rawSha256: createHash("sha256").update(JSON.stringify(r)).digest("hex"),
      error: null,
    };
  }
  return out;
}

export function adLibraryScript(): string {
  return path.join(process.cwd(), "scripts", "py", "ad_library.py");
}

/** Looks up the given ad-library IDs (one Python process, ~1 s between requests). */
export async function lookupAdLibrary(
  ids: string[],
  opts: { run?: ToolRunner; python: string; timeoutMs?: number; now?: () => Date },
): Promise<Record<string, AdLibraryInfo>> {
  const valid = [...new Set(ids.filter((id) => AD_LIBRARY_ID_RE.test(id)))];
  if (!valid.length) return {};
  const run = opts.run ?? defaultRunner;
  const r = await run(opts.python, ["-I", adLibraryScript(), ...valid], { timeoutMs: opts.timeoutMs ?? 60_000 + 10_000 * valid.length });
  if (r.code !== 0 || r.timedOut) {
    const why = r.timedOut ? "przekroczony czas" : (r.stderr.trim().split("\n").pop() ?? "błąd").slice(0, 200);
    return Object.fromEntries(valid.map((id) => [id, emptyAdLibraryInfo(id, why)]));
  }
  const fetchedAt = (opts.now?.() ?? new Date()).toISOString();
  return Object.fromEntries(Object.entries(parseAdLibraryOutput(r.stdout, valid)).map(([id, rec]) => [id, { ...rec, fetchedAt }]));
}
