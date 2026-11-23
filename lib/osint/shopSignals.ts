/**
 * Signals of a fake web shop read from one page: legal pages, prices and discounts, urgency tricks,
 * payment methods, delivery time, reviews, the name and year in the footer, claimed seniority.
 *
 * These are attributes of the material: they explain in the viewer and the evidence pack why a page looks
 * suspicious, and none of them links anything. Honest shops also lack the price of the last 30 days, show
 * only five-star reviews or take a single method of payment, so no flag has a weight in the graph
 * (the one new linking trace of the shop topic is the postal address, lib/text/postalAddress.ts).
 *
 * A page that is not a shop (no price with a cart word, no Product or Offer in JSON-LD) gives `null`.
 * Pure functions on markup: no network, no files. The page is untrusted, so every scan is linear and
 * bounded (an unclosed tag or script ends the scan instead of being searched for again).
 */
import { foldDiacritics } from "../text/normalize";
import { registrableDomain } from "./urls";
import { DEFAULT_SHOP_SIGNALS_CONFIG, type ShopSignalsConfig, type ShopTechniqueName } from "./shopSignalsConfig";

export type { ShopTechniqueName } from "./shopSignalsConfig";

/** Flags of a shop page; each is an explanation, not a verdict. */
export type ShopFlag =
  | "legalPagesMissing"
  | "sitewideDeepDiscount"
  | "omnibusMissing"
  | "transferOnly"
  | "irreversibleOnly"
  | "paymentRecipientPerson"
  | "deliveryWide"
  | "reviewsAllPerfect"
  | "reviewsNarrowWindow"
  | "reviewsNone"
  | "footerBrandMismatch"
  | "footerYearStale"
  | "claimedSinceContradicted"
  | "reviewsNoSellerReply"
  | "catalogIncoherent";

export interface ShopReviews {
  /** Number of opinions: the declared total of `AggregateRating`, or the opinions counted on the page when there are more of them. */
  count: number;
  /** Opinions per star (keys "1" to "5") counted on the page; null when the page only declares an average. */
  ratingDistribution: Record<string, number> | null;
  /** Share of five-star opinions (0–1); null when no distribution is known. */
  share5: number | null;
  /** Days between the oldest and the newest dated opinion; null when fewer than two have a date. */
  windowDays: number | null;
  /** Share of opinions without an author name or with a generic one (0–1); null when no opinion lists authors. */
  anonymousShare: number | null;
  source: "jsonld" | "html";
  /** Opinions with an answer of the seller; counted only in a review widget read from markup, null otherwise. */
  sellerReplies: number | null;
}

export interface ShopSignals {
  legalPages: { terms: boolean; returns: boolean; privacy: boolean; contact: boolean };
  /** Names of the legal pages the page does not link to ("terms", "returns", "privacy", "contact"). */
  legalPagesMissing: string[];
  discounts: {
    /** Products whose price was read (a pair of old and current price counts once). */
    pricedItems: number;
    /** Share of the priced products with a lower current price than the struck-through one (0–1). */
    discountedShare: number;
    medianDiscountPct: number | null;
    maxDiscountPct: number | null;
  };
  /** At least 70% of the products carry a discount of 50% or more. */
  sitewideDeepDiscount: boolean;
  /** Discounts shown and no phrase about the lowest price of the last 30 days (a weak hint, not proof). */
  omnibusMissing: boolean;
  /** Urgency and story tricks found on the page (attributes without weight). */
  techniques: ShopTechniqueName[];
  paymentMethods: string[];
  transferOnly: boolean;
  irreversibleOnly: boolean;
  paymentRecipientPerson: boolean;
  deliveryDays: { min: number; max: number } | null;
  deliveryWide: boolean;
  reviews: ShopReviews | null;
  reviewsAllPerfect: boolean;
  reviewsNarrowWindow: boolean;
  reviewsNone: boolean;
  /** Name in the copyright line of the footer, without the legal form; null when there is none. */
  footerBrand: string | null;
  /** The footer names another shop than the page: both names; null when they agree or the footer has no name. */
  footerBrandMismatch: { footer: string; brand: string } | null;
  /** Last year of the copyright line. */
  footerYear: number | null;
  footerYearStale: boolean;
  /** Claimed seniority ("since 1998", "20 years on the market"); `year` is null when only a number of years is given and no date is known. */
  claimedSince: { year: number | null; years?: number; quote: string } | null;
  claimedSinceContradicted: boolean;
  /** The names of products come from three or more unrelated categories in a small catalogue, or from none that the shop's own name points to (names of the categories, empty otherwise). */
  catalogCategories: string[];
  catalogIncoherent: boolean;
  reviewsNoSellerReply: boolean;
  /** Flags that hold, in a fixed order; empty for an unremarkable shop. */
  flags: ShopFlag[];
  /** One sentence per flag with the figures or the quote it rests on. */
  details: Partial<Record<ShopFlag, string>>;
}

/** What the signals are read from: the markup and, where known, the date of the first sighting. */
export interface ShopPageInput {
  html: string;
  /** Address of the page (its domain is compared with the name in the footer). */
  url?: string | null;
  /** Date the page was first seen (ISO); the base of the footer year and of "N years on the market". */
  firstSeen?: string | null;
  /** Date of the first snapshot in a web archive (ISO); without it a claimed seniority is not checked. */
  archiveFirstSeen?: string | null;
  /** Names with a legal form found on the page (lib/text/companyIds.ts), used to tell a firm from a person. */
  legalEntities?: string[];
}

/** Context that is not in the markup: the dates of the first sighting and of the archive's first snapshot. */
export interface ShopContext {
  firstSeen?: string | null;
  archiveFirstSeen?: string | null;
}

