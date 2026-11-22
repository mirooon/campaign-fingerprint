/**
 * Pure extraction of OSINT pivots from HTML and from ad copy.
 *
 * - page metadata: title, meta description, Open Graph, canonical, generator
 * - tracker IDs: GA4, Universal Analytics, GTM, Google Ads, Meta pixel,
 *   TikTok pixel, Yandex Metrica
 * - favicon URL, outbound links / registrable domains
 * - contact pivots: e-mails, Polish phone numbers (E.164), Telegram, WhatsApp
 * - crypto wallets (checksum-validated, see ./crypto)
 * - redirect hints: <meta http-equiv="refresh"> and JS `location = "…"` string
 *   literals (extracted statically, never executed)
 *
 * No HTML parser dependency: a small linear tag/attribute scanner is used, and
 * the regexes are deliberately conservative. Never throws on malformed HTML.
 */
import { extractCompanyIds, type CompanyId } from "../text/companyIds";
import { extractContactSignals, type ContactSignals } from "./contact";
import { detectCms } from "./infraSignals";
import { extractSiteAttributes, type SiteAttributes } from "./siteAttributes";
import { extractShopSignals, type ShopSignals } from "./shopSignals";
import { findWallets, type WalletMatch } from "./crypto";
import { extractUrlsFromText, hostOf, normalizeUrl, registrableDomain, resolveUrl } from "./urls";

export type TrackerKind =
  | "ga4"
  | "ua"
  | "gtm"
  | "google_ads"
  | "meta_pixel"
  | "tiktok_pixel"
  | "yandex_metrica"
  // domain verification tokens: one per Business Manager / Search Console / Webmaster account (B-155)
  | "meta_domain_verification"
  | "google_site_verification"
  | "yandex_verification"
  // more analytics (B-162) and the AdSense publisher (B-178)
  | "clarity"
  | "matomo"
  | "posthog"
  | "adsense";

export interface TrackerId {
  kind: TrackerKind;
  id: string;
}

export interface PageExtract {
  title: string | null;
  description: string | null;
  canonical: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  ogSiteName: string | null;
  trackers: TrackerId[];
  faviconUrl: string | null;
  outboundDomains: string[];
  outboundUrls: string[];
  emails: string[];
  phones: string[];
  telegram: string[];
  whatsapp: string[];
  wallets: WalletMatch[];
  metaRefresh: string | null;
  jsRedirects: string[];
  visibleText: string;
  generator: string | null;
  /** Company identifiers and bank accounts of the page (lib/text/companyIds.ts); absent in files written before they were read. */
  companyIds?: CompanyId[];
  /** Names with a legal form found on the page. */
  legalEntities?: string[];
  /** Why part of the company data was not read (a JSON-LD block that is not JSON). */
  companyIdNotes?: string[];
  /** Signals of a fake shop (lib/osint/shopSignals.ts); null when the page is not a shop, absent in files written before they were read. */
  shopSignals?: ShopSignals | null;
  /** Domain kinds of the e-mail addresses, completeness of the postal address (lib/osint/contact.ts). */
  contact?: ContactSignals;
  /** Shop platforms named by the generator tag or by the paths in the markup (lib/osint/infraSignals.ts). */
  cms?: string[];
  /** Weak attributes of the page and its domain (rare TLD, language of the domain name, privacy controller, fake courier payment); only with a page address. */
  siteAttributes?: SiteAttributes;
}

export interface TextExtract {
  urls: string[];
  emails: string[];
  phones: string[];
  telegram: string[];
  whatsapp: string[];
  wallets: WalletMatch[];
}

