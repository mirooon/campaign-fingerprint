/**
 * Page-kit fingerprinting, static and passive.
 *
 * From one HTML document we pull:
 * - lead-form backends: `<form action>` plus fetch/XHR/axios/jQuery calls and API-like
 *   string literals in inline scripts, normalised to host + path template;
 * - a 64-bit simhash of the DOM tag structure;
 * - hidden form field names;
 * - first-party JS/CSS asset paths;
 * - normalised HTML and inline-JS comments, plus a Cyrillic flag.
 *
 * JavaScript is never executed. The scanner never throws on malformed HTML, and
 * every search moves forward, so 2 MB of pathological input stays linear.
 */
import { extractLanderConfig, type LanderConfig } from "./landerConfig";
import { createHash } from "node:crypto";
import { hammingDistance } from "../media/imageHash";
import { toAsciiHost } from "./urls";

export type EndpointVia = "form" | "fetch" | "xhr" | "axios" | "jquery" | "literal";

export interface EndpointRef {
  /** Cross-origin: `${host}${pathTemplate}`; same-origin (relative or same host as page): `*${pathTemplate}`. */
  key: string;
  /** ASCII lower-case host of the endpoint. */
  host: string;
  /** Path only (no query/fragment), normalised by normalizeEndpointPath. */
  pathTemplate: string;
  sameOrigin: boolean;
  /** Upper-case HTTP method when known. */
  method: string | null;
  via: EndpointVia;
  /** Original URL literal (max 300 chars). */
  raw: string;
}

export interface AssetRef {
  /** sameOrigin ? path : `${host}${path}` */
  key: string;
  /** Absolute URL without query/fragment. */
  url: string;
  host: string;
  /** Lower-cased path. */
  path: string;
  /** Lower-cased last path segment. */
  basename: string;
  kind: "js" | "css";
  sameOrigin: boolean;
}

export interface PageKit {
  /** Deduplicated by key (first via/method kept), sorted by key, max 50. */
  endpoints: EndpointRef[];
  /** 16 lower-case hex chars (64-bit); null when tagCount < minTags. */
  domSimhash: string | null;
  tagCount: number;
  /** Lower-cased names of hidden inputs, sorted unique, max 100 (no generic filtering). */
  hiddenFields: string[];
  /** Script and stylesheet assets, deduplicated by key, sorted, max 100. */
  assets: AssetRef[];
  /** Normalised HTML comments + inline-script comments, document order, deduplicated, max 50. */
  comments: string[];
  /** True when any (unnormalised) comment contains Cyrillic letters. */
  cyrillicComments: boolean;
  /**
   * UUIDs that are a path segment of at least two same-origin resources (scripts, styles, images,
   * icons): the account or project ID of a page builder that serves many domains. Sorted by id, max 10.
   */
  pathIds: PathId[];
  /** Configuration record of the landing-page platform embedded in the page (`window.aio`), when present. */
  lander?: LanderConfig | null;
}

export interface PathId {
  /** Lower-case UUID. */
  id: string;
  /** Lower-case path before the UUID, e.g. "/_cdn/landing/": tells an account ID from a platform's app or theme ID. */
  prefix: string;
}

const MAX_ENDPOINTS = 50;
const MAX_ASSETS = 100;
const MAX_HIDDEN = 100;
const MAX_COMMENTS = 50;
const MAX_COMMENT_LEN = 300;
const MAX_PATH_IDS = 10;
const MIN_PATH_ID_RESOURCES = 2;
const MAX_RAW = 300;
const MAX_URL_LEN = 2048;
const MAX_LITERALS_PER_SCRIPT = 50_000;
const MAX_RAW_COMMENTS_PER_SCRIPT = 1_000;
const DEFAULT_MIN_TAGS = 25;
const DEFAULT_SHINGLE = 4;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const CYRILLIC_RE = /[Ѐ-ӿ]/;

/** True when the string contains Cyrillic letters (U+0400–U+04FF). */
export function hasCyrillic(s: string): boolean {
  return CYRILLIC_RE.test(s ?? "");
}

function isSpaceCode(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
}