/** The page is read up to this many characters and this many tags. */
const MAX_CHARS = 2_500_000;
const MAX_TAGS = 150_000;
/** Tags searched forward for the end of an element. */
const SPAN_TAGS = 60;
const DAY_MS = 86_400_000;

interface Tag {
  name: string;
  closing: boolean;
  attrs: Record<string, string>;
  /** Text between this tag and the next one (entities decoded). */
  after: string;
}

interface Markup {
  tags: Tag[];
  /** Visible text: text of the page without scripts and styles. */
  text: string;
  /** Visible text plus the bodies of scripts (pop-ups are often written into scripts). */
  textWithScripts: string;
  jsonLd: unknown[];
}

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">", "&copy;": "©", "&euro;": "€", "&ndash;": "–", "&mdash;": "—" };

/** Text with the common HTML entities decoded and whitespace collapsed to single spaces. */
function decode(s: string): string {
  return s.replace(/&(?:nbsp|amp|quot|#39|apos|lt|gt|copy|euro|ndash|mdash);/g, (m) => ENTITIES[m] ?? m).replace(/\s+/g, " ");
}

/** Folds text to lower case without diacritics, keeping one character for one so offsets stay valid in the original. */
function foldKeepLength(s: string): string {
  let out = "";
  for (const ch of s.toLowerCase()) {
    const f = foldDiacritics(ch);
    out += f.length === 1 ? f : f.charAt(0) || ch;
  }
  return out;
}

/** Lower case without diacritics: the form the phrase lists are written in. */
const fold = (s: string): string => foldDiacritics(s.toLowerCase());

/** Attributes of a tag as a lower-cased name → value record. */
function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of src.matchAll(/([a-zA-Z_:][-\w:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const k = m[1].toLowerCase();
    if (!(k in attrs)) attrs[k] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/**
 * Splits markup in one pass into tags with the text after each of them, the visible text, the text with
 * scripts, and the parsed JSON-LD blocks. A block that is not JSON is skipped (a page may carry broken JSON-LD).
 */
function scanMarkup(html: string): Markup {
  const doc = html.slice(0, MAX_CHARS);
  const lower = doc.toLowerCase();
  const tags: Tag[] = [];
  const visible: string[] = [];
  const withScripts: string[] = [];
  const jsonLd: unknown[] = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^<>]*)>/g;
  let last = 0;
  const pushText = (raw: string) => {
    const t = decode(raw).trim();
    if (!t) return;
    if (tags.length) tags[tags.length - 1].after = t;
    visible.push(t);
    withScripts.push(t);
  };
  for (let m = re.exec(doc); m && tags.length < MAX_TAGS; m = re.exec(doc)) {
    pushText(doc.slice(last, m.index));
    const name = m[2].toLowerCase();
    const closing = m[1] === "/";
    tags.push({ name, closing, attrs: closing ? {} : parseAttrs(m[3]), after: "" });
    last = re.lastIndex;
    if (!closing && (name === "script" || name === "style")) {
      const end = lower.indexOf(`</${name}`, last);
      const bodyEnd = end < 0 ? doc.length : end;
      const body = doc.slice(last, bodyEnd);
      if (name === "script") {
        const type = (tags[tags.length - 1].attrs.type ?? "").toLowerCase();
        if (type.includes("ld+json")) {
          try {
            jsonLd.push(JSON.parse(body));
          } catch {
            // a broken JSON-LD block is common on scam pages and is not a reason to drop the page
          }
        } else if (body.trim()) {
          withScripts.push(body.slice(0, 20_000));
        }
      }
      last = bodyEnd;
      re.lastIndex = bodyEnd;
    }
  }
  pushText(doc.slice(last));
  return { tags, text: visible.join(" "), textWithScripts: withScripts.join(" "), jsonLd };
}

/** Index of the closing tag that matches the opening tag `i`, searching at most `SPAN_TAGS` tags ahead; `i` when none is found. */
function closeOf(tags: Tag[], i: number): number {
  const name = tags[i].name;
  let depth = 0;
  for (let j = i + 1; j < tags.length && j <= i + SPAN_TAGS; j++) {
    if (tags[j].name !== name) continue;
    if (!tags[j].closing) depth++;
    else if (depth-- === 0) return j;
  }
  return i;
}

/** Text of the element that opens at tag `i`, up to its closing tag. */
function innerText(tags: Tag[], i: number, end = closeOf(tags, i)): string {
  const parts: string[] = [];
  for (let j = i; j < end; j++) if (tags[j].after) parts.push(tags[j].after);
  return parts.join(" ").trim();
}

/** Words of the tag's class attribute, lower case, split on spaces, hyphens and underscores ("price-old" → "price", "old"). */
function classTokens(tag: Tag): string[] {
  return (tag.attrs.class ?? "").toLowerCase().split(/[\s_-]+/).filter(Boolean);
}

/** Pages are checked against folded phrases; true when any of them occurs as a substring. */
const hasPhrase = (folded: string, phrases: string[]): boolean => phrases.some((p) => folded.includes(p));

const regexCache = new Map<string, RegExp>();
/** Regular expression from a source, case-insensitive, cached (sources come from the configuration). */
function re(source: string, flags = "i"): RegExp {
  const key = `${flags}/${source}`;
  let r = regexCache.get(key);
  if (!r) {
    r = new RegExp(source, flags);
    regexCache.set(key, r);
  }
  return r;
}

/** Year of an ISO date, or null. */
function yearOf(iso: string | null | undefined): number | null {
  const m = /^(\d{4})-\d{2}/.exec(iso ?? "");
  return m ? Number(m[1]) : null;
}

// --- legal pages -------------------------------------------------------------------------------------

/** Which legal pages the menus and footers link to, by the link text or by a part of the path. */
function legalPagesOf(markup: Markup, cfg: ShopSignalsConfig): ShopSignals["legalPages"] {
  const found = { terms: false, returns: false, privacy: false, contact: false };
  const { tags } = markup;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    const href = tag.attrs.href;
    if (tag.closing || tag.name !== "a" || !href) continue;
    const text = fold(innerText(tags, i));
    let path = fold(href);
    try {
      path = fold(decodeURIComponent(new URL(href, "https://page.invalid/").pathname));
    } catch {
      // an undecodable path is compared as written
    }
    for (const kind of ["terms", "returns", "privacy", "contact"] as const) {
      if (found[kind]) continue;
      const rule = cfg.legalPages[kind];
      if (hasPhrase(text, rule.text) || hasPhrase(path, rule.path)) found[kind] = true;
    }
  }
  return found;
}

// --- prices and discounts ----------------------------------------------------------------------------

/**
 * Amount of money written as text ("1 299,00 zł", "€ 49.90", "$19"): the first number next to a currency
 * marker, or null.
 */
export function parsePrice(raw: string, cfg: ShopSignalsConfig = DEFAULT_SHOP_SIGNALS_CONFIG): number | null {
  const cur = cfg.currencies.map((c) => c.replace(/[$€£]/g, (x) => `\\${x}`)).join("|");
  const num = "(\\d{1,3}(?:[ .\\u00a0]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";
  const text = fold(raw);
  const m = re(`${num}\\s*(?:${cur})(?![a-z])`).exec(text) ?? re(`(?:^|[^a-z])(?:${cur})\\s*${num}`).exec(text);
  if (!m) return null;
  // the last separator is the decimal mark when one or two digits follow it, otherwise a thousands mark
  const n = m[1].replace(/\s/g, "");
  const sep = Math.max(n.lastIndexOf(","), n.lastIndexOf("."));
  const decimal = sep >= 0 && n.length - sep - 1 <= 2;
  const whole = (decimal ? n.slice(0, sep) : n).replace(/[.,]/g, "");
  const v = Number(decimal ? `${whole}.${n.slice(sep + 1)}` : whole);
  return Number.isFinite(v) && v > 0 ? v : null;
}

interface PricedItem {
  /** Discount against the struck-through price in percent; 0 for a product without one. */
  discountPct: number;
}

/** Pairs of an earlier and a current price in the markup (HTML elements), and single prices. */
function htmlPrices(markup: Markup, cfg: ShopSignalsConfig): PricedItem[] {
  const { tags } = markup;
  const oldTokens = new Set(cfg.oldPriceClassTokens);
  const priceTokens = new Set(cfg.priceClassTokens);
  interface Entry {
    old: boolean;
    value: number;
    end: number;
  }
  const entries: Entry[] = [];
  let skipUntil = -1;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    if (tag.closing || i <= skipUntil) continue;
    const tokens = classTokens(tag);
    const oldTag = tag.name === "del" || tag.name === "s" || tag.name === "strike";
    const oldClass = tokens.some((t) => oldTokens.has(t));
    const priceClass = tokens.some((t) => priceTokens.has(t)) || tag.attrs.itemprop === "price";
    if (!oldTag && !oldClass && !priceClass) continue;
    const end = closeOf(tags, i);
    // a wrapper around an old and a current price is not a price itself: its children are read instead
    let wraps = false;
    for (let j = i + 1; j < end; j++) {
      const c = tags[j];
      if (!c.closing && (c.name === "del" || c.name === "s" || c.name === "strike" || classTokens(c).some((t) => oldTokens.has(t)))) wraps = true;
    }
    if (wraps && !oldTag) continue;
    const content = tag.attrs.itemprop === "price" && tag.attrs.content ? `${tag.attrs.content} zł` : "";
    const value = parsePrice(content || innerText(tags, i, end), cfg);
    if (value === null) continue;
    entries.push({ old: oldTag || (oldClass && !priceClass) || (oldClass && priceClass && tokens.some((t) => oldTokens.has(t))), value, end });
    skipUntil = end;
  }
  const items: PricedItem[] = [];
  for (let k = 0; k < entries.length; k++) {
    const e = entries[k];
    const next = entries[k + 1];
    if (e.old && next && !next.old && next.value < e.value) {
      items.push({ discountPct: Math.round(((e.value - next.value) / e.value) * 100) });
      k++;
    } else {
      items.push({ discountPct: 0 });
    }
  }
  return items;
}

/** Offers of JSON-LD with a price: a list price (`priceSpecification`) or a `highPrice` above `price` is the earlier price. */
function jsonLdPrices(blocks: unknown[]): PricedItem[] {
  const items: PricedItem[] = [];
  const num = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  walk(blocks, (node) => {
    if (!isType(node, "Offer") && !isType(node, "AggregateOffer")) return;
    const price = num(node.price) ?? num(node.lowPrice);
    if (price === null) return;
    let earlier = num(node.highPrice);
    const specs = Array.isArray(node.priceSpecification) ? node.priceSpecification : node.priceSpecification ? [node.priceSpecification] : [];
    for (const s of specs) {
      if (s && typeof s === "object" && /list|strikethrough|msrp/i.test(String((s as Record<string, unknown>).priceType ?? ""))) earlier = num((s as Record<string, unknown>).price) ?? earlier;
    }
    items.push({ discountPct: earlier !== null && earlier > price ? Math.round(((earlier - price) / earlier) * 100) : 0 });
  });
  return items;
}

/** Visits every object of nested JSON-LD values, depth-limited. */
function walk(value: unknown, visit: (node: Record<string, unknown>) => void, depth = 0): void {
  if (depth > 8 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 500)) walk(v, visit, depth + 1);
    return;
  }
  const node = value as Record<string, unknown>;
  visit(node);
  for (const v of Object.values(node)) walk(v, visit, depth + 1);
}

