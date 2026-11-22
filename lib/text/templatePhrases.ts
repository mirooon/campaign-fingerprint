/**
 * Sentences of a landing-page template (I23). Operators buy ready pages and copy their text, including
 * the thank-you message written into the page's scripts ("Nasz opiekun zadzwoni do Ciebie …"), so a rare
 * sentence repeated on sites in different domains points to one template. A shared error (a doubled run
 * of words, a word mixing Latin and Cyrillic letters) is rarer than a shared correct sentence and is
 * marked as an oddity.
 *
 * Extraction only: which sentences are rare and on how many domains is the graph layer's job.
 * Pure functions, no network access.
 */
import { LEAD_CONFIG } from "../osint/leadConfig";

export interface TemplatePhrase {
  /** Normalised sentence: lower case, punctuation removed, every number as "#". The pivot key. */
  key: string;
  /** The sentence as written, cut to LEAD_CONFIG.templatePhrase.maxQuoteChars. */
  text: string;
  /** Visible text of the page, a string of its scripts (message after sending the form), or a commented-out old text. */
  source: "text" | "script" | "comment";
  /** A copying error inside the sentence: a doubled run of words or a word mixing alphabets. */
  oddity?: "repeat" | "mixed_script";
}

const SENTENCE_END = /(?<=[.!?…])\s+|\n+/;
const STRING_LITERAL = /(["'`])((?:\\.|(?!\1)[^\\\n]){12,600})\1/g;
const LATIN = /[A-Za-z]/;
const CYRILLIC = /[Ѐ-ӿ]/;

/**
 * Canonical form of a sentence for comparison: lower case, every number (with its thousands separators,
 * "3 000") as "#", everything but letters, "#" and spaces removed, spaces collapsed. Letters of any
 * alphabet stay as they are, so a sentence with a Cyrillic look-alike stays its own key.
 */
export function normalizePhrase(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/\d(?:[\d\s.,]*\d)?/g, "#")
    .replace(/[^\p{L}#\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Kind of copying error in a sentence (see TemplatePhrase.oddity), or undefined when there is none. Also
 * used for the developer messages of kit scripts (lib/osint/kitStrings), so one detector flags both.
 */
export function phraseOddity(sentence: string): TemplatePhrase["oddity"] {
  return oddityOf(sentence, normalizePhrase(sentence).split(" ").filter(Boolean));
}

/** Kind of copying error in a sentence whose normalised words are given, or undefined when there is none. */
function oddityOf(sentence: string, words: string[]): TemplatePhrase["oddity"] {
  if (sentence.split(/\s+/).some((w) => LATIN.test(w) && CYRILLIC.test(w))) return "mixed_script";
  const k = LEAD_CONFIG.templatePhrase.repeatRunWords;
  const seen = new Map<string, number>();
  for (let i = 0; i + k <= words.length; i++) {
    const run = words.slice(i, i + k).join(" ");
    if (run.includes("#")) continue;
    const first = seen.get(run);
    // a run repeated without overlap ("a b c a b c"), not one word stuttered ("a a a a")
    if (first !== undefined && i >= first + k) return "repeat";
    if (first === undefined) seen.set(run, i);
  }
  return undefined;
}

/**
 * Strings of the page scripts that the visitor sees after sending the form: literals holding a marker
 * (success, dziękujemy, zadzwoni …) or written right after one in the same statement (alert(,
 * innerHTML =), with HTML tags removed. Code and configuration strings without a marker are left out.
 */
function scriptMessages(scripts: string[]): string[] {
  const { scriptMarkers, scriptContextChars } = LEAD_CONFIG.templatePhrase;
  const out: string[] = [];
  for (const code of scripts) {
    for (const m of code.matchAll(STRING_LITERAL)) {
      const start = m.index ?? 0;
      // only the same statement counts: a marker of the previous line says nothing about this string
      const before = code.slice(Math.max(0, start - scriptContextChars), start).split(/[;{}\n]/).pop() ?? "";
      if (!scriptMarkers.test(m[2]) && !scriptMarkers.test(before)) continue;
      out.push(m[2].replace(/\\[nrt]/g, " ").replace(/<[^>]*>/g, " "));
    }
  }
  return out;
}

/**
 * Template sentences of a page from its visible text and the messages in its scripts: sentences of
 * LEAD_CONFIG.templatePhrase.minWords..maxWords words that are not consent, cookie or legal boilerplate,
 * deduplicated by key, in document order (text first), at most maxPerPage.
 */
export function templatePhrases(visibleText: string, scripts: string[]): TemplatePhrase[] {
  const cfg = LEAD_CONFIG.templatePhrase;
  const out: TemplatePhrase[] = [];
  const seen = new Set<string>();
  const sources: Array<[string, TemplatePhrase["source"]]> = [
    [visibleText ?? "", "text"],
    ...scriptMessages(scripts).map((s) => [s, "script"] as [string, TemplatePhrase["source"]]),
  ];
  for (const [text, source] of sources) {
    for (const raw of text.split(SENTENCE_END)) {
      if (out.length >= cfg.maxPerPage) return out;
      const sentence = raw.replace(/\s+/g, " ").trim();
      const key = normalizePhrase(sentence);
      const words = key.split(" ").filter(Boolean);
      if (words.length < cfg.minWords || words.length > cfg.maxWords || seen.has(key)) continue;
      if (cfg.boilerplate.some((re) => re.test(sentence))) continue;
      seen.add(key);
      const oddity = oddityOf(sentence, words);
      out.push({ key, text: sentence.slice(0, cfg.maxQuoteChars), source, ...(oddity ? { oddity } : {}) });
    }
  }
  return out;
}
