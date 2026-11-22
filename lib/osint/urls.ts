/**
 * URL normalisation and domain helpers.
 *
 * - refangs common defanged notations (hxxp://, [.], (.))
 * - converts IDN hosts to punycode (ASCII) for keys and keeps a Unicode form for display
 * - computes the registrable domain (eTLD+1) with the Public Suffix List via tldts,
 *   including PSL private suffixes (user.github.io, x.pages.dev are separate sites)
 * - strips per-click tracking parameters (fbclid, gclid, utm_*, ...) and sorts the rest
 *
 * Pure functions, no network access.
 */
import { parse as parseDomain } from "tldts";
import { domainToASCII, domainToUnicode } from "node:url";
import { canonicalIp, isIpAddress } from "./ip";

export interface NormalizedUrl {
  /** Original input (trimmed). */
  input: string;
  /** Canonical URL string used as a graph key. */
  url: string;
  scheme: "http" | "https";
  /** ASCII (punycode) lower-case host without trailing dot. IPv6 without brackets. */
  host: string;
  /** Unicode form of the host for display. */
  hostUnicode: string;
  port: number | null;
  path: string;
  query: string;
  registrableDomain: string | null;
  publicSuffix: string | null;
  subdomain: string | null;
  isIp: boolean;
  /** URL fragment without "#" (e.g. "tickets": the section a page scrolls to), when present. Not part of `url`. */
  fragment?: string;
  isIdn: boolean;
  removedParams: string[];
}

export interface NormalizeOptions {
  /** Scheme used when the input has none. Default "https". */
  defaultScheme?: "http" | "https";
  /** Remove per-click tracking parameters. Default true. */
  stripTracking?: boolean;
}

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "ttclid",
  "twclid",
  "li_fat_id",
  "yclid",
  "ysclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "mkt_tok",
  "srsltid",
  "_ga",
  "_gl",
  "oly_enc_id",
  "oly_anon_id",
  "rb_clickid",
  "s_cid",
  "epik",
]);

function isTrackingParam(name: string): boolean {
  const n = name.toLowerCase();
  return n.startsWith("utm_") || TRACKING_PARAMS.has(n);
}