/** The node's `@type` is `type` (alone or in a list), with or without a schema.org prefix. */
function isType(node: Record<string, unknown>, type: string): boolean {
  const t = node["@type"];
  const list = Array.isArray(t) ? t : [t];
  return list.some((x) => typeof x === "string" && x.replace(/^.*[/:]/, "").toLowerCase() === type.toLowerCase());
}

/** Discount figures of the priced products, and whether the discounts cover the whole shop (many products, most of them deeply cut). */
function discountsOf(items: PricedItem[], cfg: ShopSignalsConfig): { discounts: ShopSignals["discounts"]; sitewide: boolean } {
  const discounted = items.filter((i) => i.discountPct > 0).map((i) => i.discountPct).sort((a, b) => a - b);
  const median = discounted.length ? (discounted.length % 2 ? discounted[(discounted.length - 1) / 2] : Math.round((discounted[discounted.length / 2 - 1] + discounted[discounted.length / 2]) / 2)) : null;
  const deep = items.filter((i) => i.discountPct >= cfg.sitewide.minDiscountPct).length;
  return {
    discounts: {
      pricedItems: items.length,
      discountedShare: items.length ? discounted.length / items.length : 0,
      medianDiscountPct: median,
      maxDiscountPct: discounted.length ? discounted[discounted.length - 1] : null,
    },
    sitewide: items.length >= cfg.sitewide.minItems && deep / items.length >= cfg.sitewide.minShare,
  };
}

