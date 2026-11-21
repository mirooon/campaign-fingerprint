/**
 * Techniques of a scam landing page read from its HTML: a block of fake comments written into the
 * page, a trap on the browser's back button, a fake app store and fake posts of social networks.
 *
 * None of them is a risk score. The comment block is a trace of the page template (the same block on
 * several domains links the pages, like other template traces). The technique names describe the
 * modus operandi and only feed the second level (groups of similar campaigns).
 *
 * Real widgets are recognised and left out: Facebook comments come from the comments plugin
 * (facebook.com/plugins/comments.php or an fb-comments element with the SDK), embedded posts carry
 * the platform's script and a status link. A copy written as static HTML has neither. Pure functions.
 */
import { createHash } from "node:crypto";

export type PageTechnique = "fake_app_store" | "back_trap" | "fake_social_post" | "fake_comments";

export interface CommentBlock {
  /** 16 hex chars: SHA-256 of the sorted set of normalised author names. */
  key: string;
  /** Comments with an author in the block. */
  count: number;
  /** Normalised author names, in page order, unique (max 30). */
  authors: string[];
  /** First words of the first comments (max 5, 80 chars each), for the viewer. */
  samples: string[];
}

export interface PageTechniques {
  techniques: PageTechnique[];
  commentBlock: CommentBlock | null;
}

/** Fewer distinct authors than this is not a block (a single quote, a testimonial). */
export const MIN_COMMENT_AUTHORS = 3;
/** Pages are read up to this many characters and this many tags (linear scan, no backtracking). */
const MAX_CHARS = 3_000_000;
const MAX_TAGS = 200_000;
/** Tags read after a comment item's start when looking for its author and text. */
const ITEM_SPAN_TAGS = 120;

const ITEM_CLASS = /^(?:fb[-_]?)?(?:comment|reply|komentarz|odpowiedz)(?:[-_]?(?:item|box|card|row|wrap|wrapper|block|entry|container|single))?$/i;
const AUTHOR_CLASS = /(?:^|[-_])(?:author|name|user(?:name)?|nick|commenter)(?:$|[-_])/i;
const TEXT_CLASS = /(?:^|[-_])(?:text|body|content|message|msg|txt)(?:$|[-_])/i;

interface Tag {
  /** Lower-case name; "/name" for a closing tag. */
  name: string;
  attrs: string;
  start: number;
  end: number;
}

/**
 * Tags of a document in one pass: "<" followed by a name up to the next ">" that comes before the
 * next "<". Positions of ">" are collected first, so a document without them stays linear.
 */
function scanTags(html: string): Tag[] {
  const gts: number[] = [];
  for (let i = html.indexOf(">"); i >= 0; i = html.indexOf(">", i + 1)) gts.push(i);
  const tags: Tag[] = [];
  let g = 0;
  for (let lt = html.indexOf("<"); lt >= 0 && tags.length < MAX_TAGS; ) {
    const next = html.indexOf("<", lt + 1);
    while (g < gts.length && gts[g] < lt) g++;
    const gt = g < gts.length ? gts[g] : -1;
    if (gt >= 0 && (next < 0 || gt < next)) {
      const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(lt, Math.min(gt + 1, lt + 64)));
      if (m) tags.push({ name: `${m[1]}${m[2].toLowerCase()}`, attrs: html.slice(lt + m[0].length, gt), start: lt, end: gt + 1 });
    }
    lt = next;
  }
  return tags;
}

const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");

/** Visible text between tags i0 and i1 (script and style content left out). */
function textBetween(html: string, tags: Tag[], i0: number, i1: number): string {
  const parts: string[] = [];
  let skip: string | null = null;
  for (let i = i0; i < i1 && i < tags.length; i++) {
    const t = tags[i];
    if (skip) {
      if (t.name === `/${skip}`) skip = null;
      continue;
    }
    if (t.name === "script" || t.name === "style") {
      skip = t.name;
      continue;
    }
    const nextStart = i + 1 < tags.length ? tags[i + 1].start : html.length;
    if (i + 1 <= i1) parts.push(html.slice(t.end, nextStart));
  }
  return decode(parts.join(" ")).replace(/\s+/g, " ").trim();
}

