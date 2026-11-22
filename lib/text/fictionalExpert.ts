/**
 * Fictional experts of scam pages (B-313): "dr Jan Testowy", "prof. Anna Przykładowa". A scam page invents
 * an "expert" to vouch for the product; a made-up name is the invention of one operator, so the same name
 * (or the same name with a copying typo) on pages of different domains is a trace. A real person, i.e. a
 * name on the closed public list (data/osoby-publiczne.json), is not a pivot: the persona module handles
 * those. Offline, pure apart from reading the list once.
 */
import { existsSync, readFileSync } from "node:fs";
import { levenshtein, PUBLIC_PERSONS_FILE, stemPolish } from "./persona";
import { foldDiacritics } from "./normalize";

export interface ExpertName {
  /** Normalised key: `title:first surname` (lower case, no diacritics, Polish inflection ending stripped). */
  key: string;
  /** Title as written: `dr` or `prof`. */
  title: "dr" | "prof";
  /** Name as written in the text (first name and surname). */
  name: string;
}

/** Words after "dr" that make a brand or a phrase, not a person ("Dr. Martens Shoes"). */
const NOT_PERSON = new Set(["martens", "oetker", "pepper", "house", "web", "who", "google", "oz", "phil", "seuss", "strangelove", "dre"]);
const NAME = String.raw`\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?`;
/** `prof.`/`dr` title (with `hab.`, `n. med.`) followed by two capitalised words; the title may start a sentence. */
const EXPERT = new RegExp(String.raw`(?<![\p{L}])(?:([Pp]rof(?:esor)?|PROF)(?:\.\s*|\s+)(?:[Dd]r\.?\s*)?(?:hab\.?\s*)?|([Dd]r|DR|[Dd]oktor)(?:\.\s*|\s+)(?:hab\.?\s*)?(?:n\.\s*med\.?\s*)?)(${NAME})\s+(${NAME})`, "gu");
/** Longer names allow two edits (copying typos grow with the length). */
const LONG_NAME = 14;

/** Folds a name token: no diacritics, lower case, one Polish inflection ending stripped ("Testowego" is "Testowy" in another case). */
function stemToken(token: string): string {
  return stemPolish(foldDiacritics(token.toLowerCase()));
}

/** `first surname` of a name as the matching form (both tokens stemmed). */
function nameForm(first: string, last: string): string {
  return `${stemToken(first)} ${stemToken(last)}`;
}

/**
 * Experts named in the text: a `dr`/`prof.` title followed by a first name and a surname, unique by key,
 * in text order. Brands that look like a title and a name are left out.
 */
export function findExpertNames(text: string): ExpertName[] {
  const out = new Map<string, ExpertName>();
  for (const m of (text ?? "").matchAll(EXPERT)) {
    const title = m[1] ? "prof" : "dr";
    const [first, last] = [m[3], m[4]];
    if (NOT_PERSON.has(foldDiacritics(last.toLowerCase())) || NOT_PERSON.has(foldDiacritics(first.toLowerCase()))) continue;
    const key = `${title}:${nameForm(first, last)}`;
    if (!out.has(key)) out.set(key, { key, title, name: `${first} ${last}` });
  }
  return [...out.values()];
}

/** Forms (`first surname`, stemmed) of the closed public list: the name and each alias with two or more words. */
export function publicPersonForms(entries: Array<{ name: string; aliases?: string[] }>): string[] {
  const forms = new Set<string>();
  for (const e of entries) {
    for (const n of [e.name, ...(e.aliases ?? [])]) {
      const t = n.replace(/^@/, "").split(/\s+/).filter((x) => /\p{L}/u.test(x));
      if (t.length >= 2) forms.add(nameForm(t[0], t[t.length - 1]));
    }
  }
  return [...forms];
}

let cachedForms: string[] | null = null;
/**
 * Forms of the closed public list read from `data/osoby-publiczne.json` (the working directory, then the
 * repository root next to this file), once; an empty list when the file is not there (then no name is
 * excluded as a real person).
 */
export function loadPublicPersonForms(): string[] {
  if (cachedForms) return cachedForms;
  const candidates = [PUBLIC_PERSONS_FILE, new URL(`../../${PUBLIC_PERSONS_FILE}`, import.meta.url).pathname];
  const file = candidates.find((f) => existsSync(f));
  try {
    cachedForms = file ? publicPersonForms(JSON.parse(readFileSync(file, "utf8")) as Array<{ name: string; aliases?: string[] }>) : [];
  } catch {
    cachedForms = [];
  }
  return cachedForms;
}

/** True when the key's name is a person of the public list (same first name, surname within one edit). */
export function isPublicPerson(key: string, publicForms: string[]): boolean {
  const [first, last] = key.slice(key.indexOf(":") + 1).split(" ");
  return publicForms.some((f) => {
    const [pf, pl] = f.split(" ");
    return pf === first && levenshtein(pl, last) <= 1;
  });
}

/**
 * Merges spelling variants: keys of the same title within 1 edit (2 for a name of 14+ characters) become
 * the most frequent one (ties: the alphabetically first). `counts` is the number of materials per key.
 * Returns a map from every key to its canonical key.
 */
export function canonicalExperts(counts: Map<string, number>): Map<string, string> {
  const keys = [...counts.keys()].sort((a, b) => (counts.get(b)! - counts.get(a)!) || (a < b ? -1 : a > b ? 1 : 0));
  const canon: string[] = [];
  const map = new Map<string, string>();
  for (const k of keys) {
    const title = k.slice(0, k.indexOf(":"));
    const hit = canon.find((c) => c.startsWith(`${title}:`) && levenshtein(c, k) <= (Math.min(c.length, k.length) - title.length - 1 >= LONG_NAME ? 2 : 1));
    if (hit) map.set(k, hit);
    else {
      canon.push(k);
      map.set(k, k);
    }
  }
  return map;
}
