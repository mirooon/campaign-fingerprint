/**
 * Platform interface text in screenshots of ads.
 *
 * A screenshot of a sponsored post or of an ad-library detail view carries the same labels
 * ("Sponsored", "Learn more", "Library ID: …") whatever the ad says. Left in the OCR text they make
 * unrelated ads look alike, and an ad-library view is mostly interface, so its picture says little
 * about the creative. This module removes those labels, names the kind of view and reads the
 * ad-library ID, which identifies the ad itself. Polish and English interface. Pure functions.
 */

export type UiView = "ad_library" | "sponsored_post";

export interface UiChromeResult {
  /** OCR text without interface phrases, whitespace collapsed. */
  text: string;
  view: UiView | null;
  /** Ad-library IDs read from the text (digits only), in order of appearance, unique. */
  adLibraryIds: string[];
}

const LIBRARY_ID = /(?:identyfikator\s+biblioteki|library\s+id)\s*[:\-]?\s*(\d{12,20})/giu;

/** Phrases that only an ad-library view shows. */
const AD_LIBRARY_MARKERS = [
  /szczegóły\s+reklamy(?:\s+[x×])?/giu,
  /ad\s+details(?:\s+[x×])?/giu,
  /data\s+zamieszczenia\s*:?\s*\d{1,2}\s+\p{L}{3,12}\.?\s+\d{4}/giu,
  /started\s+running\s+on\s+\p{L}{3,9}\.?\s+\d{1,2},?\s+\d{4}/giu,
  /transparentność\s+według\s+lokalizacji/giu,
  /transparency\s+by\s+location/giu,
  /informacje\s+o\s+reklamodawcy/giu,
  /about\s+the\s+advertiser/giu,
  /reklamodawca\s+i\s+płatnik/giu,
  /advertiser\s+and\s+payer/giu,
  /informacje\s+o\s+reklamach\s+i\s+wykorzystaniu\s+danych/giu,
  /reklama\s+ma\s+kilka\s+wersji\.?/giu,
  /this\s+ad\s+has\s+multiple\s+versions\.?/giu,
  /(?:raport\s+|api\s+)?biblioteki?\s+reklam/giu,
  /ad\s+library(?:\s+report|\s+api)?/giu,
  /materiały\s+promujące\s+markę/giu,
];

/** Status labels: removed only inside an ad-library view, they are ordinary words elsewhere. */
const AD_LIBRARY_STATUS = /(?<![\p{L}\p{N}])(?:aktywna|nieaktywna|active|inactive)(?![\p{L}\p{N}])/giu;

/** Labels of any sponsored post: the "sponsored" tag and call-to-action buttons. */
const SPONSORED = /(?<![\p{L}\p{N}])(?:sponsorowane|sponsored)(?![\p{L}\p{N}])/giu;
const CALLS_TO_ACTION = [
  /dowiedz\s+się\s+więcej/giu,
  /wyświetl\s+szczegóły/giu,
  /zobacz\s+więcej/giu,
  /kup\s+teraz/giu,
  /zarejestruj\s+się/giu,
  /learn\s+more/giu,
  /see\s+details/giu,
  /see\s+more/giu,
  /shop\s+now/giu,
  /sign\s+up/giu,
];

const matches = (re: RegExp, s: string): boolean => {
  re.lastIndex = 0;
  const hit = re.test(s);
  re.lastIndex = 0; // a global regex keeps its position, and matchAll() would start from it
  return hit;
};

