import type { ForeignSegment } from "./residue";
import type { TranslationArtifacts } from "./typography";

/** Thresholds of `languageErrors` (B-325): a foreign block in the page body must be long enough to be a paragraph. */
export const LANGUAGE_ERRORS_CONFIG = { minParagraphChars: 60, minMixedWords: 1 };

export interface LanguageErrors {
  /** Languages of whole paragraphs in the page body that differ from the language of the page. */
  foreignParagraphLangs: string[];
  /** Words that mix alphabets inside a sentence (a Latin word with a Cyrillic letter and the like). */
  mixedWords: number;
}

/**
 * Attribute of a shop or landing page (no weight, B-325): paragraphs of the page in a language other than
 * the page's own, or words that mix alphabets inside a sentence. Built from the `foreignSegments` and
 * `translationArtifacts` of the same page; only the page body counts (a script or comment in another
 * language is a different trace, `foreignSegments`). Null when there is nothing to report.
 */
export function languageErrors(segments: ForeignSegment[] | null | undefined, artifacts: TranslationArtifacts | null | undefined): LanguageErrors | null {
  const c = LANGUAGE_ERRORS_CONFIG;
  const foreignParagraphLangs = (segments ?? []).filter((s) => s.where === "page" && s.chars >= c.minParagraphChars).map((s) => s.lang);
  const mixedWords = artifacts?.mixed_alphabet ?? 0;
  if (!foreignParagraphLangs.length && mixedWords < c.minMixedWords) return null;
  return { foreignParagraphLangs, mixedWords };
}
