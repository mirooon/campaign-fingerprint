/**
 * Meta Ad Library as a common-interface source. Wraps the existing adapter (`lib/osint/adLibrary.ts`:
 * lookup by ad-library ID, detection of MetaAdsCollector) and adds search by phrase, advertiser,
 * country and date through `scripts/py/ad_library_search.py`. No API key and no login: MetaAdsCollector
 * uses the public web endpoint of the Ad Library, so it can stop working when Meta changes the page
 * (every failure comes back as an error with its reason). The official API needs a token; see the
 * README section on ad libraries.
 */
import path from "node:path";
import type { EnvMap } from "../media/asr";
import { defaultRunner, type ToolRunner } from "../media/tools";
import { adLibraryPython, adLibraryUrl, AD_LIBRARY_ID_RE, detectAdLibrary, lookupAdLibrary } from "../osint/adLibrary";
import { fetchAdCreative } from "./ytdlp";
import type { AdLibrarySource, AdRecord, AdSearchQuery } from "./types";

const HOW_TO_GET_ACCESS = "uv tool install meta-ads-collector (bez klucza; albo ustaw META_ADS_PYTHON na Pythona z tym pakietem)";

export interface MetaSourceOptions {
  run?: ToolRunner;
  env?: EnvMap;
  /** Clock for `fetchedAt` (ISO); tests pass a fixed one. */
  now?: () => string;
  /** `getAd` also asks yt-dlp for the creative (text, picture, start time); `ytDlp` is its binary (default: found on PATH). */
  creatives?: boolean;
  ytDlp?: string | null;
  /** Receives remarks about a lookup (e.g. the creative left out for lack of yt-dlp). */
  onNote?: (message: string) => void;
}

/** The non-blank strings of an array; empty for anything else. */
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
/** Trimmed text, or undefined for a missing or blank value. */
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
/** ISO time normalised to UTC with milliseconds, or undefined for a missing or unparseable value. */
const iso = (v: unknown): string | undefined => {
  const s = str(v);
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};

/**
 * Records of the search helper's stdout (`{"ads": [...]}`). The helper reports its own failure as
 * `{"error": "..."}`; that and any unreadable output throw with the reason, so an empty result is
 * never confused with a failed search.
 */
export function parseMetaSearchOutput(stdout: string, fetchedAt: string): AdRecord[] {
  const start = stdout.indexOf("{");
  let json: { ads?: Array<Record<string, unknown>>; error?: unknown };
  try {
    json = start < 0 ? {} : JSON.parse(stdout.slice(start));
  } catch {
    throw new Error("Meta: niepoprawny wynik skryptu wyszukiwania");
  }
  if (str(json.error)) throw new Error(`Meta: ${str(json.error)}`);
  if (!Array.isArray(json.ads)) throw new Error("Meta: niepoprawny wynik skryptu wyszukiwania (brak pola ads)");
  return json.ads.flatMap((a): AdRecord[] => {
    const adId = str(a.id);
    if (!adId) return [];
    const creatives: AdRecord["creatives"] = [
      ...arr(a.bodies).map((text) => ({ kind: "text" as const, text })),
      ...arr(a.imageUrls).map((url) => ({ kind: "image" as const, url })),
      ...arr(a.videoUrls).map((url) => ({ kind: "video" as const, url })),
    ];
    const name = str(a.pageName);
    return [
      {
        platform: "meta",
        adId,
        libraryUrl: adLibraryUrl(adId),
        fetchedAt,
        ...(name ? { advertiser: { name, id: str(a.pageId), verified: typeof a.pageVerified === "boolean" ? a.pageVerified : null } } : {}),
        payers: arr(a.payers),
        firstSeen: iso(a.deliveryStart),
        lastSeen: iso(a.deliveryStop),
        regions: arr(a.countries),
        creatives,
        landingUrl: arr(a.linkUrls)[0],
      },
    ];
  });
}

/** Meta source: `search` through MetaAdsCollector (no key), `getAd` through the existing lookup by library ID. */
export function createMetaSource(opts: MetaSourceOptions = {}): AdLibrarySource {
  const env = opts.env ?? process.env;
  const run = opts.run ?? defaultRunner;
  const now = opts.now ?? (() => new Date().toISOString());
  return {
    platform: "meta",
    async available() {
      const st = await detectAdLibrary({ run, env });
      return st.available ? { ok: true } : { ok: false, reason: st.reason ?? "MetaAdsCollector niedostępny", howToGetAccess: HOW_TO_GET_ACCESS };
    },
    async search(q: AdSearchQuery) {
      const python = await adLibraryPython(env);
      if (!python) throw new Error(`Meta: brak meta-ads-collector. ${HOW_TO_GET_ACCESS}`);
      const args = ["-I", path.join(process.cwd(), "scripts", "py", "ad_library_search.py"), "--country", q.country ?? "PL", "--limit", String(q.limit ?? 25)];
      if (q.keyword) args.push("--query", q.keyword);
      if (q.advertiser) args.push("--advertiser", q.advertiser);
      if (q.from) args.push("--from", q.from);
      if (q.to) args.push("--to", q.to);
      const r = await run(python, args, { timeoutMs: 120_000 });
      if (r.timedOut) throw new Error("Meta: przekroczony czas wyszukiwania");
      if (r.code !== 0) throw new Error(`Meta: ${(r.stderr.trim().split("\n").pop() ?? "błąd skryptu").slice(0, 200)}`);
      return parseMetaSearchOutput(r.stdout, now());
    },
    async getAd(adId: string) {
      if (!AD_LIBRARY_ID_RE.test(adId)) return null;
      const python = await adLibraryPython(env);
      if (!python) throw new Error(`Meta: brak meta-ads-collector. ${HOW_TO_GET_ACCESS}`);
      const info = (await lookupAdLibrary([adId], { python, run }))[adId];
      if (!info || info.error) return null;
      const got = opts.creatives ? await fetchAdCreative(adId, { run, env, ytDlp: opts.ytDlp }) : null;
      if (got?.error) opts.onNote?.(`Meta ${adId}: kreacja pominięta (${got.error})`);
      const c = got?.creative;
      const name = info.pageName ?? c?.uploader;
      return {
        platform: "meta",
        adId,
        libraryUrl: adLibraryUrl(adId),
        fetchedAt: now(),
        ...(name ? { advertiser: { name, id: info.pageId ?? c?.uploaderId ?? undefined, verified: info.pageVerification ? info.pageVerification !== "NOT_VERIFIED" : null } } : {}),
        payers: info.payers,
        firstSeen: c?.startedAt ?? undefined,
        regions: info.locations,
        creatives: [
          ...(c?.text ? [{ kind: "text" as const, text: c.text }] : []),
          ...(c?.imageUrl ? [{ kind: "image" as const, url: c.imageUrl }] : []),
          ...(c?.videoUrl ? [{ kind: "video" as const, url: c.videoUrl }] : []),
        ],
      };
    },
  };
}