// --- urgency, payment, delivery ----------------------------------------------------------------------

/** Urgency and story techniques found in the folded text and in the class or id names of the markup. */
function techniquesOf(markup: Markup, cfg: ShopSignalsConfig): ShopTechniqueName[] {
  const folded = fold(markup.textWithScripts);
  const out: ShopTechniqueName[] = [];
  for (const [name, sources] of Object.entries(cfg.techniquePhrases) as Array<[ShopTechniqueName, string[]]>) {
    if (sources.some((s) => re(s).test(folded))) out.push(name);
  }
  const countdown = markup.tags.some((t) => !t.closing && [t.attrs.class, t.attrs.id].some((v) => v && cfg.countdownTokens.some((tok) => v.toLowerCase().includes(tok))));
  if (countdown && !out.includes("countdown_timer")) out.push("countdown_timer");
  return out;
}

/** Payment methods named in the text, in image names and alt texts, and in script addresses. */
function paymentMethodsOf(markup: Markup, cfg: ShopSignalsConfig): string[] {
  const parts = [markup.text];
  for (const t of markup.tags) {
    if (t.closing) continue;
    if (t.name === "img" || t.name === "source") parts.push(t.attrs.alt ?? "", t.attrs.title ?? "", t.attrs.src ?? "", t.attrs["data-src"] ?? "");
    else if (t.name === "script") parts.push(t.attrs.src ?? "");
    else if (t.attrs.class && /pay|platnos|payment/i.test(t.attrs.class)) parts.push(t.attrs.class);
  }
  const folded = fold(parts.join(" \n "));
  return Object.entries(cfg.paymentMethods)
    .filter(([, sources]) => sources.some((s) => re(s).test(folded)))
    .map(([id]) => id);
}

/** The text of the instruction to pay names a private person as the recipient, or the transfer title reads as a gift. */
function recipientPersonOf(text: string, legalEntities: string[], cfg: ShopSignalsConfig): { hit: boolean; quote: string | null } {
  const folded = foldKeepLength(text);
  const labels = cfg.recipientLabels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const legalForm = /^\s*(?:sp\.|s\.a\.|spolka|ltd|llc|gmbh|inc|s\.r\.o|b\.v|z o\.o)/i;
  for (const m of folded.matchAll(re(`(?:${labels})\\s*[:\\-]?\\s*`, "gi"))) {
    const start = (m.index ?? 0) + m[0].length;
    const name = /^(\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){1,2})/u.exec(text.slice(start, start + 80));
    if (!name) continue;
    const words = name[1].split(/\s+/);
    if (words.some((w) => cfg.firmWords.includes(fold(w)))) continue;
    if (legalForm.test(folded.slice(start + name[1].length, start + name[1].length + 20))) continue;
    if (legalEntities.some((e) => fold(e).includes(fold(name[1])))) continue;
    return { hit: true, quote: text.slice(Math.max(0, start - m[0].length), start + name[1].length).trim() };
  }
  const gift = re(`tytul\\w*(?:\\s+przelewu)?\\s*[:\\-]?\\s*["„']?(?:${cfg.giftTitleWords.join("|")})\\b`).exec(folded);
  return gift ? { hit: true, quote: text.slice(gift.index, gift.index + gift[0].length).trim() } : { hit: false, quote: null };
}

/** Lowest and highest declared delivery time in days, from phrases like "delivery: 3-45 days"; null when none. */
function deliveryOf(text: string, cfg: ShopSignalsConfig): { min: number; max: number } | null {
  const folded = fold(text);
  const labels = cfg.deliveryLabels.join("|");
  const units = [...new Set(cfg.deliveryUnits)].sort((a, b) => b.length - a.length).join("|");
  let min = Infinity;
  let max = 0;
  for (const m of folded.matchAll(re(`(?:${labels})[^.\\n]{0,50}?(\\d{1,3})\\s*(?:[-–—]|do|to|bis)\\s*(\\d{1,3})\\s*(?:${units})\\b`, "gi"))) {
    const [a, b] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y);
    min = Math.min(min, a);
    max = Math.max(max, b);
  }
  if (!Number.isFinite(min)) {
    for (const m of folded.matchAll(re(`(?:${labels})[^.\\n]{0,50}?(\\d{1,3})\\s*(?:${units})\\b`, "gi"))) {
      min = Math.min(min, Number(m[1]));
      max = Math.max(max, Number(m[1]));
    }
  }
  return Number.isFinite(min) && max > 0 && max <= 365 ? { min, max } : null;
}

// --- reviews -----------------------------------------------------------------------------------------

