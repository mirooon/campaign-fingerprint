/**
 * TikTok Commercial Content Library as a common-interface source, through its API (client-credentials
 * token from `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`; access is granted on application, in practice
 * to researchers). Without the keys `available()` is false with the way to apply.
 *
 * The endpoints, request filters and answer fields were written from public descriptions of the API and
 * are NOT verified against the live service in this version; the tests use synthetic answers in that shape.
 */
import type { EnvMap } from "../media/asr";
import { ADLIB_CONFIG } from "./config";
import type { AdLibrarySource, AdRecord, AdSearchQuery } from "./types";

const CONF = ADLIB_CONFIG.tiktok;
const HOW_TO_GET_ACCESS = "wniosek o dostęp do TikTok Commercial Content Library API na developers.tiktok.com (odpowiedź do 2 dni roboczych, możliwe tylko dla badaczy); potem TIKTOK_CLIENT_KEY i TIKTOK_CLIENT_SECRET w .env";

/** Sender of one POST (injected; the default uses `fetch`); returns the answer body. */
export type TikTokFetch = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string }) => Promise<string>;

const defaultFetch: TikTokFetch = async (url, init) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(CONF.timeoutMs) });
  return r.text();
};

/** "20261101" -> ISO time at 00:00 UTC; undefined for a missing or unreadable value. */
function compactDate(v: unknown): string | undefined {
  const m = typeof v === "string" ? /^(\d{4})(\d{2})(\d{2})$/.exec(v) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z` : undefined;
}
/** ISO day "2026-11-01" -> "20261101", the form of the API's date filters. */
const compact = (iso: string): string => iso.replace(/-/g, "");

interface TikTokAd {
  ad?: { id?: string; first_shown_date?: string; last_shown_date?: string; image_urls?: string[]; videos?: Array<{ video_url?: string }> };
  advertiser?: { business_id?: string; business_name?: string };
}

/** Records of a query answer; an API error or an unreadable answer throws with its reason. */
export function parseTikTokAds(body: string, fetchedAt: string): AdRecord[] {
  let json: { data?: { ads?: TikTokAd[] }; error?: { code?: string; message?: string } };
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error("TikTok: niepoprawna odpowiedź (to nie JSON)");
  }
  const err = json.error;
  if (err?.code && err.code !== "ok") throw new Error(`TikTok: ${err.message || err.code}`);
  if (!Array.isArray(json.data?.ads)) throw new Error("TikTok: niepoprawna odpowiedź (brak listy reklam)");
  return json.data.ads.flatMap((a): AdRecord[] => {
    const id = a.ad?.id;
    if (!id) return [];
    const name = a.advertiser?.business_name?.trim();
    return [
      {
        platform: "tiktok",
        adId: id,
        libraryUrl: `${CONF.adUrl}${id}`,
        fetchedAt,
        ...(name ? { advertiser: { name, id: a.advertiser?.business_id } } : {}),
        firstSeen: compactDate(a.ad?.first_shown_date),
        lastSeen: compactDate(a.ad?.last_shown_date),
        creatives: [
          ...(a.ad?.image_urls ?? []).map((url) => ({ kind: "image" as const, url })),
          ...(a.ad?.videos ?? []).flatMap((v) => (v.video_url ? [{ kind: "video" as const, url: v.video_url }] : [])),
        ],
      },
    ];
  });
}

export interface TikTokOptions {
  env?: EnvMap;
  fetchFn?: TikTokFetch;
  now?: () => string;
}

/** TikTok source; `available()` is false without the application keys. */
export function createTikTokSource(opts: TikTokOptions = {}): AdLibrarySource {
  const env = opts.env ?? process.env;
  const send = opts.fetchFn ?? defaultFetch;
  const now = opts.now ?? (() => new Date().toISOString());
  /** Whether both application keys are set. */
  const hasKeys = () => !!(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET);

  /** Client-credentials token of the application. */
  async function token(): Promise<string> {
    const body = new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY ?? "", client_secret: env.TIKTOK_CLIENT_SECRET ?? "", grant_type: "client_credentials" }).toString();
    const raw = await send(CONF.tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    let access: string | undefined;
    try {
      access = (JSON.parse(raw) as { access_token?: string }).access_token;
    } catch {
      // reported below with the same message as a missing token
    }
    if (!access) throw new Error("TikTok: brak tokenu w odpowiedzi (sprawdź klucze aplikacji)");
    return access;
  }

  /** Queries the library with the filters and extra body fields; returns the records of the answer. */
  async function query(filters: Record<string, unknown>, extra: Record<string, unknown>): Promise<AdRecord[]> {
    const bearer = await token();
    const raw = await send(`${CONF.queryUrl}?fields=${encodeURIComponent(CONF.fields)}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ filters, ...extra }),
    });
    return parseTikTokAds(raw, now());
  }

  return {
    platform: "tiktok",
    async available() {
      return hasKeys() ? { ok: true } : { ok: false, reason: "brak TIKTOK_CLIENT_KEY i TIKTOK_CLIENT_SECRET", howToGetAccess: HOW_TO_GET_ACCESS };
    },
    async search(q: AdSearchQuery) {
      const filters: Record<string, unknown> = {};
      if (q.country) filters.country = q.country.toUpperCase();
      if (q.advertiser) filters.advertiser_name = q.advertiser;
      if (q.from || q.to) filters.ad_published_date_range = { min: q.from ? compact(q.from) : undefined, max: q.to ? compact(q.to) : undefined };
      return query(filters, { ...(q.keyword ? { search_term: q.keyword } : {}), max_count: Math.min(q.limit ?? CONF.maxCount, CONF.maxCount) });
    },
    async getAd(adId: string) {
      return (await query({ ad_id: adId }, { max_count: 1 })).find((r) => r.adId === adId) ?? null;
    },
  };
}
