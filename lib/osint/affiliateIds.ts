/**
 * Accounts of an affiliate network in order links, base64 `referer` parameters and hidden form fields of a
 * lander (B-330). The click link of the network (`click.php?key=…&team_id=42&user_id=13&…`) and the lead form
 * that posts to it carry the affiliate's team and user, the stream (flow) to the offer and the offer's UUID.
 * Small numbers name an account only on one network, so every ID is scoped to the network host: the host of
 * the order link or of the form action. An `api_key` is a secret: only its SHA-256 is returned.
 *
 * Extraction only, pure functions, no network access.
 */
import { createHash } from "node:crypto";
import { scanTags } from "./extract";

/** Kind of an affiliate-network ID: the team+user pair, a stream, an offer UUID or the hash of an API key. */
export type AffiliateIdKind = "team_user" | "stream" | "offer_uuid" | "api_key";

export interface AffiliateId {
  kind: AffiliateIdKind;
  /** Host of the network: the order link's or the form action's host, lower-cased. */
  host: string;
  /** Value: "42/13" for team_user, the stream or offer ID, the SHA-256 (hex) of the key for api_key. */
  value: string;
  /** Where it was found: a link address, a hidden form field, or a base64 `referer` inside a link. */
  via: "url" | "form" | "referer";
  /** Weak per-click or per-source attributes seen with it (sub1, sub2, x_id, sid, cid), never a pivot. */
  attrs?: Record<string, string>;
}