interface ReviewNode {
  rating: number | null;
  date: number | null;
  author: string | null;
}

/** Rating on a five-point scale, from a value and an optional best value. */
function toFive(value: unknown, best: unknown): number | null {
  const v = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  const b = typeof best === "number" ? best : Number(String(best ?? "").replace(",", "."));
  if (!Number.isFinite(v) || v <= 0) return null;
  return Number.isFinite(b) && b > 0 && b !== 5 ? (v / b) * 5 : v;
}

/** Opinions of JSON-LD (`Review`, `AggregateRating`). */
function jsonLdReviews(blocks: unknown[]): { nodes: ReviewNode[]; declared: number | null; average: number | null } {
  const nodes: ReviewNode[] = [];
  let declared: number | null = null;
  let average: number | null = null;
  walk(blocks, (node) => {
    if (isType(node, "Review")) {
      const r = node.reviewRating && typeof node.reviewRating === "object" ? (node.reviewRating as Record<string, unknown>) : {};
      const a = node.author;
      const author = typeof a === "string" ? a : a && typeof a === "object" ? String((a as Record<string, unknown>).name ?? "") : "";
      const date = typeof node.datePublished === "string" ? Date.parse(node.datePublished) : NaN;
      nodes.push({ rating: toFive(r.ratingValue, r.bestRating), date: Number.isFinite(date) ? date : null, author: author.trim() || null });
    } else if (isType(node, "AggregateRating")) {
      const n = Number(node.reviewCount ?? node.ratingCount);
      if (Number.isFinite(n) && n > 0) declared = Math.max(declared ?? 0, n);
      average ??= toFive(node.ratingValue, node.bestRating);
    }
  });
  return { nodes, declared, average };
}

/** Opinions written as markup: elements with an `itemprop="review"` or a review class, with a rating, a date and an author inside. */
function htmlReviews(markup: Markup, cfg: ShopSignalsConfig): { nodes: ReviewNode[]; declared: number | null; average: number | null; replies: number } {
  const { tags } = markup;
  const nodes: ReviewNode[] = [];
  let replies = 0;
  let skipUntil = -1;
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    if (tag.closing || i <= skipUntil) continue;
    const tokens = classTokens(tag);
    const isReview = tag.attrs.itemprop === "review" || tokens.includes("review") || tokens.includes("opinia") || tokens.includes("opinion") || tokens.includes("testimonial");
    if (!isReview) continue;
    const end = closeOf(tags, i);
    if (end === i) continue;
    let rating: number | null = null;
    let date: number | null = null;
    let author: string | null = null;
    for (let j = i; j < end; j++) {
      const t = tags[j];
      if (t.closing) continue;
      const a = t.attrs;
      const raw = a["data-rating"] ?? a["data-score"] ?? a["data-stars"] ?? (a.itemprop === "ratingvalue" || a.itemprop === "ratingValue" ? a.content ?? t.after : undefined);
      if (rating === null && raw !== undefined) rating = toFive(raw, a["data-best"]);
      if (rating === null) {
        const label = `${a["aria-label"] ?? ""} ${a.title ?? ""} ${t.attrs.class ?? ""}`;
        const m = /(?:\b|[-_])([1-5])(?:[.,]\d)?\s*(?:\/\s*5|stars?|gwiazd|sterne)/i.exec(label) ?? /(?:star|rating|rated)[-_]([1-5])\b/i.exec(label);
        if (m) rating = Number(m[1]);
      }
      const when = a.datetime ?? (a.itemprop === "datePublished" ? a.content : undefined);
      if (date === null && when && Number.isFinite(Date.parse(when))) date = Date.parse(when);
      if (author === null && (a.itemprop === "author" || classTokens(t).includes("author"))) author = (a.content ?? t.after ?? "").trim() || null;
    }
    nodes.push({ rating, date, author });
    if (tags.slice(i + 1, end).some((t) => !t.closing && classTokens(t).some((x) => cfg.sellerReplyTokens.includes(x)))) replies++;
    skipUntil = end;
  }
  let declared: number | null = null;
  let average: number | null = null;
  for (const t of tags) {
    if (t.closing) continue;
    const prop = t.attrs.itemprop;
    if (prop === "reviewCount" || prop === "ratingCount") {
      const n = Number(t.attrs.content ?? t.after);
      if (Number.isFinite(n) && n > 0) declared = n;
    } else if (prop === "ratingValue") average ??= toFive(t.attrs.content ?? t.after, null);
  }
  return { nodes, declared, average, replies };
}

/** Summary of the opinions on a page, or null when it shows none. */
function reviewsOf(markup: Markup, cfg: ShopSignalsConfig): ShopReviews | null {
  const ld = jsonLdReviews(markup.jsonLd);
  const source: ShopReviews["source"] = ld.nodes.length || ld.declared ? "jsonld" : "html";
  const found = source === "jsonld" ? { ...ld, replies: null } : htmlReviews(markup, cfg);
  const count = Math.max(found.declared ?? 0, found.nodes.length);
  if (!count) return null;
  const rated = found.nodes.filter((n) => n.rating !== null);
  const dist: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const n of rated) dist[String(Math.min(5, Math.max(1, Math.round(n.rating as number))))]++;
  const dates = found.nodes.map((n) => n.date).filter((d): d is number => d !== null);
  const authored = found.nodes.filter((n) => n.author !== null);
  const anon = (a: string) => cfg.anonymousAuthors.includes(fold(a).replace(/[^a-z ]/g, "").trim());
  const withAuthorField = found.nodes.length;
  return {
    count,
    ratingDistribution: rated.length ? dist : null,
    share5: rated.length ? dist["5"] / rated.length : null,
    windowDays: dates.length >= 2 ? Math.ceil((Math.max(...dates) - Math.min(...dates)) / DAY_MS) : null,
    anonymousShare: withAuthorField ? (found.nodes.length - authored.length + authored.filter((n) => anon(n.author as string)).length) / withAuthorField : null,
    source,
    sellerReplies: found.replies,
  };
}

