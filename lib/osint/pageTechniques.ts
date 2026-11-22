/**
 * Techniques of a scam landing page read from its HTML: a block of fake comments written into the
 * page, a trap on the browser's back button, a fake app store, fake posts of social networks and the
 * tools of a "technical support" funnel (a fake security alert that demands a phone call, a download of a
 * remote-desktop tool, a fake CAPTCHA that makes the visitor paste a command).
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
import { TECHNIQUE_CONFIG } from "./techniqueConfig";
import { registrableDomain } from "./urls";

export type PageTechnique =
  | "fake_app_store"
  | "back_trap"
  | "fake_social_post"
  | "fake_comments"
  | "fake_security_alert"
  | "remote_access_tool"
  | "clickfix_paste";

/**
 * The command a fake verification copies to the clipboard (ClickFix). Only its kind and SHA-256 are kept:
 * the command is the malware payload and is never stored, shown or packed.
 */
export interface ClickfixCommand {
  /** Kind of the command: powershell, mshta, cmd, curl_pipe_shell, bash, osascript, script_host. */
  kind: string;
  /** SHA-256 (64 hex chars) of the command with whitespace collapsed. */
  sha256: string;
}

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
  /** Kind and hash of the command a fake verification copies, when the page's script gives one. */
  clickfix: ClickfixCommand | null;
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

/** Visible text of the page (script and style left out), capped like the store check. */
function pageText(html: string, tags: Tag[]): string {
  return textBetween(html, tags, 0, Math.min(tags.length, 5000)).slice(0, 20000);
}

/**
 * Whether the visible text puts a phone number next to an alarm phrase, or the page links a phone (tel:)
 * while it raises the alarm. A scam of this kind wants the victim to call, not to fill in a form.
 */