const SMALL_ID = /^[A-Za-z0-9_-]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API_KEY = /^[A-Za-z0-9]{24,128}$/;
const ATTR_NAMES = ["sub1", "sub2", "x_id", "sid", "cid"];
const MAX_IDS = 50;
const SCRIPT_URL = /https?:\/\/[A-Za-z0-9.-]+\/[^\s"'`<>\\]*?[?&](?:team_id|stream_id|offer_uuid|api_key)=[^\s"'`<>\\]*/gi;
const MAX_SCRIPT_URLS = 200;
const NETWORK_FIELD = /team_id|stream_id|offer_uuid|api_key|referer=/i;
const MAX_REFERER_DEPTH = 2;

/** SHA-256 (hex) of a secret value, the only form in which an API key is kept (same as crm_key). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Lower-cased host of an address resolved against `base`, or null for non-http addresses. */
function hostOfUrl(raw: string, base?: string): string | null {
  try {
    const u = base ? new URL(raw, base) : new URL(raw);
    return /^https?:$/.test(u.protocol) && u.hostname ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Decodes a base64 / base64url string to text, or null when it is not valid base64 of printable text. */
function decodeBase64(s: string): string | null {
  const t = s.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (t.length < 8 || !/^[A-Za-z0-9+/]+=*$/.test(t)) return null;
  try {
    const text = Buffer.from(t, "base64").toString("utf8");
    return /^[\x20-\x7e]+$/.test(text) ? text : null;
  } catch {
    return null;
  }
}

/**
 * Affiliate IDs from one set of name/value fields scoped to `host`: the team_id+user_id pair, stream_id,
 * offer_uuid (UUID format only) and api_key (hashed). The weak attributes (sub1, sub2, x_id, sid, cid) ride
 * along on every ID. No host, no ID: a bare user_id names nobody.
 */
function idsOfFields(fields: Map<string, string>, host: string | null, via: AffiliateId["via"]): AffiliateId[] {
  if (!host) return [];
  const get = (n: string) => (fields.get(n) ?? "").trim();
  const attrs: Record<string, string> = {};
  for (const n of ATTR_NAMES) if (get(n) && SMALL_ID.test(get(n))) attrs[n] = get(n);
  const extra = Object.keys(attrs).length ? { attrs } : {};
  const out: AffiliateId[] = [];
  const team = get("team_id");
  const user = get("user_id");
  if (team && user && SMALL_ID.test(team) && SMALL_ID.test(user)) out.push({ kind: "team_user", host, value: `${team}/${user}`, via, ...extra });
  const stream = get("stream_id");
  if (stream && SMALL_ID.test(stream)) out.push({ kind: "stream", host, value: stream, via, ...extra });
  const offer = get("offer_uuid");
  if (UUID.test(offer)) out.push({ kind: "offer_uuid", host, value: offer.toLowerCase(), via, ...extra });
  const key = get("api_key");
  if (API_KEY.test(key)) out.push({ kind: "api_key", host, value: sha256Hex(key), via, ...extra });
  return out;
}

/** Lower-cased query fields of an address (the first value of each name). */
function queryFields(u: URL): Map<string, string> {
  const m = new Map<string, string>();
  for (const [k, v] of u.searchParams) if (!m.has(k.toLowerCase())) m.set(k.toLowerCase(), v);
  return m;
}

/** IDs of one address and of the addresses or query strings hidden in its base64 `referer` parameter. */
function idsOfUrl(raw: string, via: AffiliateId["via"], depth: number): AffiliateId[] {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return [];
  }
  const host = hostOfUrl(u.href);
  const fields = queryFields(u);
  const out = idsOfFields(fields, host, via);
  const ref = fields.get("referer");
  const decoded = ref && depth < MAX_REFERER_DEPTH ? decodeBase64(ref) : null;
  if (decoded) {
    if (/^https?:\/\//i.test(decoded)) out.push(...idsOfUrl(decoded, "referer", depth + 1));
    // a bare query string inside the referer belongs to the network of the link that carries it
    else if (decoded.includes("=")) out.push(...idsOfFields(queryFields(new URL(`http://x.invalid/?${decoded.replace(/^\?/, "")}`)), host, "referer"));
  }
  return out;
}

/** Deduplicates IDs by kind, host and value, keeping the first; at most MAX_IDS. */
function unique(ids: AffiliateId[]): AffiliateId[] {
  const seen = new Set<string>();
  const out: AffiliateId[] = [];
  for (const id of ids) {
    const k = `${id.kind}|${id.host}|${id.value}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(id);
    if (out.length >= MAX_IDS) break;
  }
  return out;
}

/** Affiliate-network IDs in a list of addresses (landing, redirect hops, order links), with base64 referers decoded. */
export function affiliateIdsFromUrls(urls: Array<string | null | undefined>): AffiliateId[] {
  return unique(urls.flatMap((u) => (u && u.trim() ? idsOfUrl(u, "url", 0) : [])));
}

/**
 * Affiliate-network IDs written into a page: the hidden fields of each form, scoped to the host of the
 * form's action (the page host for a relative or empty action; fields outside a form are skipped), and
 * the page's links (`<a href>`, `<form action>` query strings, addresses with network fields written into
 * scripts). Pages without any of the network field names
 * are not scanned at all.
 */
export function affiliateIdsFromHtml(html: string, pageUrl: string): AffiliateId[] {
  // a cheap pre-check keeps big pages without any network field from a second tag scan
  if (!html || !NETWORK_FIELD.test(html)) return [];
  const out: AffiliateId[] = [];
  const links: string[] = [];
  let formHost: string | null = null;
  let fields: Map<string, string> | null = null;
  const flush = () => {
    if (fields) out.push(...idsOfFields(fields, formHost, "form"));
    fields = null;
  };
  for (const tag of scanTags(html)) {
    if (tag.name === "form") {
      flush();
      const action = (tag.attrs.action ?? "").trim();
      formHost = hostOfUrl(action || pageUrl, pageUrl);
      fields = new Map();
      if (action) {
        try {
          links.push(new URL(action, pageUrl).href);
        } catch {
          /* not an address */
        }
      }
    } else if (tag.name === "input" && fields && (tag.attrs.type ?? "").toLowerCase() === "hidden") {
      const name = (tag.attrs.name ?? "").trim().toLowerCase();
      if (name && !fields.has(name)) fields.set(name, tag.attrs.value ?? "");
    } else if (tag.name === "a" && tag.attrs.href) {
      try {
        links.push(new URL(tag.attrs.href, pageUrl).href);
      } catch {
        /* not an address */
      }
    }
  }
  flush();
  // addresses written into scripts (redirects, back-button traps) carry the same network fields
  for (const m of html.matchAll(SCRIPT_URL)) if (links.length < MAX_SCRIPT_URLS) links.push(m[0]);
  return unique([...out, ...affiliateIdsFromUrls(links)]);
}