export function stripUiChrome(raw: string | null | undefined): UiChromeResult {
  const input = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!input) return { text: "", view: null, adLibraryIds: [] };

  const adLibraryIds: string[] = [];
  for (const m of input.matchAll(LIBRARY_ID)) if (!adLibraryIds.includes(m[1])) adLibraryIds.push(m[1]);

  const inLibrary = adLibraryIds.length > 0 || AD_LIBRARY_MARKERS.some((re) => matches(re, input));
  const sponsored = matches(SPONSORED, input);
  const view: UiView | null = inLibrary ? "ad_library" : sponsored ? "sponsored_post" : null;
  if (!view) return { text: input, view: null, adLibraryIds };

  let text = input.replace(LIBRARY_ID, " ");
  for (const re of AD_LIBRARY_MARKERS) text = text.replace(re, " ");
  if (inLibrary) text = text.replace(AD_LIBRARY_STATUS, " ");
  text = text.replace(SPONSORED, " ");
  for (const re of CALLS_TO_ACTION) text = text.replace(re, " ");
  return { text: text.replace(/\s+/g, " ").trim(), view, adLibraryIds };
}

export interface SponsoredPost {
  /** OCR text of the sponsored post only, one line per line. */
  text: string;
  /** Name of the advertiser's page, when the line that carries it was read cleanly. */
  advertiser: string | null;
}

const SPONSORED_LINE = /(?<![\p{L}\p{N}])(?:sponsorowane|sponsored)(?![\p{L}\p{N}])/iu;
/** A page name read without OCR debris: letters, digits and the usual punctuation of names. */
const CLEAN_NAME = /^[\p{L}\p{N}][\p{L}\p{N} .,'’&_-]{1,39}$/u;

/**
 * Cuts the OCR text of a feed screenshot down to the sponsored post and reads the advertiser.
 *
 * A phone screenshot of a feed also shows the end of the post above (its author and caption), which
 * says nothing about the ad and would be read as a person the ad uses. The page name stands on the
 * line above "Sponsored" (Meta) or after it on the same line (Google: "Sponsored · Name"), so the
 * post starts there. An ad-library view is left whole: its header carries the library ID.
 * Input: OCR text with line breaks kept.
 */
export function sponsoredPost(raw: string | null | undefined): SponsoredPost {
  const lines = (raw ?? "").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const text = lines.join("\n");
  const i = lines.findIndex((l) => matches(SPONSORED_LINE, l));
  if (i < 0) return { text, advertiser: null };
  const clean = (x: string) => (CLEAN_NAME.test(x) && /\p{L}{3}/u.test(x) ? x : null);
  const after = lines[i].split(SPONSORED_LINE)[1]?.replace(/^[\s·•\-–—:|]+/, "").trim() ?? "";
  if (after && clean(after)) return { text, advertiser: after }; // name on the tag's own line: nothing above belongs to another post
  const start = Math.max(0, i - 1);
  const above = lines.slice(0, start).join(" ");
  const inLibrary = matches(LIBRARY_ID, above) || AD_LIBRARY_MARKERS.some((re) => matches(re, above));
  const advertiser = i > 0 ? clean(lines[i - 1]) : null;
  return { text: inLibrary ? text : lines.slice(start).join("\n"), advertiser };
}

/** Buttons under every post (reactions, comments, sharing): interface, not content. */
const ENGAGEMENT = [
  /lubię\s+to!?/giu,
  /(?<![\p{L}\p{N}])(?:komentarz(?:e|y)?|skomentuj|udostępnij|udostępnienia|wyślij|obserwuj|reakcje)(?![\p{L}\p{N}])/giu,
  /(?<![\p{L}\p{N}])(?:like|comment|comments|share|shares|send|follow)(?![\p{L}\p{N}])/giu,
];

/**
 * Words of content in a text: what is left after the interface labels of the platform (the
 * "sponsored" tag, call-to-action and reaction buttons, ad-library markers) and bare numbers or
 * punctuation. Used to tell whether a material says anything to compare it by.
 */
export function contentWords(raw: string | null | undefined): string[] {
  let text = stripUiChrome(raw).text;
  text = text.replace(SPONSORED, " ");
  for (const re of CALLS_TO_ACTION) text = text.replace(re, " ");
  for (const re of ENGAGEMENT) text = text.replace(re, " ");
  return text.split(/[^\p{L}\p{N}]+/u).filter((w) => /\p{L}/u.test(w) && w.length >= 2);
}
