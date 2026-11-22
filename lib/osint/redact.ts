/**
 * Redaction of what the analyst's own visit leaves in captured material, and of tokens that grant access.
 *
 * A page saved or a HAR recorded by the analyst holds data about the analyst, not about the
 * operator: the visitor record that landing-page platforms write into the page (`window.aio.visit`:
 * IP, location, ASN, browser fingerprint, JA3/JA4, user agent, window size, postal code), `ip=` in
 * tracker links, the browser's cookies and request headers, the `fingerprint` the page posts back.
 * The same value in every case is the analyst's browser, so it must never become a pivot, and it
 * must not travel into graph.json, the GUI, exports or the evidence pack. Meta access tokens
 * (`EAAB…`, `EABC…`) in links are secrets of the clicked account: masked as prefix and hash, which
 * keeps two equal tokens recognisable without keeping the token. Pure functions; a redacted copy is
 * a derived file (the pack records the hash of the original next to it).
 */
import { createHash } from "node:crypto";
import { isIP } from "node:net";

/** Placeholder written in place of a redacted value. */
export const REDACTED = "[zredagowane]";

/** Keys of the visitor record the pipeline needs and that carry no data about the visitor. */
export const VISIT_KEEP_KEYS = ["campaign_human_id"];

/** Keys that are the analyst's browser or network wherever they appear (outside `visit` too, e.g. the POST of the platform). */
export const VISITOR_KEYS = ["ip_address", "visitor_ip", "client_ip", "ja3_hash", "ja3", "ja4", "fingerprint", "zip_code", "postal_code"];

/** Request headers kept in a redacted HAR; everything else the analyst's browser sent is replaced (cookies, UA, client hints, language). */
export const HAR_KEEP_REQUEST_HEADERS = ["host", "accept", "content-type", "content-length", "origin", "referer", ":method", ":path", ":authority", ":scheme"];

/** Response headers that set or carry credentials. */
export const HAR_REDACT_RESPONSE_HEADERS = ["set-cookie", "authorization", "proxy-authorization"];