/** Undo common "defanging" used in threat-intel feeds. */
export function refang(input: string): string {
  return input
    .trim()
    .replace(/^h(xx|\*\*|XX)p(s?):\/\//, "http$2://")
    .replace(/^fxp:\/\//i, "ftp://")
    .replace(/\[\.\]|\(\.\)|\{\.\}|\[dot\]|\(dot\)/gi, ".")
    .replace(/\[:\]|\[:\/\/\]/g, (m) => (m === "[:]" ? ":" : "://"));
}

/** Converts a host to its ASCII (punycode) form; null if invalid. */
export function toAsciiHost(host: string): string | null {
  const h = host.trim().replace(/\.$/, "").toLowerCase();
  if (!h) return null;
  if (isIpAddress(h)) return canonicalIp(h);
  const ascii = domainToASCII(h);
  return ascii ? ascii.toLowerCase() : null;
}

/** Converts a (punycode) host to Unicode for display. */
export function toUnicodeHost(host: string): string {
  if (isIpAddress(host)) return host;
  return domainToUnicode(host) || host;
}

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * Registrable domain (eTLD+1) of a host or URL, using the PSL including
 * private suffixes. Returns null for IPs and hosts without one (e.g. "localhost").
 */
export function registrableDomain(hostOrUrl: string): string | null {
  const host = hostOf(hostOrUrl) ?? toAsciiHost(hostOrUrl);
  if (!host || isIpAddress(host)) return null;
  const parsed = parseDomain(host, { allowPrivateDomains: true });
  return parsed.domain ?? null;
}

/** Host (ASCII, lower-case) of a URL string; null when it cannot be parsed. */
export function hostOf(input: string): string | null {
  const s = refang(input);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return null;
  try {
    const u = new URL(s);
    if (!u.hostname) return null;
    return toAsciiHost(stripBrackets(u.hostname));
  } catch {
    return null;
  }
}

export function isHttpUrl(input: string): boolean {
  try {
    const u = new URL(input);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Redirect wrappers of platforms (B-215): host suffix, optional path prefix and the query parameters (in
 * order) that hold the target. ad.doubleclick.net puts "adurl=" in the path after ";".
 */
const URL_WRAPPERS: Array<{ host: string; path?: string; params: string[] }> = [
  { host: "l.facebook.com", path: "/l.php", params: ["u"] },
  { host: "lm.facebook.com", path: "/l.php", params: ["u"] },
  { host: "l.messenger.com", path: "/l.php", params: ["u"] },
  { host: "l.instagram.com", params: ["u"] },
  { host: "google.com", path: "/url", params: ["url", "q"] },
  { host: "googleadservices.com", path: "/pagead/aclk", params: ["adurl"] },
  { host: "doubleclick.net", params: ["adurl"] },
];

/**
 * Target address of a platform redirect wrapper (l.facebook.com/l.php?u=, l.instagram.com/?u=,
 * google.com/url?q= or url=, googleadservices.com/pagead/aclk?adurl=, ad.doubleclick.net/…adurl=), or null
 * for any other link and for a target that is not http(s). The platforms' own domains weigh 0, so without
 * this a wrapped link from a screenshot or HAR loses the landing domain.
 */
export function unwrapPlatformUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const rule = URL_WRAPPERS.find((w) => (host === w.host || host.endsWith(`.${w.host}`)) && (!w.path || u.pathname === w.path || u.pathname.startsWith(`${w.path}/`)));
  if (!rule) return null;
  const inPath = /;adurl=([^;?#]+)/i.exec(u.pathname)?.[1];
  const raw = rule.params.map((p) => u.searchParams.get(p)).find((v) => !!v) ?? (inPath ? safeDecode(inPath) : null);
  if (!raw) return null;
  try {
    const t = new URL(raw);
    return t.protocol === "http:" || t.protocol === "https:" ? t.toString() : null;
  } catch {
    return null;
  }
}

/** decodeURIComponent that keeps the input when it is not valid percent-encoding. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Resolves a (possibly relative) href against a base URL; http(s) only. */
export function resolveUrl(href: string, base: string): string | null {
  const h = href.trim();
  if (!h || /^(javascript|data|mailto|tel|sms|blob|about):/i.test(h)) return null;
  try {
    const u = new URL(h, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Normalises a URL for use as a stable key. Returns null for inputs that are
 * not http(s) URLs (after refanging and adding a default scheme).
 */
export function normalizeUrl(input: string, opts: NormalizeOptions = {}): NormalizedUrl | null {
  const { defaultScheme = "https", stripTracking = true } = opts;
  const raw = (input ?? "").trim().replace(/^["'<(\s]+|[>"')\s]+$/g, "");
  if (!raw) return null;
  let s = refang(raw);
  if (s.startsWith("//")) s = `${defaultScheme}:${s}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    // Looks like a bare host/path ("example.com/path"): require a dot in the host part.
    const hostPart = s.split(/[/?#]/)[0];
    if (!hostPart.includes(".") && !hostPart.includes(":")) return null;
    s = `${defaultScheme}://${s}`;
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname) return null;

  const host = toAsciiHost(stripBrackets(u.hostname));
  if (!host) return null;
  const isIp = isIpAddress(host);
  let fragment = "";
  try {
    fragment = decodeURIComponent(u.hash.replace(/^#/, ""));
  } catch {
    fragment = u.hash.replace(/^#/, "");
  }
  u.hash = "";
  u.username = "";
  u.password = "";

  const removedParams: string[] = [];
  const kept: Array<[string, string]> = [];
  for (const [k, v] of u.searchParams) {
    if (stripTracking && isTrackingParam(k)) removedParams.push(k);
    else kept.push([k, v]);
  }
  kept.sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const query = kept.length ? `?${new URLSearchParams(kept).toString()}` : "";

  const scheme = u.protocol === "https:" ? "https" : "http";
  const port = u.port ? Number(u.port) : null;
  const path = u.pathname || "/";
  const hostForUrl = isIp && host.includes(":") ? `[${host}]` : host;
  const url = `${scheme}://${hostForUrl}${port ? `:${port}` : ""}${path}${query}`;

  let registrable: string | null = null;
  let publicSuffix: string | null = null;
  let subdomain: string | null = null;
  if (!isIp) {
    const parsed = parseDomain(host, { allowPrivateDomains: true });
    registrable = parsed.domain ?? null;
    publicSuffix = parsed.publicSuffix ?? null;
    subdomain = parsed.subdomain || null;
  }

  return {
    input: raw,
    url,
    scheme,
    host,
    hostUnicode: toUnicodeHost(host),
    port,
    path,
    query,
    registrableDomain: registrable,
    publicSuffix,
    subdomain,
    isIp,
    isIdn: !isIp && host.split(".").some((label) => label.startsWith("xn--")),
    removedParams,
    ...(fragment ? { fragment } : {}),
  };
}

/** Extracts http(s) URLs (also defanged and bare "www." ones) from free text. */
export function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();
  const re = /\b(?:h(?:tt|xx)ps?:\/\/|www\.)[^\s<>"'`]+/gi;
  for (const m of text.matchAll(re)) {
    const candidate = m[0].replace(/[),.;:!?\]]+$/, "");
    const n = normalizeUrl(candidate);
    if (n) out.add(n.url);
  }
  return [...out];
}