// --- catalogue ---------------------------------------------------------------------------------------

/** Names of products: the first heading inside a product block, and the names of JSON-LD products. */
function productNamesOf(markup: Markup): string[] {
  const { tags } = markup;
  const names: string[] = [];
  let skipUntil = -1;
  for (let i = 0; i < tags.length && names.length < 300; i++) {
    const tag = tags[i];
    if (tag.closing || i <= skipUntil || !classTokens(tag).includes("product")) continue;
    const end = closeOf(tags, i);
    const h = tags.findIndex((t, j) => j > i && j < end && !t.closing && /^h[1-4]$/.test(t.name));
    const name = h > 0 ? innerText(tags, h).trim() : "";
    if (name) names.push(name);
    skipUntil = end;
  }
  walk(markup.jsonLd, (n) => {
    if (isType(n, "Product") && typeof n.name === "string" && n.name.trim() && names.length < 300) names.push(n.name.trim());
  });
  return names;
}

/** Categories whose stems occur in `text` (folded), in the order of the configuration. */
function categoriesOf(text: string, cfg: ShopSignalsConfig): string[] {
  const folded = ` ${fold(text)} `;
  return Object.entries(cfg.catalog.categories).filter(([, stems]) => stems.some((s) => folded.includes(s))).map(([name]) => name);
}

/**
 * Categories of the products when the catalogue is incoherent: at least `minCategories` unrelated categories among
 * at most `maxProducts` products, or products only from categories other than the one the shop's own name points to.
 * Empty when the catalogue is coherent or too small to judge.
 */
function incoherentCatalog(names: string[], ownNames: string[], cfg: ShopSignalsConfig): string[] {
  const c = cfg.catalog;
  if (names.length < c.minProducts || names.length > c.maxProducts) return [];
  const found = [...new Set(names.flatMap((n) => categoriesOf(n, cfg)))];
  if (found.length >= c.minCategories) return found;
  const own = categoriesOf(ownNames.join(" "), cfg);
  return own.length && found.length && !found.some((f) => own.includes(f)) ? [...own, ...found] : [];
}

// --- footer, seniority -------------------------------------------------------------------------------

const LEGAL_FORM_TAIL = /\s+(?:sp\.?\s*z\s*o\.?\s*o\.?|sp\.?\s*k\.?|s\.?\s*a\.?|ltd\.?|limited|llc|gmbh|inc\.?|s\.?\s*r\.?\s*o\.?|b\.?\s*v\.?)(?:\s.*)?$/i;
const FOOTER_STOP = new Set(["all", "wszelkie", "wszystkie", "alle", "prawa", "rights", "powered", "by", "made", "created", "designed", "realizacja", "wykonanie", "shopify", "woocommerce"]);

/** Name and last year of the copyright line in the footer text; the name is without a legal form. */
function copyrightOf(footerText: string): { name: string | null; year: number | null } {
  const m = /(?:©|\(c\)|copyright)\s*((?:19|20)\d\d)?(?:\s*[-–]\s*((?:19|20)\d\d))?[\s,.:|-]*((?:\p{Lu}|\d)[\p{L}0-9&'’.-]*(?:\s+(?:\p{Lu}|\d)[\p{L}0-9&'’.-]*){0,5})?/iu.exec(footerText);
  if (!m) return { name: null, year: null };
  const year = Number(m[2] ?? m[1]) || null;
  const words: string[] = [];
  for (const w of (m[3] ?? "").split(/\s+/).filter(Boolean)) {
    if (FOOTER_STOP.has(fold(w).replace(/[^a-z]/g, ""))) break;
    words.push(w.replace(/[.,]+$/, ""));
  }
  const name = words.join(" ").replace(LEGAL_FORM_TAIL, "").trim();
  return { name: name.length >= 2 ? name : null, year };
}

/** Core of a registrable domain: its first label ("nowymarket.test" → "nowymarket"). */
function domainCore(url: string | null | undefined): string | null {
  if (!url) return null;
  let host = url;
  try {
    host = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return null;
  }
  const reg = registrableDomain(host) ?? host.replace(/^www\./, "");
  return fold(reg.split(".")[0]) || null;
}

/** Letters and digits only, folded: the form in which two names are compared. */
const alnum = (s: string): string => fold(s).replace(/[^a-z0-9]/g, "");

/** Name of the shop from `og:site_name` and the title (the part before a separator). */
function pageBrandNames(tags: Tag[]): string[] {
  const names: string[] = [];
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t.closing) continue;
    if (t.name === "meta" && t.attrs.property === "og:site_name" && t.attrs.content) names.push(t.attrs.content);
    if (t.name === "title" && t.after) names.push(t.after.split(/\s[|–—-]\s|\s·\s/)[0]);
  }
  return names;
}

/** True when the footer name and the page's own names (title, site name, domain core) share a name or a word of four letters. */
function namesAgree(footer: string, own: string[]): boolean {
  const f = alnum(footer);
  const fTokens = fold(footer).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  return own.some((o) => {
    const a = alnum(o);
    if (a.length >= 3 && f.length >= 3 && (a.includes(f) || f.includes(a))) return true;
    const tokens = fold(o).split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    return tokens.some((tk) => fTokens.includes(tk) || f.includes(tk));
  });
}

/** Claimed founding year or years on the market, from folded text; the quote is the matched phrase. */
function claimedOf(folded: string, cfg: ShopSignalsConfig): ShopSignals["claimedSince"] {
  for (const src of cfg.claimedSince.year) {
    const m = re(src).exec(folded);
    if (m) {
      const year = Number(m[1]);
      if (year >= 1800 && year <= 2100) return { year, quote: m[0].trim() };
    }
  }
  for (const src of cfg.claimedSince.years) {
    const m = re(src).exec(folded);
    if (m && Number(m[1]) >= 2) return { year: null, years: Number(m[1]), quote: m[0].trim() };
  }
  return null;
}

