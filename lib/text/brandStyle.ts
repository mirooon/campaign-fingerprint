/**
 * Style of brand and advertiser names (B-311). One operator's accounts often use names from one generator
 * ("Fikcyjnol Zyskownia": two pseudo-Polish words, the second a financial root plus a place-like suffix),
 * while the advertisers of one account have both generated and ordinary names, so neither links anything:
 * attributes for the reviewer. Pure functions.
 */
import { advertiserMismatch } from "./advertiserMismatch";
import { foldDiacritics } from "./normalize";

export const BRAND_STYLE_CONFIG = {
  /** Financial roots of the second word (folded). */
  financialRoots: ["zysk", "doch", "kapital", "lokat", "oszczed", "dzial", "inwest", "fundusz", "bogact"],
  /** Place-like suffixes of the second word (folded). */
  suffixes: ["arnia", "nica", "unek", "ownia", "alnia", "alnia", "elnia"],
  /** English words that make a name a generated brand when they close or open it. */
  brandWords: ["studio", "group", "media", "flow", "hub", "labs", "nova", "capital", "trade", "invest"],
  /** First names for "person" (folded); a pair of capitalised words with one of them first. */
  firstNames: ["jan", "adam", "piotr", "pawel", "marek", "tomasz", "michal", "krzysztof", "andrzej", "anna", "maria", "katarzyna", "agnieszka", "barbara", "ewa", "zofia", "joanna", "marta", "john", "peter", "michael", "david"],
};

/** "pseudo_polish_compound" for a two-word name whose second word is a financial root with a place-like suffix, else null. */
export function brandStyle(name: string | null | undefined): "pseudo_polish_compound" | null {
  const words = (name ?? "").trim().split(/\s+/);
  if (words.length !== 2) return null;
  const second = foldDiacritics(words[1].toLowerCase()).replace(/[^a-z]/g, "");
  const c = BRAND_STYLE_CONFIG;
  const hit = c.suffixes.some((s) => second.endsWith(s) && c.financialRoots.some((r) => second.startsWith(r) && second.length > r.length));
  return hit ? "pseudo_polish_compound" : null;
}

export type AdvertiserNameKind = "generated_brand" | "person" | "business";

/**
 * Kind of an advertiser's name: "generated_brand" (CamelCase compounds, brand words like Studio or Flow),
 * "person" (two capitalised words, a first name first), "business" (a word of a local business, the
 * dictionary of `advertiserMismatch`); null when none fits.
 */
export function advertiserNameKind(name: string | null | undefined): AdvertiserNameKind | null {
  const n = (name ?? "").trim();
  if (!n) return null;
  const c = BRAND_STYLE_CONFIG;
  const words = n.split(/\s+/);
  const folded = foldDiacritics(n.toLowerCase()).split(/[^a-z0-9]+/).filter(Boolean);
  const camel = words.some((w) => /^[A-Z][a-z]+[A-Z][A-Za-z]+$/.test(w));
  if (camel || (words.length >= 2 && folded.some((w) => c.brandWords.includes(w)) && /^[A-Za-z]+$/.test(n.replace(/\s/g, "")))) return "generated_brand";
  const mismatch = advertiserMismatch(n, true);
  if (mismatch?.kind === "business") return "business";
  if (words.length === 2 && words.every((w) => /^\p{Lu}\p{Ll}+$/u.test(w)) && c.firstNames.includes(foldDiacritics(words[0].toLowerCase()))) return "person";
  return mismatch?.kind === "person" ? "person" : null;
}