const MAX_VISIBLE_TEXT = 5000;
const MAX_OUTBOUND_URLS = 300;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function uniqueInOrder<T>(values: Iterable<T>, keyOf: (v: T) => string = (v) => String(v)): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of values) {
    const k = keyOf(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function nonEmpty(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null;
  const t = collapseWhitespace(s);
  return t ? t : null;
}

function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// ---------------------------------------------------------------------------
// HTML entities
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ", // decoded to a plain space on purpose (simplifies downstream regexes)
  shy: "",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  laquo: "«",
  raquo: "»",
  bdquo: "„",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  euro: "€",
  pound: "£",
  dollar: "$",
  deg: "°",
  middot: "·",
  bull: "•",
  times: "×",
  plus: "+",
  commat: "@",
  period: ".",
  colon: ":",
  sol: "/",
  num: "#",
  // Polish letters (HTML5 named entities)
  aogon: "ą",
  Aogon: "Ą",
  cacute: "ć",
  Cacute: "Ć",
  eogon: "ę",
  Eogon: "Ę",
  lstrok: "ł",
  Lstrok: "Ł",
  nacute: "ń",
  Nacute: "Ń",
  oacute: "ó",
  Oacute: "Ó",
  sacute: "ś",
  Sacute: "Ś",
  zacute: "ź",
  Zacute: "Ź",
  zdot: "ż",
  Zdot: "Ż",
  // other common Latin-1 letters
  aacute: "á",
  Aacute: "Á",
  eacute: "é",
  Eacute: "É",
  iacute: "í",
  Iacute: "Í",
  uacute: "ú",
  Uacute: "Ú",
  auml: "ä",
  Auml: "Ä",
  ouml: "ö",
  Ouml: "Ö",
  uuml: "ü",
  Uuml: "Ü",
  szlig: "ß",
};

/** Decodes numeric (decimal/hex) and common named HTML entities. */
export function decodeHtmlEntities(s: string): string {
  if (!s || !s.includes("&")) return s;
  return s.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "�";
      return String.fromCodePoint(cp);
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

// ---------------------------------------------------------------------------
// Tag scanner (linear, tolerant)
// ---------------------------------------------------------------------------

interface Tag {
  name: string;
  attrs: Record<string, string>;
}

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\t" || ch === "\r" || ch === "\f";
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title", "xmp"]);

/** Scans start tags with their (entity-decoded) attributes. Skips comments and raw-text element bodies. */
function scanTags(html: string): Tag[] {
  const tags: Tag[] = [];
  const n = html.length;
  let i = 0;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0 || lt + 1 >= n) break;
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    const first = html.charCodeAt(lt + 1);
    if (!isAsciiLetter(first)) {
      i = lt + 1;
      continue;
    }
    let k = lt + 1;
    while (k < n && /[A-Za-z0-9:_-]/.test(html[k])) k++;
    const name = html.slice(lt + 1, k).toLowerCase();
    const attrs: Record<string, string> = {};
    let p = k;
    let closed = false;
    while (p < n) {
      while (p < n && (isSpace(html[p]) || html[p] === "/")) p++;
      if (p >= n) break;
      if (html[p] === ">") {
        p++;
        closed = true;
        break;
      }
      let q = p;
      while (q < n && !isSpace(html[q]) && html[q] !== "=" && html[q] !== ">" && html[q] !== "/") q++;
      if (q === p) {
        p++; // stray "=" or similar: skip one char to guarantee progress
        continue;
      }
      const attrName = html.slice(p, q).toLowerCase();
      p = q;
      while (p < n && isSpace(html[p])) p++;
      let value = "";
      if (p < n && html[p] === "=") {
        p++;
        while (p < n && isSpace(html[p])) p++;
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
          while (r < n && !isSpace(html[r]) && html[r] !== ">") r++;
          value = html.slice(p, r);
          p = r;
        }
      }
      if (!(attrName in attrs)) attrs[attrName] = decodeHtmlEntities(value);
    }
    tags.push({ name, attrs });
    i = p;
    if (closed && RAW_TEXT_TAGS.has(name)) {
      const closeRe = new RegExp(`</${name}\\s*>`, "gi");
      closeRe.lastIndex = p;
      const m = closeRe.exec(html);
      i = m ? m.index + m[0].length : n;
    }
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Trackers
// ---------------------------------------------------------------------------

function isPlaceholderId(idPart: string): boolean {
  return /^X+$/i.test(idPart);
}

const VERIFICATION_NAMES: Record<string, TrackerKind> = {
  "facebook-domain-verification": "meta_domain_verification",
  "google-site-verification": "google_site_verification",
  "yandex-verification": "yandex_verification",
};

/** A token value that names an account: 8–100 token characters, not a placeholder. */
function isVerificationToken(v: string): boolean {
  return /^[A-Za-z0-9_-]{8,100}$/.test(v) && !isPlaceholderId(v);
}

/**
 * Domain verification tokens from TXT records ("facebook-domain-verification=<token>",
 * "google-site-verification=<token>", "yandex-verification: <token>"); other records (SPF, DKIM) and empty
 * or placeholder values are dropped. Deduped, in input order.
 */
export function verificationTokens(txt: string[]): TrackerId[] {
  const out: TrackerId[] = [];
  for (const rec of txt) {
    const m = /^\s*"?(facebook-domain-verification|google-site-verification|yandex-verification)\s*[=:]\s*([^"\s]*)"?\s*$/i.exec(rec);
    if (m && isVerificationToken(m[2])) out.push({ kind: VERIFICATION_NAMES[m[1].toLowerCase()], id: m[2] });
  }
  return uniqueInOrder(out, (t) => `${t.kind}|${t.id}`);
}