// --- assembling --------------------------------------------------------------------------------------

/**
 * Adds what depends on dates outside the markup to signals read from it: the stale footer year, the
 * years-on-the-market claim turned into a year, and the claim contradicted by the archive. Called with the
 * date of the first sighting (and of the archive's first snapshot, when known); returns new signals with
 * `flags` and `details` brought up to date.
 */
export function applyShopContext(signals: ShopSignals, ctx: ShopContext, cfg: ShopSignalsConfig = DEFAULT_SHOP_SIGNALS_CONFIG): ShopSignals {
  const ref = yearOf(ctx.firstSeen);
  const archive = yearOf(ctx.archiveFirstSeen);
  const claimedSince = signals.claimedSince && signals.claimedSince.year === null && signals.claimedSince.years && ref ? { ...signals.claimedSince, year: ref - signals.claimedSince.years } : signals.claimedSince;
  const footerYearStale = !!(signals.footerYear && ref && ref - signals.footerYear >= cfg.footerStaleYears);
  const claimedSinceContradicted = !!(claimedSince?.year && archive && archive - claimedSince.year >= cfg.claimedSinceGapYears);
  const next: ShopSignals = { ...signals, claimedSince, footerYearStale, claimedSinceContradicted };
  const { flags, details } = flagsOf(next, ctx);
  return { ...next, flags, details };
}

const FLAG_ORDER: ShopFlag[] = [
  "legalPagesMissing",
  "sitewideDeepDiscount",
  "omnibusMissing",
  "transferOnly",
  "irreversibleOnly",
  "paymentRecipientPerson",
  "deliveryWide",
  "reviewsAllPerfect",
  "reviewsNarrowWindow",
  "reviewsNone",
  "footerBrandMismatch",
  "footerYearStale",
  "claimedSinceContradicted",
  "reviewsNoSellerReply",
  "catalogIncoherent",
];

const LEGAL_PAGE_NAMES: Record<string, string> = { terms: "terms", returns: "returns", privacy: "privacy policy", contact: "contact" };

/** English names of the catalog categories of `shopSignalsConfig` (its keys stay as written in the config). */
const CATEGORY_NAMES: Record<string, string> = {
  elektronika: "electronics",
  zabawki: "toys",
  "odzież": "clothing",
  "narzędzia": "tools",
  kosmetyki: "cosmetics",
  "robótki": "crafts",
  "ogród": "garden",
  meble: "furniture",
  sport: "sport",
  "zwierzęta": "pets",
};

/** Flags that hold, in a fixed order, with one sentence of evidence per flag. */
function flagsOf(s: ShopSignals, ctx: ShopContext): { flags: ShopFlag[]; details: Partial<Record<ShopFlag, string>> } {
  const details: Partial<Record<ShopFlag, string>> = {};
  const holds: Record<ShopFlag, boolean> = {
    legalPagesMissing: s.legalPagesMissing.length > 0,
    sitewideDeepDiscount: s.sitewideDeepDiscount,
    omnibusMissing: s.omnibusMissing,
    transferOnly: s.transferOnly,
    irreversibleOnly: s.irreversibleOnly,
    paymentRecipientPerson: s.paymentRecipientPerson,
    deliveryWide: s.deliveryWide,
    reviewsAllPerfect: s.reviewsAllPerfect,
    reviewsNarrowWindow: s.reviewsNarrowWindow,
    reviewsNone: s.reviewsNone,
    footerBrandMismatch: s.footerBrandMismatch !== null,
    footerYearStale: s.footerYearStale,
    claimedSinceContradicted: s.claimedSinceContradicted,
    reviewsNoSellerReply: s.reviewsNoSellerReply,
    catalogIncoherent: s.catalogIncoherent,
  };
  details.legalPagesMissing = `no links to: ${s.legalPagesMissing.map((k) => LEGAL_PAGE_NAMES[k] ?? k).join(", ")}`;
  details.sitewideDeepDiscount = `${s.discounts.pricedItems} products with prices, discount up to ${s.discounts.maxDiscountPct ?? 0}% (median ${s.discounts.medianDiscountPct ?? 0}%)`;
  details.omnibusMissing = "discounts without a mention of the lowest price of the last 30 days";
  details.transferOnly = "bank transfer is the only payment method";
  details.irreversibleOnly = `methods that are hard to reverse: ${s.paymentMethods.join(", ")}`;
  details.paymentRecipientPerson = "the payment recipient looks like a private person or the transfer title is “prezent” (gift) / “darowizna” (donation)";
  details.deliveryWide = s.deliveryDays ? `delivery time ${s.deliveryDays.min}–${s.deliveryDays.max} days` : "";
  details.reviewsAllPerfect = s.reviews ? `${s.reviews.count} reviews, ${Math.round((s.reviews.share5 ?? 1) * 100)}% are 5/5, no 1–2 ratings` : "";
  details.reviewsNarrowWindow = s.reviews ? `${s.reviews.count} reviews within ${s.reviews.windowDays ?? 0} days` : "";
  details.reviewsNone = "a shop with products and not a single review";
  details.footerBrandMismatch = s.footerBrandMismatch ? `footer: “${s.footerBrandMismatch.footer}”, page: “${s.footerBrandMismatch.brand}”` : "";
  details.footerYearStale = `footer year ${s.footerYear}, first recorded ${yearOf(ctx.firstSeen)}`;
  details.claimedSinceContradicted = s.claimedSince ? `claimed track record “${s.claimedSince.quote}” (since ${s.claimedSince.year}), first archive snapshot ${yearOf(ctx.archiveFirstSeen)}` : "";
  details.reviewsNoSellerReply = s.reviews ? `${s.reviews.count} reviews and not a single seller reply` : "";
  details.catalogIncoherent = `products from the categories: ${s.catalogCategories.map((c) => CATEGORY_NAMES[c] ?? c).join(", ")}`;
  const flags = FLAG_ORDER.filter((f) => holds[f]);
  return { flags, details: Object.fromEntries(flags.map((f) => [f, details[f]])) as Partial<Record<ShopFlag, string>> };
}

