/**
 * Style of names the operator or the buyer picked: mixed alphabets in a campaign name, the language of a code
 * comment, the folder of a landing page (a slug without vowels or made of random words) and the name of the
 * advertiser's page (B-339, B-341, B-347). Descriptions of how the material was made, never a link and never
 * a conclusion about who wrote it. Pure functions; word lists are settings at the top of the file.
 */

/** First names of English-speaking persons that a Polish ad has no reason to show as the advertiser. */
const ENGLISH_FIRST_NAMES = new Set(["sharon", "john", "james", "mary", "linda", "susan", "karen", "emily", "jessica", "michael", "robert", "david", "sarah", "laura", "daniel", "peter", "george", "helen", "nancy", "betty"]);
/** Second words that make a business-sounding name out of any English word ("<Word> Studio"). */
const BRAND_SUFFIXES = new Set(["studio", "production", "productions", "media", "group", "labs", "works", "agency", "partners", "digital", "ventures"]);
/** Function words that mark a text as Polish, besides the diacritics. */
const POLISH_WORDS = /\b(?:się|nie|jest|oraz|dla|przez|jak|już|tylko|który|która|które|zł|polsk\w*)\b/i;
/** Smallest number of words of a slug made of random words. */
const MIN_WORDLIST_WORDS = 5;
/** Smallest number of vowelless parts of a consonant slug. */
const MIN_CONSONANT_PARTS = 3;

/**
 * Whether a value mixes Latin and Cyrillic letters inside one word ("С4" with a Cyrillic С, "сс" next to Latin
 * words): the sign of a name typed on a Cyrillic keyboard layout (B-339). Pure Cyrillic or pure Latin values are not.
 */
export function mixedScriptName(value: string): boolean {
  const words = (value ?? "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const inWord = words.some((w) => /\p{Script=Cyrillic}/u.test(w) && /\p{Script=Latin}|\d/u.test(w));
  if (inWord) return true;
  const hasCyr = /\p{Script=Cyrillic}/u.test(value ?? "");
  const hasLat = /\p{Script=Latin}/u.test(value ?? "");
  return hasCyr && hasLat;
}

/**
 * Language of a code comment from letters only one language has: Ukrainian (ї, є, ґ, і) or Russian (ы, э, ъ, ё).
 * Null for other text or when both sets are present (B-339).
 */
export function commentLanguage(text: string): "uk" | "ru" | null {
  const t = (text ?? "").toLowerCase();
  if (!/\p{Script=Cyrillic}/u.test(t)) return null;
  const uk = /[їєґі]/.test(t);
  const ru = /[ыэъё]/.test(t);
  return uk && !ru ? "uk" : ru && !uk ? "ru" : null;
}

/**
 * Style of the folder name in a landing-page path: `consonant_slug` (at least three hyphen-separated parts
 * without vowels, "krwst-pl-mnbvrtk") or `wordlist_slug` (five or more short lowercase words joined by `_` or
 * `-`, "wood_music_soda_treasure_reaction"). Null for an ordinary path (B-341).
 */
export function landerSlugStyle(path: string): "consonant_slug" | "wordlist_slug" | null {
  for (const seg of (path ?? "").split("/").filter(Boolean)) {
    const parts = seg.toLowerCase().split(/[-_]/).filter(Boolean);
    if (parts.length >= MIN_CONSONANT_PARTS && parts.filter((p) => p.length >= 2 && /^[a-z]+$/.test(p) && !/[aeiouy]/.test(p)).length >= MIN_CONSONANT_PARTS) return "consonant_slug";
    if (parts.length >= MIN_WORDLIST_WORDS && /[_-]/.test(seg) && parts.every((p) => /^[a-z]{3,9}$/.test(p))) return "wordlist_slug";
  }
  return null;
}

/**
 * Style of the advertiser's page name against the language of the ad (B-347): `foreign_person_name` (an English
 * first name and a surname in a Polish ad) or `random_brand` (two English words, the second a business noun,
 * none of them in the ad text). Null otherwise; the check needs a clearly Polish ad text.
 */
export function advertiserNameStyle(name: string | null | undefined, adText: string | null | undefined): "random_brand" | "foreign_person_name" | null {
  const n = (name ?? "").trim();
  const text = adText ?? "";
  const words = n.split(/\s+/);
  if (words.length !== 2 || !words.every((w) => /^[A-Z][a-z]{2,}$/.test(w))) return null;
  if (!/[ąćęłńóśźż]/i.test(text) && !POLISH_WORDS.test(text)) return null;
  if (words.some((w) => text.toLowerCase().includes(w.toLowerCase()))) return null;
  if (ENGLISH_FIRST_NAMES.has(words[0].toLowerCase())) return "foreign_person_name";
  if (BRAND_SUFFIXES.has(words[1].toLowerCase())) return "random_brand";
  return null;
}