function classTokens(attrs: string): string[] {
  const m = /\bclass\s*=\s*(?:"([^"]{0,500})"|'([^']{0,500})'|([^\s>]{1,200}))/i.exec(attrs);
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").split(/\s+/).filter(Boolean);
}

/** Text of the first element between tags i0 and i1 whose class has a token matching `re`. */
function firstText(html: string, tags: Tag[], i0: number, i1: number, re: RegExp): string | null {
  for (let i = i0; i < i1 && i < tags.length; i++) {
    const t = tags[i];
    if (t.name.startsWith("/") || !classTokens(t.attrs).some((c) => re.test(c))) continue;
    let close = i + 1;
    while (close < Math.min(tags.length, i + 60) && tags[close].name !== `/${t.name}`) close++;
    const inner = textBetween(html, tags, i, close);
    if (inner) return inner;
  }
  return null;
}

/** Author name without the town after a dot or a bullet, lower-case, single spaces. */
export function normaliseAuthor(raw: string): string | null {
  const name = raw.normalize("NFKC").split(/\s[·•|–—-]\s|·|•/)[0].replace(/[\s.,:;!?"'()]+$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (name.length < 3 || name.length > 60 || !/\p{L}{2}/u.test(name) || name.split(" ").length > 6 || /\d{3}/.test(name)) return null;
  return name;
}

function realCommentsPlugin(html: string, tags: Tag[]): boolean {
  if (html.includes("facebook.com/plugins/comments.php")) return true;
  const sdk = tags.some((t) => t.name === "script" && /connect\.facebook\.net\/[^"'\s]{0,40}\/sdk\.js/i.test(t.attrs));
  return sdk && tags.some((t) => classTokens(t.attrs).includes("fb-comments") && /\bdata-href\s*=/i.test(t.attrs));
}

function blockFrom(html: string, tags: Tag[]): CommentBlock | null {
  if (realCommentsPlugin(html, tags)) return null;
  const starts: number[] = [];
  for (let i = 0; i < tags.length; i++) if (!tags[i].name.startsWith("/") && classTokens(tags[i].attrs).some((c) => ITEM_CLASS.test(c))) starts.push(i);
  const authors: string[] = [];
  const samples: string[] = [];
  let count = 0;
  for (let k = 0; k < starts.length; k++) {
    const i1 = Math.min(starts[k + 1] ?? tags.length, starts[k] + ITEM_SPAN_TAGS);
    // the author's element sits in the item's head: an item that only wraps nested items has none of its own
    const author = firstText(html, tags, starts[k], i1, AUTHOR_CLASS);
    const name = author ? normaliseAuthor(author) : null;
    if (!name) continue;
    count++;
    if (!authors.includes(name)) authors.push(name);
    const text = firstText(html, tags, starts[k], i1, TEXT_CLASS);
    if (text && samples.length < 5 && !text.toLowerCase().startsWith(name)) samples.push(text.slice(0, 80));
  }
  if (authors.length < MIN_COMMENT_AUTHORS) return null;
  const key = createHash("sha256").update([...authors].sort().join("\n")).digest("hex").slice(0, 16);
  return { key, count, authors: authors.slice(0, 30), samples };
}

/** Block of comments written into the page, or null (also when the page uses the real comments plugin). */
export function commentBlock(html: string): CommentBlock | null {
  if (!html) return null;
  const doc = html.slice(0, MAX_CHARS);
  return blockFrom(doc, scanTags(doc));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const STORE_HOSTS = /(?:^|\.)(?:apple\.com|google\.com)$/;
const STORE_CLASS = /(?:ios|app|apk)[-_]?(?:get|install|download)[-_]?(?:button|btn)|app[-_]?store|appstore|play[-_]?store|google[-_]?play|gplay/i;
const STORE_TEXT = [/wybór redakcji|editors[’']? choice/i, /zakupy w aplikacji|in-app purchases/i, /(?:zainstaluj|instaluj|install)\b/i, /\d[.,]\d\s{0,3}(?:★|z 5|out of 5)|ocen(?:y|a) i recenzje|ratings? (?:and|&) reviews/i];

function titleOf(html: string, tags: Tag[]): string {
  const i = tags.findIndex((t) => t.name === "title");
  return i < 0 ? "" : html.slice(tags[i].end, i + 1 < tags.length ? tags[i + 1].start : tags[i].end + 300).trim();
}

function storeFrom(html: string, tags: Tag[], pageUrl: string): boolean {
  if (STORE_HOSTS.test(hostOf(pageUrl))) return false;
  const classHit = tags.some((t) => !t.name.startsWith("/") && (classTokens(t.attrs).some((c) => STORE_CLASS.test(c)) || STORE_CLASS.test(/\bid\s*=\s*["']?([^"'\s>]{1,100})/i.exec(t.attrs)?.[1] ?? "")));
  const text = textBetween(html, tags, 0, Math.min(tags.length, 5000)).slice(0, 20000);
  const textHits = STORE_TEXT.filter((re) => re.test(text)).length;
  if (/app\s*store|google\s*play/i.test(titleOf(html, tags))) return classHit || textHits >= 1;
  return classHit && textHits >= 2;
}

export function fakeAppStore(html: string, pageUrl: string): boolean {
  const doc = (html ?? "").slice(0, MAX_CHARS);
  return storeFrom(doc, scanTags(doc), pageUrl);
}

function backTrapFrom(html: string, tags: Tag[]): boolean {
  const pushes = html.split("history.pushState").length - 1;
  const loop = /for\s{0,3}\([^)]{0,200}\)\s{0,3}\{?[^}]{0,200}history\.pushState/.test(html);
  const pop = html.includes("onpopstate") || /["']popstate["']/.test(html);
  const script = tags.some((t) => t.name === "script" && /\bsrc\s*=\s*["']?[^"'\s>]{0,200}back[-_]?(?:nav|button|redirect|trap|handler)[^"'\s>]{0,100}\.js/i.test(t.attrs));
  return (pop && (pushes >= 2 || loop)) || script;
}

export function backTrap(html: string): boolean {
  const doc = (html ?? "").slice(0, MAX_CHARS);
  return backTrapFrom(doc, scanTags(doc));
}

const SOCIAL_CLASS = /^(?:x|tw|twitter|tweet|fb|facebook|ig|insta|instagram|social)[-_]?(?:post|tweet|embed|card|status)$|^tweet$/i;
const SOCIAL_NOTE = /<!--\s{0,5}(?:x|twitter|tweet|fb|facebook|ig|insta|instagram)[-_ ]?post/i;
const REAL_EMBED = /platform\.twitter\.com\/widgets\.js|instagram\.com\/embed\.js|facebook\.com\/plugins\/post\.php/i;

function socialFrom(html: string, tags: Tag[]): boolean {
  const classes = (t: Tag) => (t.name.startsWith("/") ? [] : classTokens(t.attrs));
  if (REAL_EMBED.test(html) || tags.some((t) => classes(t).some((c) => c === "twitter-tweet" || c === "instagram-media"))) return false;
  return tags.some((t) => classes(t).some((c) => SOCIAL_CLASS.test(c))) || SOCIAL_NOTE.test(html);
}

export function fakeSocialPost(html: string): boolean {
  const doc = (html ?? "").slice(0, MAX_CHARS);
  return socialFrom(doc, scanTags(doc));
}

export function detectPageTechniques(html: string, pageUrl: string): PageTechniques {
  if (!html) return { techniques: [], commentBlock: null };
  const doc = html.slice(0, MAX_CHARS);
  const tags = scanTags(doc);
  const block = blockFrom(doc, tags);
  const techniques: PageTechnique[] = [];
  if (storeFrom(doc, tags, pageUrl)) techniques.push("fake_app_store");
  if (backTrapFrom(doc, tags)) techniques.push("back_trap");
  if (socialFrom(doc, tags)) techniques.push("fake_social_post");
  if (block) techniques.push("fake_comments");
  return { techniques, commentBlock: block };
}