/** Meta access token as a whole query value: "EA" and at least six more letters or digits (also the EABC prefix). */
const META_QUERY_VALUE = /^EA[A-Za-z0-9]{6,}$/;
/** Meta access token standing alone in text: long enough not to hit ordinary words that start with "EA". */
const META_FREE = /(?<![A-Za-z0-9])EA[A-Za-z0-9]{20,}(?![A-Za-z0-9])/g;
const QUERY_PAIR = /([?&;])([^=&#\s"'<>]+)=([^&#\s"'<>]*)/g;
const MIN_GLOBAL_VALUE = 6;

/** "EAAB…" → "EA…[sha256:<12 hex of the whole token>]". */
export function maskMetaToken(token: string): string {
  return `EA…[sha256:${createHash("sha256").update(token).digest("hex").slice(0, 12)}]`;
}

/** True for a query parameter that is the analyst's own or a secret: a Meta token value, or `ip=` holding an IP address. Such a value is never a link between two ads. */
export function isSecretParam(name: string, value: string): boolean {
  return META_QUERY_VALUE.test(value) || (name.toLowerCase() === "ip" && isIP(value) !== 0);
}

/** Masks Meta tokens and the analyst's IP (`ip=`) in the query values of every address inside `text`. */
function maskQueries(text: string): string {
  return text.replace(QUERY_PAIR, (whole, sep: string, name: string, value: string) => {
    if (META_QUERY_VALUE.test(value)) return `${sep}${name}=${maskMetaToken(value)}`;
    if (name.toLowerCase() === "ip" && isIP(value)) return `${sep}${name}=${REDACTED}`;
    return whole;
  });
}

/** One address with Meta tokens and the analyst's IP masked in its query; the rest of the address is untouched. */
export function maskUrl(url: string): string {
  return maskQueries(url);
}

/** Free text (page code, OCR, descriptions): token parameters in addresses and long tokens standing alone are masked. */
export function maskText(text: string): string {
  return maskQueries(text).replace(META_FREE, (t) => maskMetaToken(t));
}

/** Index of the "}" that closes the object opened at `open`, skipping braces inside JSON strings; -1 when it does not close. */
function closingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

const JSON_PAIR = /("([^"\\]+)"\s*:\s*)("(?:[^"\\]|\\.)*"|\{[^{}]*\}|\[[^\]]*\]|[^,}\s]+)/g;
const scalar = (raw: string): string | null => (raw.startsWith('"') ? raw.slice(1, -1) : /^[^{[]/.test(raw) && raw !== "null" ? raw : null);

/** Collects a value to be removed from the rest of the text too (a short value would hit ordinary text, so it is skipped). */
function remember(found: Set<string>, raw: string): void {
  const v = scalar(raw);
  if (v && v.length >= MIN_GLOBAL_VALUE && v !== REDACTED) found.add(v);
}

/** Redacts the values of the given keys in JSON text (`"key": value`); returns the new text. */
function redactJsonPairs(text: string, shouldRedact: (key: string) => boolean, found: Set<string>): string {
  return text.replace(JSON_PAIR, (whole, head: string, key: string, raw: string) => {
    if (!shouldRedact(key) || raw === `"${REDACTED}"`) return whole;
    remember(found, raw);
    return `${head}"${REDACTED}"`;
  });
}

/**
 * Page code (saved HTML, response body of a HAR) without the analyst's visit data: the `visit`
 * record of the platform (all but its campaign number), the browser-identifying keys wherever they
 * stand, JavaScript assignments `visit.<key> = …`, every other occurrence of a removed value, and
 * Meta tokens and `ip=` in links. `changed` tells whether anything was replaced.
 */
export function redactPageHtml(html: string): { text: string; changed: boolean } {
  const found = new Set<string>();
  let out = html;
  // 1. the visitor record: every key except the campaign number
  const visitStart = /"visit"\s*:\s*\{/g;
  for (let m = visitStart.exec(out); m; m = visitStart.exec(out)) {
    const open = m.index + m[0].length - 1;
    const close = closingBrace(out, open);
    if (close < 0) continue;
    const inner = redactJsonPairs(out.slice(open + 1, close), (k) => !VISIT_KEEP_KEYS.includes(k), found);
    out = `${out.slice(0, open + 1)}${inner}${out.slice(close)}`;
    visitStart.lastIndex = open + 1 + inner.length;
  }
  // 2. keys that name the analyst's browser anywhere (e.g. the fingerprint posted back to the platform)
  out = redactJsonPairs(out, (k) => VISITOR_KEYS.includes(k.toLowerCase()), found);
  // 3. the same record written as JavaScript assignments
  out = out.replace(/(\bvisit\.([A-Za-z0-9_]+)\s*=\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^;\s,)]+)/g, (whole, head: string, key: string, raw: string) => {
    if (VISIT_KEEP_KEYS.includes(key)) return whole;
    remember(found, raw.replace(/^'|'$/g, '"'));
    return `${head}"${REDACTED}"`;
  });
  // 4. the removed values elsewhere in the text
  for (const v of found) out = out.split(v).join(REDACTED);
  out = maskText(out);
  return { text: out, changed: out !== html };
}

type Json = Record<string, unknown>;
const asObj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const asList = (v: unknown): Json[] => (Array.isArray(v) ? v.map(asObj).filter((x): x is Json => !!x) : []);

/** Header list with the analyst's headers replaced (request: all but the kept ones; response: credentials only). */
function redactHeaders(headers: Json[], keep: (name: string) => boolean): void {
  for (const h of headers) if (typeof h.name === "string" && !keep(h.name.toLowerCase())) h.value = REDACTED;
}

/**
 * A HAR without the analyst's data: cookies and credentials, the request headers of the analyst's
 * browser (user agent, client hints, language), query values and posted fields that identify the
 * browser, the visitor record inside response bodies, and Meta tokens in addresses. Request and
 * response structure, URLs, status codes, server headers and bodies stay: they are the evidence.
 * Throws when `text` is not a HAR (a file that cannot be redacted must not be copied as it is).
 */
export function redactHar(text: string): { text: string; changed: boolean } {
  const har = JSON.parse(text) as { log?: { entries?: unknown; pages?: unknown } };
  const found = new Set<string>();
  for (const e of asList(har.log?.entries)) {
    const req = asObj(e.request);
    const res = asObj(e.response);
    if (req) {
      if (typeof req.url === "string") req.url = maskUrl(req.url);
      redactHeaders(asList(req.headers), (n) => HAR_KEEP_REQUEST_HEADERS.includes(n));
      req.cookies = [];
      for (const q of asList(req.queryString)) {
        if (typeof q.value !== "string") continue;
        q.value = String(q.name).toLowerCase() === "ip" && isIP(q.value) ? REDACTED : maskText(`?${String(q.name)}=${q.value}`).slice(String(q.name).length + 2);
      }
      const post = asObj(req.postData);
      if (post) {
        if (typeof post.text === "string") post.text = redactPageHtml(post.text).text;
        for (const p of asList(post.params)) if (VISITOR_KEYS.includes(String(p.name).toLowerCase())) {
          if (typeof p.value === "string") remember(found, `"${p.value}"`);
          p.value = REDACTED;
        }
      }
    }
    if (res) {
      if (typeof res.redirectURL === "string") res.redirectURL = maskUrl(res.redirectURL);
      redactHeaders(asList(res.headers), (n) => !HAR_REDACT_RESPONSE_HEADERS.includes(n));
      res.cookies = [];
      const content = asObj(res.content);
      if (content && typeof content.text === "string" && content.encoding !== "base64" && /html|json|javascript|text/i.test(String(content.mimeType ?? ""))) content.text = redactPageHtml(content.text).text;
    }
  }
  for (const p of asList(har.log?.pages)) if (typeof p.title === "string") p.title = maskUrl(p.title);
  let out = JSON.stringify(har);
  for (const v of found) out = out.split(JSON.stringify(v).slice(1, -1)).join(REDACTED);
  return { text: out, changed: out !== JSON.stringify(JSON.parse(text)) };
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s|)>"'`\]]+/gi;

/** A bare host name or address with `.` → `[.]` and `http` → `hxxp`, so that it cannot be clicked by mistake in a document read by people. */
export function defangText(text: string): string {
  return text.replace(URL_IN_TEXT, (url) => {
    const m = /^(https?):\/\/([^/?#]*)(.*)$/is.exec(url)!;
    return `${m[1].replace(/^http/i, "hxxp")}://${m[2].replace(/\./g, "[.]")}${m[3]}`;
  });
}

/** A domain name for a document read by people: `host.example` → `host[.]example`. */
export function defangHost(host: string): string {
  return host.replace(/\./g, "[.]");
}
