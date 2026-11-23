/**
 * Google Ads Transparency Center through its public web RPC (`SearchService/SearchCreatives`,
 * `SearchSuggestions`), without logging in. It gives what BigQuery does not: the search by the domain
 * the ads point to. UNOFFICIAL: the service is meant for the Transparency Center page, not for programs,
 * so reading it may break its terms of use (see ZRODLA-METADANYCH.md and LICENCJE.md) and it can change
 * or block without notice. Switched off by default (`ADLIB_GOOGLE_RPC=1` switches it on).
 *
 * The request and the numbered fields of the answers were written from public descriptions of the web
 * client; they are NOT verified against the live service in this version, and the tests use synthetic
 * answers in that shape. The answer does not carry the full landing address, so the record's
 * `landingUrl` is the domain that was searched for (the search returns ads that point to it).
 */
import type { EnvMap } from "../media/asr";
import { ADLIB_CONFIG } from "./config";
import type { AdLibrarySource, AdRecord, AdSearchQuery } from "./types";

const CONF = ADLIB_CONFIG.googleRpc;
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const HOW_TO_ENABLE = `${CONF.enableEnv}=1 (unofficial RPC of the public page; the terms-of-service risk is described in docs/ZRODLA-METADANYCH.md)`;

/** Function that sends one form POST and returns the answer body (injected; the default uses `fetch`). */
export type RpcFetch = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string }) => Promise<string>;

/** Whether the text is a domain name (not a phrase): the only kind of keyword the RPC search takes. */
export function looksLikeDomain(text: string | undefined): boolean {
  return !!text && DOMAIN_RE.test(text.trim());
}

/** Form body (`f.req=…`) of a `SearchCreatives` request for ads that point to `domain`, optionally in one country. */
export function buildSearchCreativesBody(o: { domain: string; region?: string; pageSize: number }): string {
  const code = o.region ? CONF.regionCodes[o.region.toUpperCase()] : undefined;
  const req = { "2": o.pageSize, "3": { "12": { "1": o.domain, "2": true }, ...(code ? { "8": [code] } : {}), "13": { "1": [] } }, "7": { "1": 1 } };
  return new URLSearchParams({ "f.req": JSON.stringify(req) }).toString();
}

/** Trimmed text, or undefined for a missing or blank value. */
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
/** ISO time of a unix-seconds value that the answer carries as a string or a number; undefined when missing. */
const unix = (v: unknown): string | undefined => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : undefined;
};

/** JSON object of an answer body (the service may prefix it); throws one message for every unreadable answer. */
function parseJson(body: string): Record<string, unknown> {
  try {
    const json = JSON.parse(body.slice(Math.max(0, body.indexOf("{")))) as unknown;
    if (json && typeof json === "object") return json as Record<string, unknown>;
  } catch {
    // reported below with one message for every unreadable answer
  }
  throw new Error("Google RPC: invalid answer (not the service JSON; possibly blocked or the format changed)");
}

/** Records of a `SearchCreatives` answer; `domain` is the one searched for and becomes each record's landing address. */
export function parseSearchCreatives(body: string, o: { domain: string; fetchedAt: string }): AdRecord[] {
  const list = parseJson(body)["1"];
  if (!Array.isArray(list)) throw new Error("Google RPC: invalid answer (no ad list)");
  return list.flatMap((c): AdRecord[] => {
    const o1 = c as Record<string, unknown>;
    const adId = text(o1["2"]);
    const advertiserId = text(o1["1"]);
    if (!adId) return [];
    const name = text(o1["12"]) ?? advertiserId;
    return [
      {
        platform: "google",
        adId,
        libraryUrl: `https://adstransparency.google.com/advertiser/${advertiserId ?? ""}/creative/${adId}`,
        fetchedAt: o.fetchedAt,
        ...(name ? { advertiser: { name, id: advertiserId } } : {}),
        firstSeen: unix((o1["6"] as Record<string, unknown> | undefined)?.["1"]),
        lastSeen: unix((o1["7"] as Record<string, unknown> | undefined)?.["1"]),
        creatives: [],
        landingUrl: `https://${o.domain}/`,
      },
    ];
  });
}

/** Advertisers named by a `SearchSuggestions` answer (name, `AR…` ID, country). */
export function parseSuggestions(body: string): Array<{ name: string; advertiserId: string; country?: string }> {
  const list = parseJson(body)["1"];
  if (!Array.isArray(list)) throw new Error("Google RPC: invalid answer (no advertiser list)");
  return list.flatMap((e) => {
    const a = (e as { "1"?: Record<string, unknown> })["1"] ?? {};
    const name = text(a["1"]);
    const advertiserId = text(a["2"]);
    return name && advertiserId ? [{ name, advertiserId, country: text(a["3"]) }] : [];
  });
}

/** Form body of a `SearchSuggestions` request for advertisers whose name matches `name`. */
export function buildSuggestionsBody(name: string): string {
  return new URLSearchParams({ "f.req": JSON.stringify({ "1": name, "2": CONF.suggestionLimit, "3": CONF.suggestionLimit }) }).toString();
}

/** Default sender: `fetch` with a time limit, no cookies, no login. */
const defaultFetch: RpcFetch = async (url, init) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(CONF.timeoutMs) });
  if (!r.ok) throw new Error(`Google RPC: HTTP ${r.status}`);
  return r.text();
};

export interface GoogleRpcOptions {
  env?: EnvMap;
  fetchFn?: RpcFetch;
  now?: () => string;
}

/** Source of the Google RPC search by domain, plus the advertiser suggestions; `available()` is false until the switch is on. */
export function createGoogleRpcSource(opts: GoogleRpcOptions = {}): AdLibrarySource & { suggestAdvertisers(name: string): Promise<ReturnType<typeof parseSuggestions>> } {
  const env = opts.env ?? process.env;
  const send = opts.fetchFn ?? defaultFetch;
  const now = opts.now ?? (() => new Date().toISOString());
  const headers = { "content-type": "application/x-www-form-urlencoded", "user-agent": CONF.userAgent };
  return {
    platform: "google",
    async available() {
      return env[CONF.enableEnv] === "1" ? { ok: true } : { ok: false, reason: "searching by domain through the unofficial RPC is turned off", howToGetAccess: HOW_TO_ENABLE };
    },
    async search(q: AdSearchQuery) {
      const domain = q.keyword?.trim().toLowerCase();
      if (!domain || !looksLikeDomain(domain)) throw new Error("Google RPC: searches by domain only (--keyword oferta.example)");
      const body = buildSearchCreativesBody({ domain, region: q.country, pageSize: Math.min(q.limit ?? CONF.pageSize, CONF.pageSize) });
      return parseSearchCreatives(await send(`${CONF.base}/SearchService/SearchCreatives?authuser=`, { method: "POST", headers, body }), { domain, fetchedAt: now() });
    },
    async getAd() {
      return null;
    },
    /** Advertisers (name, `AR…` ID, country) whose name matches `name`: a way to the ID that BigQuery searches by. */
    async suggestAdvertisers(name: string) {
      return parseSuggestions(await send(`${CONF.base}/SearchService/SearchSuggestions?authuser=`, { method: "POST", headers, body: buildSuggestionsBody(name) }));
    },
  };
}
