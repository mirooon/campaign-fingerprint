/**
 * Small page and creative traits that are attributes, never traces (B-334, B-335, B-337, B-338):
 * a script hidden in an SVG image, the name of a "back button" trap library, text spaced out letter
 * by letter to dodge text filters, and the fake "as seen on" strip of media logos. Pure functions.
 */

/** Names of the libraries that trap the browser's back button (a kit technique used by many operators). */
const BACK_LIBS: Array<{ name: string; pattern: RegExp }> = [
  { name: "VitBackHandler", pattern: /\bVitBackHandler\b/ },
  { name: "vitBack", pattern: /\bvitBack\b/ },
  { name: "back-spt.js", pattern: /\bback-spt\.js\b/i },
  { name: "BackFix", pattern: /\bBackFix\b/ },
  { name: "back-nav.js", pattern: /\bback-nav\.js\b/i },
];

/**
 * Back-trap libraries named in a page or script text (B-335): names in a fixed order, unique. A kit
 * trait shared by many operators, so an attribute and never a pivot.
 */
export function backLibs(text: string): string[] {
  if (!text) return [];
  return BACK_LIBS.filter((b) => b.pattern.test(text)).map((b) => b.name);
}

/** Five or more single letters separated by single spaces ("P o b i e r z"). */
const SPACED_RUN = /(?<![\p{L}\p{N}])\p{L}(?: \p{L}){4,}(?![\p{L}\p{N}])/gu;

/** Whether the text holds a run of letters spaced out one by one (B-337). */
export function hasSpacedText(text: string | null | undefined): boolean {
  if (!text) return false;
  SPACED_RUN.lastIndex = 0;
  return SPACED_RUN.test(text);
}

/**
 * Glues letters spaced out one by one back into words (B-337): "Z a r e j e s t r u j" becomes
 * "Zarejestruj". Runs shorter than five letters stay (ordinary one-letter words). Words separated by
 * a single space inside one run cannot be told apart and are glued together.
 */
export function despaceText(text: string): string {
  return text.replace(SPACED_RUN, (m) => m.replace(/ /g, ""));
}

/** Names of the media whose logos a fake "as seen on" strip shows. */
const MEDIA_OUTLETS = ["Fox News", "NBC", "CNN", "BBC", "CBS", "ABC News", "Forbes", "Bloomberg", "Reuters", "Daily Mail", "The Guardian", "New York Times", "Wall Street Journal", "TVN24", "TVN", "Polsat", "TVP", "Onet", "WP", "Interia", "Fakt", "Gazeta Wyborcza", "Rzeczpospolita", "Business Insider"];
const OUTLET_RE = new RegExp(`(?<![\\p{L}\\p{N}])(${MEDIA_OUTLETS.map((o) => o.replace(/ /g, "\\s+")).join("|")})(?![\\p{L}\\p{N}])`, "giu");
/** The label of the strip: "Pokazano w", "Widziano w", "As seen on", "Featured in". */
const AS_SEEN_LABEL = /\b(?:pokazano|widziane|widziano|widoczne|jak\s+widziano|zobacz|wystąpi\w*|publikowan\w+|as\s+seen\s+(?:on|in)|seen\s+on|featured\s+(?:on|in)|shown\s+on)\s*(?:w|na|in|on)?\s*:/iu;
const AS_SEEN_WINDOW_CHARS = 200;

/**
 * Media logos of a fake "as seen on" strip (B-338): a label ("Pokazano w:", "As seen on:") followed
 * within 200 characters by at least two outlet names. The names in order of the text, unique; an empty
 * list when there is no strip. A real press quote names one outlet and carries no such label.
 */
export function asSeenOn(text: string | null | undefined): string[] {
  if (!text) return [];
  const label = AS_SEEN_LABEL.exec(text);
  if (!label) return [];
  const after = text.slice(label.index + label[0].length, label.index + label[0].length + AS_SEEN_WINDOW_CHARS);
  const found: string[] = [];
  for (const m of after.matchAll(OUTLET_RE)) {
    const name = MEDIA_OUTLETS.find((o) => o.toLowerCase() === m[1].replace(/\s+/g, " ").toLowerCase()) ?? m[1];
    if (!found.includes(name)) found.push(name);
  }
  return found.length >= 2 ? found : [];
}

/**
 * Scripts hidden in SVG images (B-334): the addresses a `<script>` inside an `<svg>` loads or mentions.
 * Returns null when the text holds no SVG with a script (a plain icon); otherwise `{ urls }` (possibly
 * empty: an inline script with no address). Works on a standalone SVG file and on inline SVGs of a page.
 */
export function svgScriptInfo(text: string | null | undefined): { urls: string[] } | null {
  if (!text || !/<svg[\s>]/i.test(text)) return null;
  const urls = new Set<string>();
  let found = false;
  for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]{0,200000}?)<\/script\s*>|<script\b([^>]*)\/>/gi)) {
    found = true;
    const attrs = `${m[1] ?? ""} ${m[3] ?? ""}`;
    const src = /(?:src|href|xlink:href)\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (src && /^(?:https?:)?\/\//i.test(src[1])) urls.add(src[1]);
    const body = (m[2] ?? "").replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "");
    for (const u of body.match(/https?:\/\/[^\s"'`<>\\)]+/gi) ?? []) urls.add(u);
  }
  return found ? { urls: [...urls].slice(0, 20) } : null;
}