function isAsciiLetterCode(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isTagNameCode(c: number): boolean {
  return isAsciiLetterCode(c) || (c >= 48 && c <= 57) || c === 45 || c === 58 || c === 95;
}

function isIdentCode(c: number): boolean {
  return isAsciiLetterCode(c) || (c >= 48 && c <= 57) || c === 95 || c === 36 || c === 46; // _ $ .
}

function decodeAttr(value: string): string {
  if (!value.includes("&")) return value;
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function hostOfUrl(u: URL): string | null {
  return toAsciiHost(u.hostname.replace(/^\[|\]$/g, ""));
}

function parseAbsolute(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Linear HTML scanner: start tags, HTML comments, raw-text bodies
// ---------------------------------------------------------------------------

interface StartTag {
  name: string;
  attrs: Record<string, string>;
}

type ScanEvent =
  | { type: "tag"; tag: StartTag }
  | { type: "comment"; text: string }
  | { type: "script"; body: string; external: boolean; scriptType: string };

/** Elements whose content is raw text (never tokenised as tags). */
const RAW_TEXT_TAGS = new Set(["script", "style", "noscript", "template", "textarea", "title", "xmp"]);
const closeRegexCache = new Map<string, RegExp>();

function closeTagRe(name: string): RegExp {
  let re = closeRegexCache.get(name);
  if (!re) {
    re = new RegExp(`</${name}\\s*>`, "gi");
    closeRegexCache.set(name, re);
  }
  return re;
}

function scanHtml(html: string): ScanEvent[] {
  const events: ScanEvent[] = [];
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0 || lt + 1 >= n) break;
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      events.push({ type: "comment", text: html.slice(lt + 4, end < 0 ? Math.min(n, lt + 4 + 4096) : end) });
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (!isAsciiLetterCode(html.charCodeAt(lt + 1))) {
      i = lt + 1; // end tags, "<!DOCTYPE", "<?xml", stray "<"
      continue;
    }
    let k = lt + 1;
    while (k < n && isTagNameCode(html.charCodeAt(k))) k++;
    const name = html.slice(lt + 1, k).toLowerCase();
    const attrs: Record<string, string> = {};
    let p = k;
    let closed = false;
    while (p < n) {
      while (p < n && (isSpaceCode(html.charCodeAt(p)) || html[p] === "/")) p++;
      if (p >= n) break;
      if (html[p] === ">") {
        p++;
        closed = true;
        break;
      }
      let q = p;
      while (q < n) {
        const c = html.charCodeAt(q);
        if (isSpaceCode(c) || c === 61 /* = */ || c === 62 /* > */ || c === 47 /* / */) break;
        q++;
      }
      if (q === p) {
        p++; // stray "=": guarantee progress
        continue;
      }
      const attrName = html.slice(p, q).toLowerCase();
      p = q;
      while (p < n && isSpaceCode(html.charCodeAt(p))) p++;
      let value = "";
      if (p < n && html[p] === "=") {
        p++;
        while (p < n && isSpaceCode(html.charCodeAt(p))) p++;
        const quote = html[p];
        if (quote === '"' || quote === "'") {
          const close = html.indexOf(quote, p + 1);
          if (close < 0) {
            value = html.slice(p + 1, Math.min(n, p + 1 + 4096));
            p = n;
          } else {
            value = html.slice(p + 1, close);
            p = close + 1;
          }
        } else {
          let r = p;
          while (r < n && !isSpaceCode(html.charCodeAt(r)) && html[r] !== ">") r++;
          value = html.slice(p, r);
          p = r;
        }
      }
      if (!(attrName in attrs)) attrs[attrName] = decodeAttr(value);
    }
    events.push({ type: "tag", tag: { name, attrs } });
    i = p;
    if (closed && RAW_TEXT_TAGS.has(name)) {
      const re = closeTagRe(name);
      re.lastIndex = p;
      const m = re.exec(html);
      if (name === "script") {
        events.push({
          type: "script",
          body: html.slice(p, m ? m.index : n),
          external: "src" in attrs,
          scriptType: (attrs.type ?? "").trim().toLowerCase(),
        });
      }
      i = m ? m.index + m[0].length : n;
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Minimal JS lexer: string literals (with positions) and comments
// ---------------------------------------------------------------------------

interface JsLiteral {
  value: string;
  /** Index of the opening quote. */
  start: number;
  /** Index just after the closing quote (or where the literal was cut). */
  end: number;
}

interface JsLex {
  literals: JsLiteral[];
  comments: string[];
}

function unescapeChar(ch: string | undefined): string {
  if (ch === undefined) return "";
  if (ch === "n") return "\n";
  if (ch === "t") return "\t";
  if (ch === "r") return "\r";
  return ch; // \/ \\ \' \" \` and anything else
}

function lexJs(code: string): JsLex {
  const literals: JsLiteral[] = [];
  const comments: string[] = [];
  const n = code.length;
  let i = 0;
  while (i < n) {
    const c = code.charCodeAt(i);
    if (c === 47 /* / */ && i + 1 < n) {
      const c2 = code.charCodeAt(i + 1);
      if (c2 === 47) {
        let e = code.indexOf("\n", i + 2);
        if (e < 0) e = n;
        if (comments.length < MAX_RAW_COMMENTS_PER_SCRIPT) comments.push(code.slice(i, Math.min(e, i + 2000)));
        i = e;
        continue;
      }
      if (c2 === 42) {
        const e = code.indexOf("*/", i + 2);
        const end = e < 0 ? n : e + 2;
        if (comments.length < MAX_RAW_COMMENTS_PER_SCRIPT) comments.push(code.slice(i, Math.min(end, i + 2000)));
        i = end;
        continue;
      }
      i++;
      continue;
    }
    if (c === 39 /* ' */ || c === 34 /* " */) {
      const start = i;
      const limit = Math.min(n, i + 1 + 4096);
      let j = i + 1;
      let seg = j;
      let value = "";
      let complete = false;
      while (j < limit) {
        const d = code.charCodeAt(j);
        if (d === 92 /* \ */) {
          value += code.slice(seg, j) + unescapeChar(code[j + 1]);
          j += 2;
          seg = j;
          continue;
        }
        if (d === c) {
          value += code.slice(seg, j);
          complete = true;
          j++;
          break;
        }
        if (d === 10) break; // plain strings cannot span lines: unterminated
        j++;
      }
      if (complete && literals.length < MAX_LITERALS_PER_SCRIPT) literals.push({ value, start, end: j });
      i = Math.max(j, i + 1);
      continue;
    }
    if (c === 96 /* ` */) {
      const start = i;
      const limit = Math.min(n, i + 1 + 8192);
      let j = i + 1;
      let seg = j;
      let value = "";
      let prefix: string | null = null;
      let complete = false;
      while (j < limit) {
        const d = code.charCodeAt(j);
        if (d === 92) {
          value += code.slice(seg, j) + unescapeChar(code[j + 1]);
          j += 2;
          seg = j;
          continue;
        }
        if (d === 96) {
          value += code.slice(seg, j);
          complete = true;
          j++;
          break;
        }
        if (d === 36 /* $ */ && code.charCodeAt(j + 1) === 123 /* { */) {
          if (prefix === null) prefix = value + code.slice(seg, j);
          let depth = 1;
          j += 2;
          while (j < limit && depth > 0) {
            const e = code.charCodeAt(j);
            if (e === 123) depth++;
            else if (e === 125) depth--;
            j++;
          }
          seg = j;
          value = "";
          continue;
        }
        j++;
      }
      const lit = prefix !== null ? prefix : complete ? value : null;
      if (lit !== null && literals.length < MAX_LITERALS_PER_SCRIPT) literals.push({ value: lit, start, end: j });
      i = Math.max(j, i + 1);
      continue;
    }
    i++;
  }
  return { literals, comments };
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATIC_EXT = /\.(?:js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|map)$/i;
const LITERAL_MARKERS = /\/api\/|submit|lead|register|registration|signup|sign-up|postback|callback|trigger/i;
const AXIOS_METHODS = new Set(["get", "post", "put", "patch", "delete", "request"]);
const JQUERY_METHODS = new Set(["ajax", "post", "get", "getjson"]);
const JS_SCRIPT_TYPES = new Set([
  "",
  "text/javascript",
  "application/javascript",
  "module",
  "text/ecmascript",
  "application/ecmascript",
  "application/x-javascript",
]);

function normalizeSegment(s: string): string {
  if (UUID_SEGMENT.test(s)) return "<uuid>";
  if (/^\d+$/.test(s)) return "<n>";
  if (/^[0-9a-f]{16,}$/.test(s)) return "<hex>";
  if (s.length >= 16 && /^[a-z0-9_-]+$/.test(s) && /[a-z]/.test(s) && /\d/.test(s)) return "<id>";
  return s;
}

/**
 * Lower-cases a URL path, collapses duplicate slashes and replaces volatile
 * segments: UUID → `<uuid>`, digits → `<n>`, ≥16 hex chars → `<hex>`,
 * ≥16 chars mixing letters and digits → `<id>`. Keeps a trailing slash.
 */
export function normalizeEndpointPath(path: string): string {
  let p = (path ?? "").toLowerCase().replace(/\/{2,}/g, "/");
  if (!p) return "/";
  if (!p.startsWith("/")) p = `/${p}`;
  if (p === "/") return "/";
  const trailing = p.endsWith("/");
  const segs = p.split("/").slice(1);
  if (trailing) segs.pop();
  const out = segs.map(normalizeSegment);
  return `/${out.join("/")}${trailing ? "/" : ""}`;
}

function toEndpoint(
  raw: string,
  via: EndpointVia,
  method: string | null,
  base: string | null,
  pageHost: string | null,
): EndpointRef | null {
  const s = raw.trim();
  if (!s || s.length > MAX_URL_LEN || /\s/.test(s)) return null;
  if (s.startsWith("#") || /^(?:data|blob|javascript|mailto|tel|about):/i.test(s)) return null;
  if (/[{}<>]/.test(s)) return null; // unresolved template placeholders
  let u: URL;
  try {
    const abs = s.startsWith("//") ? `https:${s}` : s;
    u = base ? new URL(abs, base) : new URL(abs);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (STATIC_EXT.test(u.pathname)) return null;
  const host = hostOfUrl(u);
  if (!host) return null;
  const pathTemplate = normalizeEndpointPath(u.pathname);
  const sameOrigin = pageHost !== null && host === pageHost;
  return {
    key: sameOrigin ? `*${pathTemplate}` : `${host}${pathTemplate}`,
    host,
    pathTemplate,
    sameOrigin,
    method,
    via,
    raw: s.slice(0, MAX_RAW),
  };
}

function prevNonSpace(code: string, idx: number, maxBack = 200): number {
  const stop = Math.max(0, idx - maxBack);
  for (let k = idx - 1; k >= stop; k--) {
    if (!isSpaceCode(code.charCodeAt(k))) return k;
  }
  return -1;
}

/** Identifier chain (letters, digits, _, $, .) ending just before `endExclusive`. */
function identBefore(code: string, endExclusive: number): string {
  const stop = Math.max(0, endExclusive - 80);
  let k = endExclusive - 1;
  while (k >= stop && isIdentCode(code.charCodeAt(k))) k--;
  return code.slice(k + 1, endExclusive);
}

/** Identifier chain before a call's "(" (spaces allowed between them). */
function calleeBefore(code: string, parenIdx: number): string[] {
  const q = prevNonSpace(code, parenIdx, 40);
  if (q < 0) return [];
  const ident = identBefore(code, q + 1);
  return ident ? ident.split(".") : [];
}

interface CallInfo {
  via: EndpointVia;
  method: string | null;
}

function classifyLiteral(code: string, literals: JsLiteral[], idx: number): CallInfo | null {
  const lit = literals[idx];
  const p = prevNonSpace(code, lit.start);
  if (p < 0) return null;
  const ch = code[p];
  if (ch === "(") {
    const segs = calleeBefore(code, p);
    if (!segs.length) return null;
    const last = segs[segs.length - 1];
    const prev = segs.length > 1 ? segs[segs.length - 2] : "";
    if (last === "fetch") {
      // fetch(url, { method: "POST" }) — bounded look-ahead.
      const m = /method\s*:\s*['"`]([A-Za-z]{3,7})['"`]/.exec(code.slice(lit.end, lit.end + 300));
      return { via: "fetch", method: m ? m[1].toUpperCase() : null };
    }
    if (last === "axios") return { via: "axios", method: null };
    if (prev === "axios" && AXIOS_METHODS.has(last)) {
      return { via: "axios", method: last === "request" ? null : last.toUpperCase() };
    }
    if ((prev === "$" || prev === "jQuery") && JQUERY_METHODS.has(last.toLowerCase())) {
      const lm = last.toLowerCase();
      return { via: "jquery", method: lm === "post" ? "POST" : lm === "get" || lm === "getjson" ? "GET" : null };
    }
    return null;
  }
  if (ch === ",") {
    // xhr.open("POST", "URL")
    const prevLit = idx > 0 ? literals[idx - 1] : undefined;
    if (!prevLit || prevNonSpace(code, p) !== prevLit.end - 1) return null;
    if (!/^[A-Za-z]{3,7}$/.test(prevLit.value)) return null;
    const q = prevNonSpace(code, prevLit.start);
    if (q < 0 || code[q] !== "(") return null;
    const segs = calleeBefore(code, q);
    if (segs.length && segs[segs.length - 1] === "open") return { via: "xhr", method: prevLit.value.toUpperCase() };
    return null;
  }
  if (ch === ":") {
    const keyEnd = prevNonSpace(code, p, 40);
    if (keyEnd < 0) return null;
    let key: string;
    const kq = code[keyEnd];
    if (kq === '"' || kq === "'") {
      const open = code.lastIndexOf(kq, keyEnd - 1);
      if (open < 0 || keyEnd - open > 40) return null;
      key = code.slice(open + 1, keyEnd);
    } else {
      key = identBefore(code, keyEnd + 1);
    }
    if (key === "baseURL") return { via: "axios", method: null };
    if (key !== "url") return null;
    // Find the enclosing "{" (bounded) and the call it belongs to: axios({...}) / $.ajax({...})
    let open = -1;
    let depth = 0;
    for (let k = p - 1; k >= Math.max(0, p - 400); k--) {
      const e = code[k];
      if (e === "}") depth++;
      else if (e === "{") {
        if (depth === 0) {
          open = k;
          break;
        }
        depth--;
      }
    }
    if (open < 0) return null;
    const q = prevNonSpace(code, open, 40);
    if (q < 0 || code[q] !== "(") return null;
    const segs = calleeBefore(code, q);
    const last = segs[segs.length - 1] ?? "";
    const prev = segs.length > 1 ? segs[segs.length - 2] : "";
    if (last === "axios") return { via: "axios", method: null };
    if ((prev === "$" || prev === "jQuery") && last === "ajax") return { via: "jquery", method: null };
    return null;
  }
  return null;
}

function isUrlish(v: string): boolean {
  if (!v || v.length > MAX_URL_LEN || /\s/.test(v)) return false;
  return v.includes("/") || v.includes(".");
}

function endpointsFromScript(code: string, literals: JsLiteral[], pageUrl: string | null, pageHost: string | null): EndpointRef[] {
  const out: EndpointRef[] = [];
  for (let idx = 0; idx < literals.length; idx++) {
    const value = literals[idx].value;
    if (!isUrlish(value)) continue;
    const call = classifyLiteral(code, literals, idx);
    if (call) {
      const ep = toEndpoint(value, call.via, call.method, pageUrl, pageHost);
      if (ep) out.push(ep);
      continue;
    }
    const absolute = /^(?:https?:)?\/\//i.test(value) || value.startsWith("/");
    if (absolute && LITERAL_MARKERS.test(value)) {
      const ep = toEndpoint(value, "literal", null, pageUrl, pageHost);
      if (ep) out.push(ep);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// DOM simhash
// ---------------------------------------------------------------------------

function simhashFromTokens(tokens: string[], minTags: number, shingle: number): { simhash: string | null; tagCount: number } {
  const tagCount = tokens.length;
  if (tagCount === 0 || tagCount < minTags) return { simhash: null, tagCount };
  const k = Math.max(1, Math.min(shingle, tagCount));
  const counts = new Map<string, number>();
  for (let i = 0; i + k <= tagCount; i++) {
    let s = tokens[i];
    for (let j = 1; j < k; j++) s += ` ${tokens[i + j]}`;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const v = new Float64Array(64);
  for (const [s, c] of counts) {
    const d = createHash("md5").update(s).digest();
    const hi = d.readUInt32BE(0);
    const lo = d.readUInt32BE(4);
    for (let b = 0; b < 32; b++) {
      v[b] += (hi >>> (31 - b)) & 1 ? c : -c;
      v[32 + b] += (lo >>> (31 - b)) & 1 ? c : -c;
    }
  }
  let hex = "";
  for (let nib = 0; nib < 16; nib++) {
    let val = 0;
    for (let b = 0; b < 4; b++) val = (val << 1) | (v[nib * 4 + b] > 0 ? 1 : 0);
    hex += val.toString(16);
  }
  return { simhash: hex, tagCount };
}

/**
 * 64-bit simhash of the DOM tag structure: opening tag names in document order
 * (script/style/noscript/template/textarea contents are not tokenised), shingles
 * of `shingle` tokens (default 4), md5-based 64-bit shingle hashes.
 * Returns null when fewer than `minTags` (default 25) tags were found.
 */
export function domSimhash(html: string, opts: { minTags?: number; shingle?: number } = {}): { simhash: string | null; tagCount: number } {
  try {
    const tokens = scanHtml(html ?? "")
      .filter((e): e is { type: "tag"; tag: StartTag } => e.type === "tag")
      .map((e) => e.tag.name);
    return simhashFromTokens(tokens, opts.minTags ?? DEFAULT_MIN_TAGS, opts.shingle ?? DEFAULT_SHINGLE);
  } catch {
    return { simhash: null, tagCount: 0 };
  }
}

/** Hamming distance of two 16-hex simhashes. */
export function simhashDistance(a: string, b: string): number {
  return hammingDistance(a, b);
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/**
 * Normalises a comment: strips `<!-- -->`, `//`, `/* *\/` markers, collapses
 * whitespace, lower-cases. Returns null for conditional comments, comments
 * shorter than 12 characters and comments without letters.
 */
export function normalizeComment(raw: string): string | null {
  let s = (raw ?? "").trim();
  if (s.startsWith("<!--")) s = s.slice(4);
  if (s.endsWith("-->")) s = s.slice(0, -3);
  if (s.startsWith("//")) {
    s = s.slice(2);
  } else if (s.startsWith("/*")) {
    s = s.slice(2);
    if (s.endsWith("*/")) s = s.slice(0, -2);
    s = s.replace(/^[ \t]*\*+/gm, " ");
  }
  const t = s.trim();
  if (/^\[if\b/i.test(t) || /^\[endif\]/i.test(t) || /<!\[endif\]/i.test(t) || /^<!\[endif/i.test(t)) return null;
  const norm = t.replace(/\s+/g, " ").trim().toLowerCase();
  if (norm.length < 12) return null;
  if (!/\p{L}/u.test(norm)) return null;
  return norm.slice(0, MAX_COMMENT_LEN);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function emptyKit(): PageKit {
  return { endpoints: [], domSimhash: null, tagCount: 0, hiddenFields: [], assets: [], comments: [], cyrillicComments: false, pathIds: [], lander: null };
}

function resolveAgainst(href: string, base: string | null): URL | null {
  const h = href.trim();
  if (!h) return null;
  try {
    const abs = h.startsWith("//") ? `https:${h}` : h;
    const u = base ? new URL(abs, base) : new URL(abs);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** Extracts the page-kit fingerprint of one HTML document. Never throws. */
export function extractPageKit(html: string, pageUrl: string, opts: { minTags?: number; shingle?: number } = {}): PageKit {
  if (!html) return emptyKit();
  try {
    const events = scanHtml(html);
    const page = parseAbsolute(pageUrl);
    const pageHref = page ? page.toString() : null;
    const pageHost = page ? hostOfUrl(page) : null;

    // Effective base for forms and assets: <base href> resolved against the page URL.
    let base = pageHref;
    for (const e of events) {
      if (e.type === "tag" && e.tag.name === "base" && e.tag.attrs.href) {
        const b = resolveAgainst(e.tag.attrs.href, pageHref);
        if (b) base = b.toString();
        break;
      }
    }

    const tokens: string[] = [];
    const endpoints: EndpointRef[] = [];
    const hidden = new Set<string>();
    const assets = new Map<string, AssetRef>();
    const comments: string[] = [];
    const seenComments = new Set<string>();
    let cyrillic = false;
    /** UUID path segment -> same-origin resource paths that contain it, and the path before it (first seen). */
    const pathIdResources = new Map<string, { urls: Set<string>; prefix: string }>();

    const addResource = (href: string) => {
      const u = resolveAgainst(href, base);
      if (!u || pageHost === null || hostOfUrl(u) !== pageHost) return;
      const segs = u.pathname.toLowerCase().split("/");
      segs.forEach((seg, i) => {
        if (!UUID_SEGMENT.test(seg)) return;
        const entry = pathIdResources.get(seg) ?? { urls: new Set<string>(), prefix: `${segs.slice(0, i).join("/")}/` };
        entry.urls.add(u.pathname);
        pathIdResources.set(seg, entry);
      });
    };

    const addComment = (raw: string) => {
      if (!cyrillic && hasCyrillic(raw)) cyrillic = true;
      if (comments.length >= MAX_COMMENTS) return;
      const norm = normalizeComment(raw);
      if (norm && !seenComments.has(norm)) {
        seenComments.add(norm);
        comments.push(norm);
      }
    };

    const addAsset = (href: string, kind: "js" | "css") => {
      if (assets.size >= MAX_ASSETS) return;
      const u = resolveAgainst(href, base);
      if (!u) return;
      const host = hostOfUrl(u);
      if (!host) return;
      const path = u.pathname.toLowerCase() || "/";
      const sameOrigin = pageHost !== null && host === pageHost;
      const key = sameOrigin ? path : `${host}${path}`;
      if (assets.has(key)) return;
      const segs = path.split("/");
      assets.set(key, {
        key,
        url: `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`,
        host,
        path,
        basename: segs[segs.length - 1] ?? "",
        kind,
        sameOrigin,
      });
    };

    for (const e of events) {
      if (e.type === "comment") {
        addComment(e.text);
        continue;
      }
      if (e.type === "script") {
        if (e.external || !JS_SCRIPT_TYPES.has(e.scriptType)) continue;
        const lexed = lexJs(e.body);
        for (const c of lexed.comments) addComment(c);
        endpoints.push(...endpointsFromScript(e.body, lexed.literals, pageHref, pageHost));
        continue;
      }
      const { name, attrs } = e.tag;
      tokens.push(name);
      if (attrs.src) addResource(attrs.src);
      if (name === "link" && attrs.href) addResource(attrs.href);
      if (name === "form" && attrs.action !== undefined) {
        const action = attrs.action.trim();
        if (action && !action.startsWith("#") && !/^(?:javascript|mailto):/i.test(action)) {
          const method = (attrs.method ?? "GET").trim().toUpperCase() || "GET";
          const ep = toEndpoint(action, "form", method, base, pageHost);
          if (ep) endpoints.push(ep);
        }
      } else if (name === "input") {
        const type = (attrs.type ?? "").trim().toLowerCase();
        const fieldName = (attrs.name ?? "").trim().toLowerCase();
        if (type === "hidden" && fieldName && hidden.size < MAX_HIDDEN) hidden.add(fieldName);
      } else if (name === "script" && attrs.src) {
        addAsset(attrs.src, "js");
      } else if (name === "link" && attrs.href) {
        const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/);
        if (rel.includes("stylesheet")) addAsset(attrs.href, "css");
      }
    }

    // Deduplicate endpoints by key, keeping the first occurrence's via/method.
    const byKey = new Map<string, EndpointRef>();
    for (const ep of endpoints) if (!byKey.has(ep.key)) byKey.set(ep.key, ep);
    const sortedEndpoints = [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).slice(0, MAX_ENDPOINTS);

    const { simhash, tagCount } = simhashFromTokens(tokens, opts.minTags ?? DEFAULT_MIN_TAGS, opts.shingle ?? DEFAULT_SHINGLE);

    return {
      endpoints: sortedEndpoints,
      domSimhash: simhash,
      tagCount,
      hiddenFields: [...hidden].sort(),
      assets: [...assets.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
      comments,
      cyrillicComments: cyrillic,
      pathIds: [...pathIdResources]
        .filter(([, e]) => e.urls.size >= MIN_PATH_ID_RESOURCES)
        .map(([id, e]) => ({ id, prefix: e.prefix }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, MAX_PATH_IDS),
      lander: extractLanderConfig(html),
    };
  } catch {
    return emptyKit();
  }
}
