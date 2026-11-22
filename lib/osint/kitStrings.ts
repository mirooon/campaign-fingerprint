/**
 * Developer messages of a page kit (I25). The scripts a scam network writes for its pages log what they
 * do ("Trap module armed!"), often with typos, and the same file goes to pages of different products and
 * operators: a rare message shared by two pages names the network's tool almost like a file hash. The
 * page platform's SDK, framework bundles and public libraries are masked (their messages are on every
 * page of the platform or the web), and so is a script holding an interface dictionary in many languages.
 *
 * Extraction only: which messages are rare and how two pages share them is the graph layer's job.
 * Pure functions, no network access.
 */
import { phraseOddity, type TemplatePhrase } from "../text/templatePhrases";
import { lexJs } from "./pagekit";
import { TEXT_CONFIG } from "./textConfig";

export interface KitString {
  /** Normalised message: lower case, spaces collapsed, every run of digits as "#". The pivot key. */
  key: string;
  /** The message as written, cut to TEXT_CONFIG.kitStrings.maxQuoteChars. */
  text: string;
  /** Copying error in the message (word mixing alphabets, doubled run of words), as in template sentences. */
  oddity?: TemplatePhrase["oddity"];
}

/** Lower case, whitespace collapsed, each run of digits as "#": "Krok 12 z 30" and "krok 3 z 9" are one message. */
export function normalizeKitString(s: string): string {
  return s.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

/**
 * True when the script at `url` is never read for text traces: an SDK of a page platform or a framework
 * bundle (`textBoilerplate.platformScriptPaths`, one file for all accounts) or a public library
 * (`kitStrings.libraries`). Inline scripts have no address and are never masked by it.
 */
export function isMaskedScript(url: string): boolean {
  const { platformScriptPaths } = TEXT_CONFIG.textBoilerplate;
  const { libraries } = TEXT_CONFIG.kitStrings;
  return platformScriptPaths.some((re) => re.test(url)) || libraries.some((re) => re.test(url));
}

/**
 * Language codes used as keys of an interface dictionary in the script (`{ en: {...}, "pl": "..." }`),
 * sorted; empty when fewer than `localizedUiMinLanguages` distinct codes are found. Such a script is the
 * platform's localisation of its interface: its strings are attributes of the page, never a pivot.
 */
export function localizedUiLanguages(code: string): string[] {
  const { languageCodes, localizedUiMinLanguages } = TEXT_CONFIG.textBoilerplate;
  const known = new Set<string>(languageCodes);
  const found = new Set<string>();
  for (const m of code.matchAll(/(?:^|[\s{,[])["']?([a-z]{2})(?:[-_][A-Za-z]{2})?["']?\s*:\s*[{"'`]/g)) {
    if (known.has(m[1])) found.add(m[1]);
  }
  return found.size >= localizedUiMinLanguages ? [...found].sort() : [];
}

/**
 * Whether a literal reads like a developer message: enough words, mostly letters and spaces, not an
 * address, a selector or a piece of code, and written in a log/error/alert call or ending like a message
 * ("!", "...", ":"). UI text without such a marker is left to the template sentences (lib/text).
 */
function isDeveloperMessage(value: string, before: string): boolean {
  const cfg = TEXT_CONFIG.kitStrings;
  const s = value.trim();
  if (s.length < cfg.minChars || s.length > cfg.maxChars) return false;
  if (/:\/\/|^www\.|^\/|^[.#[]|[<>{}=;]|=>|\bfunction\b|\(\)/.test(s)) return false;
  const words = s.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length < cfg.minWords) return false;
  const letters = (s.match(/[\p{L}\s]/gu) ?? []).length;
  if (letters / s.length < cfg.minLetterShare) return false;
  return cfg.messageContext.test(before) || cfg.messageEnding.test(s);
}

/**
 * Developer messages of the given scripts (code as text, already filtered by `isMaskedScript`), deduplicated
 * by key in script order, at most `kitStrings.maxPerPage`. A script holding an interface dictionary
 * (`localizedUiLanguages`) gives none.
 */
export function kitStringsOf(scripts: string[]): KitString[] {
  const cfg = TEXT_CONFIG.kitStrings;
  const out: KitString[] = [];
  const seen = new Set<string>();
  for (const code of scripts) {
    if (localizedUiLanguages(code).length) continue;
    for (const lit of lexJs(code).literals) {
      if (out.length >= cfg.maxPerPage) return out;
      // only the same statement counts: a log call on the previous line says nothing about this string
      const before = code.slice(Math.max(0, lit.start - cfg.contextChars), lit.start).split(/[;{}\n]/).pop() ?? "";
      if (!isDeveloperMessage(lit.value, before)) continue;
      const key = normalizeKitString(lit.value);
      if (seen.has(key)) continue;
      seen.add(key);
      const text = lit.value.replace(/\s+/g, " ").trim();
      const oddity = phraseOddity(text);
      out.push({ key, text: text.slice(0, cfg.maxQuoteChars), ...(oddity ? { oddity } : {}) });
    }
  }
  return out;
}