function alarmWithPhone(text: string, tags: Tag[]): boolean {
  const cfg = TECHNIQUE_CONFIG.securityAlert;
  const alarms: number[] = [];
  for (const re of cfg.alarmPhrases) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of text.matchAll(g)) alarms.push(m.index ?? 0);
  }
  if (!alarms.length) return false;
  if (tags.some((t) => t.name === "a" && /\bhref\s*=\s*["']?\s*tel:/i.test(t.attrs))) return true;
  for (const m of text.matchAll(cfg.phoneNumber)) {
    const digits = m[0].replace(/\D/g, "").length;
    if (digits < cfg.minPhoneDigits || digits > cfg.maxPhoneDigits) continue;
    if (alarms.some((a) => Math.abs(a - (m.index ?? 0)) <= cfg.phoneWindowChars)) return true;
  }
  return false;
}

/** Whether the page holds the visitor: leaving is intercepted, full screen is forced, dialogs loop, an alarm sounds or a scan "runs". */
function holdsVisitor(html: string, tags: Tag[], text: string): boolean {
  const cfg = TECHNIQUE_CONFIG.securityAlert;
  return cfg.holdMechanisms.some((re) => re.test(html)) || cfg.scanPhrases.some((re) => re.test(text)) || backTrapFrom(html, tags);
}

/** fakeSecurityAlert over a document that is already scanned into tags (the page is read once for all techniques). */
function securityAlertFrom(html: string, tags: Tag[]): boolean {
  const text = pageText(html, tags);
  // the phone call alone is not enough (a shop has a number in the footer): the alarm and the hold complete the funnel
  return alarmWithPhone(text, tags) && holdsVisitor(html, tags, text);
}

/**
 * "Technical support" scam page: it raises an alarm (virus, locked computer, hacked account), gives a phone
 * number as the only way out and holds the visitor on the page. The page asks for a call instead of a
 * form; the victim is then asked to install a remote-desktop tool (see remoteAccessTool).
 */
export function fakeSecurityAlert(html: string): boolean {
  const doc = (html ?? "").slice(0, MAX_CHARS);
  return securityAlertFrom(doc, scanTags(doc));
}

/**
 * remoteAccessTool over scanned tags: a link to a tool host that is a download or comes with a code instruction, or
 * a download verb right before the tool name. The tool's own site (`pageUrl`) never counts.
 */
function remoteAccessFrom(html: string, tags: Tag[], pageUrl: string): boolean {
  const cfg = TECHNIQUE_CONFIG.remoteAccess;
  const toolHosts = new Set<string>(cfg.hosts);
  // the tool's own website is not a scam page
  if (toolHosts.has(registrableDomain(pageUrl) ?? "")) return false;
  const text = pageText(html, tags);
  const codeAsked = cfg.codePhrases.test(text);
  const linked = tags.some((t) => {
    const href = /\b(?:href|src)\s*=\s*["']?([^"'\s>]{1,500})/i.exec(t.attrs)?.[1];
    if (!href || !toolHosts.has(registrableDomain(href) ?? "")) return false;
    return codeAsked || cfg.downloadPath.test(href);
  });
  if (linked) return true;
  const g = new RegExp(cfg.toolNames.source, "gi");
  for (const m of text.matchAll(g)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - cfg.instructionWindowChars), m.index ?? 0);
    if (cfg.instructionVerbs.test(before)) return true;
  }
  return false;
}

/**
 * A link or an instruction to download a remote-desktop tool (AnyDesk, TeamViewer QuickSupport and the like)
 * on a page that is not the tool's own site. A caller of a fake support asks the victim for it to take over
 * the computer. A bare mention of the tool in a comparison is not an instruction.
 */
export function remoteAccessTool(html: string, pageUrl: string): boolean {
  const doc = (html ?? "").slice(0, MAX_CHARS);
  return remoteAccessFrom(doc, scanTags(doc), pageUrl);
}

/** Kind of a command text (powershell, mshta, …), or null when the text is not a command. */
function commandKind(text: string): string | null {
  return TECHNIQUE_CONFIG.clickfix.commandKinds.find((c) => c.pattern.test(text))?.kind ?? null;
}

/**
 * Command copied to the clipboard by the page's script: the literal given to navigator.clipboard.writeText
 * (also behind atob), or a command-like string literal of a script that copies through execCommand("copy").
 * Returns the first one that looks like a command, with whitespace collapsed; null when there is none.
 */
function copiedCommand(html: string): string | null {
  const cfg = TECHNIQUE_CONFIG.clickfix;
  const unescape = (v: string) => v.replace(/\\([\\"'`])/g, "$1");
  const write = /clipboard\s*\.\s*writeText\s*\(\s*((?:window\.)?atob\s*\(\s*)?(["'`])((?:\\.|(?!\2)[^\\\n]){1,4000}?)\2/g;
  const candidates: string[] = [];
  for (const m of html.matchAll(write)) {
    const raw = unescape(m[3]);
    candidates.push(m[1] ? Buffer.from(raw, "base64").toString("utf8") : raw);
  }
  if (/execCommand\s*\(\s*["']copy["']/.test(html)) {
    for (const m of html.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n]){10,4000}?)\1/g)) candidates.push(unescape(m[2]));
  }
  const found = candidates.find((c) => c.length <= cfg.maxCommandChars && commandKind(c));
  return found ? found.replace(/\s+/g, " ").trim() : null;
}

/**
 * Fake verification that gets the visitor to run a command (ClickFix). Returns null when the page is not one,
 * otherwise `command` holds the kind and hash of the command its script copies (null when the page only gives
 * the instruction). Two shapes count, both under the cover story of a CAPTCHA or "verify you are human": the
 * script copies a command, or the text tells the visitor to open Run / a terminal with a shortcut and paste.
 * A docs page with a "copy" button (no cover story) and a real reCAPTCHA (no instruction) are not ClickFix.
 */
export function clickfixPaste(html: string): { command: ClickfixCommand | null } | null {
  const doc = (html ?? "").slice(0, MAX_CHARS);
  return clickfixFrom(doc, scanTags(doc));
}

/** clickfixPaste over scanned tags (same result). */
function clickfixFrom(html: string, tags: Tag[]): { command: ClickfixCommand | null } | null {
  const cfg = TECHNIQUE_CONFIG.clickfix;
  const text = pageText(html, tags);
  const verify = cfg.verifyPhrases.test(text);
  const cmd = copiedCommand(html);
  const shortcut = cfg.shortcuts.some((re) => re.test(text));
  const instructed = shortcut && cfg.pasteHints.test(text);
  if (!((cmd && (instructed || verify)) || (instructed && verify))) return null;
  const kind = cmd ? commandKind(cmd) : null;
  return { command: cmd && kind ? { kind, sha256: createHash("sha256").update(cmd).digest("hex") } : null };
}

/**
 * All techniques of a page in one pass over its HTML, with the comment block and the kind and hash of a
 * ClickFix command. `pageUrl` is the address of the page (a store host or a remote-tool site is not a fake).
 */
export function detectPageTechniques(html: string, pageUrl: string): PageTechniques {
  if (!html) return { techniques: [], commentBlock: null, clickfix: null };
  const doc = html.slice(0, MAX_CHARS);
  const tags = scanTags(doc);
  const block = blockFrom(doc, tags);
  const techniques: PageTechnique[] = [];
  if (storeFrom(doc, tags, pageUrl)) techniques.push("fake_app_store");
  if (backTrapFrom(doc, tags)) techniques.push("back_trap");
  if (socialFrom(doc, tags)) techniques.push("fake_social_post");
  if (block) techniques.push("fake_comments");
  if (securityAlertFrom(doc, tags)) techniques.push("fake_security_alert");
  if (remoteAccessFrom(doc, tags, pageUrl)) techniques.push("remote_access_tool");
  const clickfix = clickfixFrom(doc, tags);
  if (clickfix) techniques.push("clickfix_paste");
  return { techniques, commentBlock: block, clickfix: clickfix?.command ?? null };
}