/**
 * Signals of a fake shop read from the markup of one page, or null when the page is not a shop (no price
 * together with a cart word, no Product or Offer in its JSON-LD). Dates in `page` (first sighting, first
 * snapshot of the archive) add the footer-year and seniority checks; without them those stay off.
 */
export function extractShopSignals(page: ShopPageInput, cfg: ShopSignalsConfig = DEFAULT_SHOP_SIGNALS_CONFIG): ShopSignals | null {
  if (!page.html) return null;
  const markup = scanMarkup(page.html);
  const folded = fold(markup.text);
  const ldProduct = (() => {
    let hit = false;
    walk(markup.jsonLd, (n) => {
      if (isType(n, "Product") || isType(n, "Offer") || isType(n, "AggregateOffer")) hit = true;
    });
    return hit;
  })();
  const cart = hasPhrase(fold(markup.textWithScripts), cfg.cartWords) || markup.tags.some((t) => !t.closing && hasPhrase(fold(`${t.attrs.class ?? ""} ${t.attrs.id ?? ""} ${t.attrs.value ?? ""}`), ["add-to-cart", "addtocart", "add_to_cart", "cart"]));
  const hasPrice = parsePrice(markup.text, cfg) !== null;
  if (!ldProduct && !(cart && hasPrice)) return null;

  const htmlItems = htmlPrices(markup, cfg);
  const items = htmlItems.length ? htmlItems : jsonLdPrices(markup.jsonLd);
  const { discounts, sitewide } = discountsOf(items, cfg);
  const omnibusMissing = discounts.discountedShare > 0 && !cfg.omnibusPhrases.some((s) => re(s).test(folded));

  const paymentMethods = paymentMethodsOf(markup, cfg);
  const transferOnly = paymentMethods.length === 1 && paymentMethods[0] === "transfer";
  const irreversibleOnly = paymentMethods.length > 0 && paymentMethods.every((m) => cfg.irreversibleMethods.includes(m));
  const recipient = recipientPersonOf(markup.text, page.legalEntities ?? [], cfg);
  const deliveryDays = deliveryOf(markup.text, cfg);
  const deliveryWide = !!deliveryDays && (deliveryDays.max >= cfg.deliveryWide.maxDays || (deliveryDays.min > 0 && deliveryDays.max / deliveryDays.min >= cfg.deliveryWide.ratio));

  const reviews = reviewsOf(markup, cfg);
  const r = cfg.reviews;
  const dist = reviews?.ratingDistribution;
  const reviewsAllPerfect = !!reviews && reviews.count >= r.minCount && (dist ? (reviews.share5 ?? 0) >= r.perfectShare && dist["1"] + dist["2"] === 0 : false);
  const reviewsNarrowWindow = !!reviews && reviews.count >= r.minCount && reviews.windowDays !== null && reviews.windowDays <= r.narrowWindowDays;
  const reviewsNone = items.length > 0 && !reviews && !hasPhrase(folded, cfg.reviewWords);

  const footerTag = markup.tags.findIndex((t) => !t.closing && t.name === "footer");
  const footerText = footerTag >= 0 ? innerText(markup.tags, footerTag, closeOfOrEnd(markup.tags, footerTag)) : markup.text.slice(-800);
  const copyright = copyrightOf(footerText || markup.text.slice(-800));
  const core = domainCore(page.url);
  const own = [...pageBrandNames(markup.tags), ...(core ? [core] : [])];
  const footerBrandMismatch = copyright.name && core && own.length && !namesAgree(copyright.name, own) ? { footer: copyright.name, brand: core } : null;

  const catalogCategories = incoherentCatalog(productNamesOf(markup), own, cfg);
  const reviewsNoSellerReply = !!reviews && reviews.source === "html" && reviews.count >= cfg.noReplyMinCount && reviews.sellerReplies === 0;

  const base: ShopSignals = {
    legalPages: legalPagesOf(markup, cfg),
    legalPagesMissing: [],
    discounts,
    sitewideDeepDiscount: sitewide,
    omnibusMissing,
    techniques: techniquesOf(markup, cfg),
    paymentMethods,
    transferOnly,
    irreversibleOnly,
    paymentRecipientPerson: recipient.hit,
    deliveryDays,
    deliveryWide,
    reviews,
    reviewsAllPerfect,
    reviewsNarrowWindow,
    reviewsNone,
    footerBrand: copyright.name,
    footerBrandMismatch,
    footerYear: copyright.year,
    footerYearStale: false,
    claimedSince: claimedOf(folded, cfg),
    claimedSinceContradicted: false,
    catalogCategories,
    catalogIncoherent: catalogCategories.length > 0,
    reviewsNoSellerReply,
    flags: [],
    details: {},
  };
  base.legalPagesMissing = (Object.keys(base.legalPages) as Array<keyof ShopSignals["legalPages"]>).filter((k) => !base.legalPages[k]);
  return applyShopContext(base, { firstSeen: page.firstSeen, archiveFirstSeen: page.archiveFirstSeen }, cfg);
}

/** Index of the closing tag of element `i`, or the last tag when the element is not closed within the search span. */
function closeOfOrEnd(tags: Tag[], i: number): number {
  const c = closeOf(tags, i);
  return c === i ? Math.min(tags.length, i + SPAN_TAGS) : c;
}