/** Finds analytics/ad tracker IDs and domain verification tokens of meta tags. Deduped and sorted by kind, then id. */
export function findTrackers(source: string): TrackerId[] {
  if (!source) return [];
  const found: TrackerId[] = [];
  const add = (kind: TrackerKind, id: string) => {
    const idPart = id.includes("-") ? id.slice(id.indexOf("-") + 1) : id;
    if (isPlaceholderId(idPart)) return;
    found.push({ kind, id });
  };

  // GA4 in context (any case accepted, canonicalised to upper-case).
  for (const m of source.matchAll(/gtag\(\s*['"]config['"]\s*,\s*['"]([Gg]-[A-Za-z0-9]{4,15})['"]/g)) {
    add("ga4", m[1].toUpperCase());
  }
  for (const m of source.matchAll(
    /googletagmanager\.com\/gtag\/js\?(?:[^"'\s<>]*?&(?:amp;)?)?id=(G-[A-Za-z0-9]{4,15})(?![A-Za-z0-9])/gi,
  )) {
    add("ga4", m[1].toUpperCase());
  }
  // GA4 bare: exactly 10 upper-case alphanumerics with at least one digit and one letter.
  for (const m of source.matchAll(/(?<![A-Za-z0-9_-])G-([A-Z0-9]{10})(?![A-Za-z0-9_-])/g)) {
    if (/[0-9]/.test(m[1]) && /[A-Z]/.test(m[1])) add("ga4", `G-${m[1]}`);
  }
  // Universal Analytics
  for (const m of source.matchAll(/(?<![A-Za-z0-9_-])UA-\d{4,10}-\d{1,4}(?![\d-])/g)) add("ua", m[0]);
  // Google Tag Manager
  for (const m of source.matchAll(/(?<![A-Za-z0-9_-])GTM-[A-Z0-9]{4,9}(?![A-Za-z0-9_-])/g)) add("gtm", m[0]);
  // Google Ads
  for (const m of source.matchAll(/(?<![A-Za-z0-9_-])AW-\d{9,11}(?!\d)/g)) add("google_ads", m[0]);
  // Meta (Facebook) pixel
  for (const m of source.matchAll(/fbq\(\s*['"]init['"]\s*,\s*['"]?(\d{10,20})(?!\d)/g)) add("meta_pixel", m[1]);
  for (const m of source.matchAll(/facebook\.com\/tr\/?\?(?:[^"'\s<>]*?&(?:amp;)?)?id=(\d{10,20})(?!\d)/gi)) {
    add("meta_pixel", m[1]);
  }
  // TikTok pixel
  for (const m of source.matchAll(/ttq\.load\(\s*['"]([A-Za-z0-9]{15,25})['"]/g)) add("tiktok_pixel", m[1].toUpperCase());
  for (const m of source.matchAll(
    /analytics\.tiktok\.com\/i18n\/pixel\/(?:events|sdk)\.js\?(?:[^"'\s<>]*?&(?:amp;)?)?sdkid=([A-Za-z0-9]{15,25})(?![A-Za-z0-9])/gi,
  )) {
    add("tiktok_pixel", m[1].toUpperCase());
  }
  // Yandex Metrica
  for (const m of source.matchAll(/(?<![\w.])ym\(\s*(\d{5,10})\s*,\s*['"]init['"]/g)) add("yandex_metrica", m[1]);
  for (const m of source.matchAll(/mc\.yandex\.(?:ru|com|by|kz|ua|com\.tr)\/watch\/(\d{5,10})(?!\d)/gi)) {
    add("yandex_metrica", m[1]);
  }
  for (const m of source.matchAll(/Ya\.Metrika2?\(\s*\{\s*id\s*:\s*['"]?(\d{5,10})(?!\d)/g)) add("yandex_metrica", m[1]);
  // Microsoft Clarity project (snippet argument or tag URL)
  for (const m of source.matchAll(/["']clarity["']\s*,\s*["']script["']\s*,\s*["']([a-z0-9]{6,14})["']/gi)) add("clarity", m[1].toLowerCase());
  for (const m of source.matchAll(/clarity\.ms\/tag\/([a-z0-9]{6,14})(?![a-z0-9])/gi)) add("clarity", m[1].toLowerCase());
  // Matomo: tracker host + site ID (one installation counts sites from 1, so the host is part of the ID)
  const matomoUrl = /setTrackerUrl['"]\s*,\s*['"]((?:https?:)?\/\/[^'"\/]+)\//i.exec(source)?.[1];
  const matomoSite = /setSiteId['"]\s*,\s*['"]?(\d{1,6})/i.exec(source)?.[1];
  if (matomoUrl && matomoSite) add("matomo", `${matomoUrl.replace(/^(?:https?:)?\/\//i, "").toLowerCase()}/${matomoSite}`);
  // PostHog project key
  for (const m of source.matchAll(/(?<![A-Za-z0-9_])(phc_[A-Za-z0-9]{20,64})(?![A-Za-z0-9])/g)) add("posthog", m[1]);
  // AdSense publisher (a page-kit trait: publisher IDs are pooled by unrelated sites)
  for (const m of source.matchAll(/(?<![\w-])ca-pub-(\d{16})(?!\d)/g)) add("adsense", `ca-pub-${m[1]}`);
  // Domain verification meta tags (attributes in any order)
  for (const tag of source.matchAll(/<meta\b[^>]*>/gi)) {
    const name = /\bname\s*=\s*["']?([\w-]+)/i.exec(tag[0])?.[1]?.toLowerCase();
    const kind = name ? VERIFICATION_NAMES[name] : undefined;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag[0])?.[1]?.trim() ?? "";
    if (kind && isVerificationToken(content)) add(kind, content);
  }

  const unique = uniqueInOrder(found, (t) => `${t.kind}|${t.id}`);
  return unique.sort((a, b) => (a.kind === b.kind ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.kind < b.kind ? -1 : 1));
}

// ---------------------------------------------------------------------------
// E-mails
// ---------------------------------------------------------------------------

const FILE_LIKE_TLDS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "css", "js", "ico", "bmp", "avif"]);
const EMAIL_RE =
  /(?<![A-Za-z0-9._%+-])([A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,62}[A-Za-z0-9_%+-])?)@((?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+([A-Za-z]{2,24}))(?![A-Za-z0-9_-]|\.[A-Za-z0-9])/g;

/** Finds e-mail addresses (lower-cased, deduped). Rejects file-name-like matches such as logo@2x.png. */
export function findEmails(text: string): string[] {
  if (!text) return [];
  const source = text.includes("%40") ? text.replace(/mailto:([^\s"'<>]+)/gi, (m) => safeDecodeURIComponent(m)) : text;
  const out: string[] = [];
  for (const m of source.matchAll(EMAIL_RE)) {
    const tld = m[3].toLowerCase();
    if (FILE_LIKE_TLDS.has(tld)) continue;
    if (m[1].includes("..")) continue;
    out.push(`${m[1]}@${m[2]}`.toLowerCase());
  }
  return uniqueInOrder(out);
}

// ---------------------------------------------------------------------------
// Phones
// ---------------------------------------------------------------------------

const PL_MOBILE_PREFIXES = new Set(["45", "50", "51", "53", "57", "60", "66", "69", "72", "73", "78", "79", "88"]);
const PL_AREA_CODES = new Set([
  "12", "13", "14", "15", "16", "17", "18", "22", "23", "24", "25", "29", "32", "33", "34", "41", "42", "43",
  "44", "46", "48", "52", "54", "55", "56", "58", "59", "61", "62", "63", "65", "67", "68", "71", "74", "75",
  "76", "77", "81", "82", "83", "84", "85", "86", "87", "89", "91", "94", "95",
]);

function isPlausiblePolishNational(nine: string): boolean {
  if (!/^[1-9]\d{8}$/.test(nine)) return false;
  if (nine.endsWith("000000")) return false; // prices / round numbers, not phones
  return true;
}

function hasValidPolishPrefix(nine: string): boolean {
  const p = nine.slice(0, 2);
  return PL_MOBILE_PREFIXES.has(p) || PL_AREA_CODES.has(p);
}

/**
 * Normalises a phone number to E.164. Polish 9-digit national numbers get
 * +48; numbers with an explicit +CC / 00CC prefix are kept when they have
 * 8–15 digits (Polish ones must have exactly 9 national digits).
 */
export function normalizePhone(raw: string, defaultCountry = "48"): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const hasPlus = /^\(?\s*\+/.test(trimmed);
  let digits = trimmed.replace(/\D/g, "");
  let international = hasPlus;
  if (!international && digits.startsWith("00")) {
    international = true;
    digits = digits.slice(2);
  }
  if (international) {
    if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
    if (digits.startsWith("48")) {
      const national = digits.slice(2);
      return national.length === 9 && /^[1-9]/.test(national) ? `+${digits}` : null;
    }
    return `+${digits}`;
  }
  if (defaultCountry === "48") {
    if (digits.length === 10 && digits.startsWith("0")) digits = digits.slice(1); // old trunk prefix
    if (digits.length === 11 && digits.startsWith("48")) digits = digits.slice(2);
    if (digits.length === 9 && /^[1-9]/.test(digits)) return `+48${digits}`;
    return null;
  }
  if (digits.length >= 6 && digits.length <= 15 - defaultCountry.length) return `+${defaultCountry}${digits}`;
  return null;
}

const CURRENCY_AFTER = /^\s?(?:zł|zl|pln|eur|usd|gbp|€|\$|%|złotych|tys)/i;

const PL_PREFIXED_RE =
  /(?<![\w+])(?:\(\s*(?:\+|00)\s?48\s*\)|(?:\+|00)\s?48)[ \t.-]?(?:\(\d{2}\)[ \t.-]?)?\d(?:[ \t.-]?\d){6,8}(?!\d)/g;
const PL_333_RE = /(?<![\w+])(?<!\d[ .-])(\d{3})([ .-])(\d{3})\2(\d{3})(?![ .-]?\d)(?!\w)/g;
const PL_LANDLINE_RE =
  /(?<![\w+])(?<!\d[ .-])(?:\((\d{2})\)|(\d{2}))[ .-]?(\d{3})[ .-](\d{2})[ .-](\d{2})(?![ .-]?\d)(?!\w)/g;
const TEL_LINK_RE = /tel:\s*(\+?[\d\s().-]{6,24}\d)/gi;

/** Finds (mostly Polish) phone numbers and returns them in E.164, deduped, in order of appearance. */
export function findPolishPhones(text: string): string[] {
  if (!text) return [];
  const hits: Array<{ index: number; phone: string }> = [];

  for (const m of text.matchAll(PL_PREFIXED_RE)) {
    let digits = m[0].replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    const national = digits.slice(2);
    if (digits.startsWith("48") && national.length === 9 && isPlausiblePolishNational(national)) {
      hits.push({ index: m.index ?? 0, phone: `+48${national}` });
    }
  }
  for (const m of text.matchAll(PL_333_RE)) {
    const national = `${m[1]}${m[3]}${m[4]}`;
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 9);
    if (CURRENCY_AFTER.test(after)) continue;
    if (isPlausiblePolishNational(national) && hasValidPolishPrefix(national)) {
      hits.push({ index: m.index ?? 0, phone: `+48${national}` });
    }
  }
  for (const m of text.matchAll(PL_LANDLINE_RE)) {
    const area = m[1] ?? m[2];
    const national = `${area}${m[3]}${m[4]}${m[5]}`;
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 9);
    if (CURRENCY_AFTER.test(after)) continue;
    if (PL_AREA_CODES.has(area) && isPlausiblePolishNational(national)) {
      hits.push({ index: m.index ?? 0, phone: `+48${national}` });
    }
  }
  for (const m of text.matchAll(TEL_LINK_RE)) {
    const phone = normalizePhone(safeDecodeURIComponent(m[1]));
    if (phone) hits.push({ index: m.index ?? 0, phone });
  }

  hits.sort((a, b) => a.index - b.index);
  return uniqueInOrder(hits.map((h) => h.phone));
}

// ---------------------------------------------------------------------------
// Telegram / WhatsApp
// ---------------------------------------------------------------------------

const TELEGRAM_RESERVED = new Set([
  "share",
  "proxy",
  "socks",
  "login",
  "boost",
  "addstickers",
  "addemoji",
  "addtheme",
  "addlist",
  "setlanguage",
  "confirmphone",
  "invoice",
  "giftcode",
  "contact",
  "joinchat",
]);

const TG_URL_RE =
  /(?<![\w.-])(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:s\/)?(\+[A-Za-z0-9_-]{8,64}|joinchat\/[A-Za-z0-9_-]{8,64}|[A-Za-z][A-Za-z0-9_]{4,31})(?![A-Za-z0-9_-])/gi;
const TG_RESOLVE_RE = /tg:\/\/resolve\?(?:[^"'\s<>]*?&(?:amp;)?)?domain=([A-Za-z][A-Za-z0-9_]{4,31})(?![A-Za-z0-9_])/gi;
const TG_JOIN_RE = /tg:\/\/join\?invite=([A-Za-z0-9_-]{8,64})/gi;
const TG_AT_RE =
  /\b(?:telegram(?:ie|a|u|em)?|tg)\b[^@\n]{0,30}?(?<![\w.+-])@([A-Za-z][A-Za-z0-9_]{4,31})(?![\w@-]|\.[A-Za-z0-9])/gi;

/** Finds Telegram usernames ("t.me/<user>", lower-cased) and invite links (case preserved). */
export function findTelegram(text: string): string[] {
  if (!text) return [];
  const hits: Array<{ index: number; value: string }> = [];
  for (const m of text.matchAll(TG_URL_RE)) {
    const target = m[1];
    if (target.startsWith("+")) hits.push({ index: m.index ?? 0, value: `t.me/${target}` });
    else if (target.toLowerCase().startsWith("joinchat/")) {
      hits.push({ index: m.index ?? 0, value: `t.me/joinchat/${target.slice("joinchat/".length)}` });
    } else if (!TELEGRAM_RESERVED.has(target.toLowerCase())) {
      hits.push({ index: m.index ?? 0, value: `t.me/${target.toLowerCase()}` });
    }
  }
  for (const m of text.matchAll(TG_RESOLVE_RE)) {
    if (!TELEGRAM_RESERVED.has(m[1].toLowerCase())) hits.push({ index: m.index ?? 0, value: `t.me/${m[1].toLowerCase()}` });
  }
  for (const m of text.matchAll(TG_JOIN_RE)) hits.push({ index: m.index ?? 0, value: `t.me/+${m[1]}` });
  for (const m of text.matchAll(TG_AT_RE)) {
    if (!TELEGRAM_RESERVED.has(m[1].toLowerCase())) hits.push({ index: m.index ?? 0, value: `t.me/${m[1].toLowerCase()}` });
  }
  hits.sort((a, b) => a.index - b.index);
  return uniqueInOrder(hits.map((h) => h.value));
}

const WA_ME_RE = /(?<![\w.-])(?:https?:\/\/)?(?:www\.)?wa\.me\/(?:\+|%2B)?(\d{8,15})(?!\d)/gi;
const WA_SEND_RE =
  /(?:(?:api|web)\.whatsapp\.com\/send\/?|whatsapp:\/\/send\/?)\?(?:[^"'\s<>]*?&(?:amp;)?)?phone=(?:\+|%2B)?(\d{8,15})(?!\d)/gi;
const WA_GROUP_RE = /chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{10,40})(?![A-Za-z0-9])/gi;

/** Finds WhatsApp contacts: E.164 numbers from wa.me / send?phone= links and group invites. */
export function findWhatsapp(text: string): string[] {
  if (!text) return [];
  const hits: Array<{ index: number; value: string }> = [];
  for (const re of [WA_ME_RE, WA_SEND_RE]) {
    for (const m of text.matchAll(re)) {
      const phone = normalizePhone(`+${m[1]}`);
      if (phone) hits.push({ index: m.index ?? 0, value: phone });
    }
  }
  for (const m of text.matchAll(WA_GROUP_RE)) hits.push({ index: m.index ?? 0, value: `chat.whatsapp.com/${m[1]}` });
  hits.sort((a, b) => a.index - b.index);
  return uniqueInOrder(hits.map((h) => h.value));
}

// ---------------------------------------------------------------------------
// Visible text and redirects
// ---------------------------------------------------------------------------

interface HtmlParts {
  /** Full visible text (not truncated): comments, raw-text bodies and tags removed, entities decoded. */
  text: string;
  /** Inline <script> bodies. */
  scripts: string[];
  title: string | null;
}

const NON_VISIBLE_OPEN_RE = /<!--|<(script|style|noscript|template|title)\b[^<>]*>/gi;

/**
 * One linear pass over the document: drops comments and the bodies of
 * script/style/noscript/template/title, collects inline script bodies and the
 * first title. Every search moves forward, so pathological input (millions of
 * "<", unclosed comments or tags) stays O(n).
 */
function splitHtml(html: string): HtmlParts {
  const textParts: string[] = [];
  const scripts: string[] = [];
  let title: string | null = null;
  const n = html.length;
  const openRe = new RegExp(NON_VISIBLE_OPEN_RE.source, "gi");
  let i = 0;
  while (i < n) {
    openRe.lastIndex = i;
    const m = openRe.exec(html);
    if (!m) {
      textParts.push(html.slice(i));
      break;
    }
    textParts.push(html.slice(i, m.index), " ");
    if (m[0] === "<!--") {
      const end = html.indexOf("-->", m.index + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    const tag = m[1].toLowerCase();
    const bodyStart = m.index + m[0].length;
    const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
    closeRe.lastIndex = bodyStart;
    const close = closeRe.exec(html);
    const body = html.slice(bodyStart, close ? close.index : n);
    if (tag === "script") scripts.push(body);
    else if (tag === "title" && title === null) title = nonEmpty(decodeHtmlEntities(body));
    i = close ? close.index + close[0].length : n;
  }
  // `[^<>]` (not `[^>]`) keeps tag stripping linear when ">" never appears.
  const stripped = textParts.join("").replace(/<[^<>]*>/g, " ");
  return { text: collapseWhitespace(decodeHtmlEntities(stripped)), scripts, title };
}

function parseMetaRefresh(content: string, base: string | undefined): string | null {
  const m = /^\s*\d*(?:\.\d+)?\s*[;,]?\s*(?:url\s*=\s*)?(.*)$/i.exec(content);
  if (!m) return null;
  const target = m[1].trim().replace(/^['"]|['"]$/g, "").trim();
  if (!target) return null;
  if (base) return resolveUrl(target, base);
  return normalizeUrl(target)?.url ?? null;
}

const JS_REDIRECT_RES: RegExp[] = [
  /\blocation(?:\.href)?\s*=\s*(['"`])([^'"`\s]{1,2048})\1/g,
  /\blocation\.(?:replace|assign)\(\s*(['"`])([^'"`\s]{1,2048})\1\s*\)/g,
];

function findJsRedirects(scripts: string, base: string | undefined): string[] {
  const out: string[] = [];
  for (const re of JS_REDIRECT_RES) {
    for (const m of scripts.matchAll(re)) {
      const target = m[2];
      // Only URL-looking targets (absolute, protocol-relative, rooted or ./ ../ relative, query).
      if (!/^(?:https?:)?\/\/|^\/|^\.\.?\/|^\?/i.test(target)) continue;
      const abs = base ? resolveUrl(target, base) : normalizeUrl(target)?.url ?? null;
      if (abs) out.push(abs);
    }
  }
  return uniqueInOrder(out);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function emptyExtract(baseUrl?: string): PageExtract {
  let favicon: string | null = null;
  if (baseUrl) favicon = resolveUrl("/favicon.ico", baseUrl);
  return {
    title: null,
    description: null,
    canonical: null,
    ogTitle: null,
    ogDescription: null,
    ogImage: null,
    ogSiteName: null,
    trackers: [],
    faviconUrl: favicon,
    outboundDomains: [],
    outboundUrls: [],
    emails: [],
    phones: [],
    telegram: [],
    whatsapp: [],
    wallets: [],
    metaRefresh: null,
    jsRedirects: [],
    visibleText: "",
    generator: null,
    companyIds: [],
    legalEntities: [],
    companyIdNotes: [],
  };
}

const CONTACT_ATTRS = new Set(["href", "action", "content", "title", "alt", "value", "data-href"]);
const URL_ATTRS = ["href", "src", "action", "data-href"];

function iconPriority(rel: string[]): number {
  if (rel.includes("icon")) return 1; // "icon", "shortcut icon"
  if (rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed")) return 2;
  if (rel.some((r) => r.includes("icon"))) return 3;
  return 0;
}

/** Extracts metadata, trackers, links and contact pivots from an HTML document. */
export function extractFromHtml(html: string, baseUrl?: string): PageExtract {
  const result = emptyExtract(baseUrl);
  if (!html) return result;
  try {
    const tags = scanTags(html);

    // Effective base: <base href> resolved against the document URL.
    let base = baseUrl && resolveUrl(baseUrl, baseUrl) ? baseUrl : undefined;
    const baseTag = tags.find((t) => t.name === "base" && t.attrs.href);
    if (baseTag) {
      const resolved = base ? resolveUrl(baseTag.attrs.href, base) : resolveUrl(baseTag.attrs.href, baseTag.attrs.href);
      if (resolved) base = resolved;
    }
    const resolveAgainstBase = (href: string): string | null =>
      base ? resolveUrl(href, base) : resolveUrl(href, href);

    const parts = splitHtml(html);
    result.title = parts.title;

    let bestIcon: { priority: number; url: string } | null = null;
    for (const tag of tags) {
      if (tag.name === "meta") {
        const key = (tag.attrs.name ?? tag.attrs.property ?? tag.attrs.itemprop ?? "").toLowerCase().trim();
        const content = tag.attrs.content ?? "";
        if (key === "description" && result.description === null) result.description = nonEmpty(content);
        else if (key === "og:title" && result.ogTitle === null) result.ogTitle = nonEmpty(content);
        else if (key === "og:description" && result.ogDescription === null) result.ogDescription = nonEmpty(content);
        else if (key === "og:site_name" && result.ogSiteName === null) result.ogSiteName = nonEmpty(content);
        else if ((key === "og:image" || key === "og:image:url") && result.ogImage === null && content.trim()) {
          result.ogImage = resolveAgainstBase(content.trim());
        } else if (key === "generator" && result.generator === null) result.generator = nonEmpty(content);
        const httpEquiv = (tag.attrs["http-equiv"] ?? "").toLowerCase().trim();
        if (httpEquiv === "refresh" && result.metaRefresh === null && content) {
          result.metaRefresh = parseMetaRefresh(content, base);
        }
      } else if (tag.name === "link" && tag.attrs.href) {
        const rel = (tag.attrs.rel ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        if (rel.includes("canonical") && result.canonical === null) result.canonical = resolveAgainstBase(tag.attrs.href);
        const priority = iconPriority(rel);
        if (priority > 0 && (!bestIcon || priority < bestIcon.priority)) {
          const url = resolveAgainstBase(tag.attrs.href);
          if (url) bestIcon = { priority, url };
        }
      }
    }
    if (bestIcon) result.faviconUrl = bestIcon.url;
    else if (base) result.faviconUrl = resolveUrl("/favicon.ico", base);

    // Outbound links: absolute http(s) URLs pointing outside the page's own site.
    const ownKey = base ? registrableDomain(base) ?? hostOf(base) : null;
    const outbound: string[] = [];
    const contactSources: string[] = [];
    // Inline JS for static redirect hints: <script> bodies, on* handlers, javascript: hrefs.
    const scriptSources: string[] = [...parts.scripts];
    for (const tag of tags) {
      for (const attr of URL_ATTRS) {
        const value = tag.attrs[attr];
        if (!value) continue;
        const abs = resolveAgainstBase(value);
        if (!abs) continue;
        const normalized = normalizeUrl(abs)?.url ?? abs;
        const key = registrableDomain(normalized) ?? hostOf(normalized);
        if (key && key !== ownKey) outbound.push(normalized);
      }
      for (const [name, value] of Object.entries(tag.attrs)) {
        if (!value) continue;
        if (CONTACT_ATTRS.has(name) || name.startsWith("data-")) contactSources.push(value);
        if (name.startsWith("on") || (name === "href" && /^\s*javascript:/i.test(value))) scriptSources.push(value);
      }
    }
    result.outboundUrls = uniqueInOrder(outbound).slice(0, MAX_OUTBOUND_URLS);
    result.outboundDomains = [
      ...new Set(result.outboundUrls.map((u) => registrableDomain(u)).filter((d): d is string => !!d)),
    ].sort();

    result.trackers = findTrackers(html);
    result.visibleText = parts.text.length > MAX_VISIBLE_TEXT ? parts.text.slice(0, MAX_VISIBLE_TEXT) : parts.text;

    // Contacts come from the full (untruncated) visible text plus attribute values.
    const contactText = [parts.text, ...contactSources].join("\n");
    result.emails = findEmails(contactText);
    result.phones = findPolishPhones(contactText);
    result.telegram = findTelegram(contactText);
    result.whatsapp = findWhatsapp(contactText);
    result.wallets = findWallets(contactText);
    result.jsRedirects = findJsRedirects(scriptSources.join("\n"), base);
    const company = extractCompanyIds({ text: parts.text, html });
    result.companyIds = company.companyIds;
    result.legalEntities = company.legalEntities;
    result.companyIdNotes = company.notes;
    result.shopSignals = extractShopSignals({ html, url: baseUrl, legalEntities: company.legalEntities });
    result.cms = detectCms({ generator: result.generator, html });
    if (baseUrl) result.siteAttributes = extractSiteAttributes({ html, text: parts.text, url: baseUrl, emails: result.emails });
    result.contact = extractContactSignals({ html, text: parts.text, url: baseUrl, emails: result.emails, phones: result.phones });
  } catch {
    // Malformed input: return whatever was extracted so far.
  }
  return result;
}

/** Extracts URLs and contact pivots from ad copy (plain text). */
export function extractFromText(text: string): TextExtract {
  const t = text ?? "";
  return {
    urls: extractUrlsFromText(t),
    emails: findEmails(t),
    phones: findPolishPhones(t),
    telegram: findTelegram(t),
    whatsapp: findWhatsapp(t),
    wallets: findWallets(t),
  };
}
