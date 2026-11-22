/**
 * Fictional expert (B-300): a health ad that quotes "dr Jan Testowy" or "prof. Anna Przykładowa" whose name
 * is not on the closed list of public figures. Such "doctors" are very often invented (stock photo or AI
 * face, no entry in the medical register). An ATTRIBUTE of the material for the reviewer only: it is not
 * a linking pivot and never proof of a campaign. Pure text function, no biometrics, no network.
 */
import { foldDiacritics } from "./normalize";
import { loadWatchlist, PUBLIC_PERSONS_FILE, stemPolish, type PersonaEntry } from "./persona";

export interface FictionalExpert {
  /** The title as written ("dr", "prof.", "lek."). */
  title: string;
  /** The name after the title, as written (one to three capitalised words). */
  name: string;
}

/** Title (dr, dr hab., dr n. med., prof., lek., doktor, profesor, lekarz) followed by 1-3 capitalised words. */
const EXPERT_RE =
  /\b(dr(?:\s+hab\.?)?(?:\s+n\.\s*med\.?)?|prof\.?(?:\s+dr\s+hab\.?)?|lek\.?|doktor(?:a|owi|em)?|profesor(?:a|owi|em)?|lekarz(?:a|owi|em)?)\s+((?:\p{Lu}[\p{L}'’-]{2,})(?:\s+\p{Lu}[\p{L}'’-]{2,}){0,2})/gu;

/** Words that follow a title but are not a surname ("dr Google", "lekarz Rodzinny" are rare; "prof. Dr" etc.). */
const NOT_A_NAME = new Set(["medycyny", "nauk", "habilitowany", "doktor", "profesor", "lekarz", "google", "chatgpt"]);

/**
 * Names of the people on the list, as folded token sets: each entry's name and aliases. A candidate is
 * "on the list" when its stemmed surname (the last token) equals a listed surname stem and, when the
 * candidate has a first name, the first-name stems agree or the listed entry may match by surname alone.
 */
function listedKeys(publicPersons: readonly Pick<PersonaEntry, "name" | "aliases">[]): Set<string> {
  const keys = new Set<string>();
  for (const p of publicPersons) {
    for (const n of [p.name, ...(p.aliases ?? [])]) {
      const tokens = foldDiacritics(n.toLowerCase()).split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
      if (tokens.length >= 2) keys.add(`${stemPolish(tokens[0])} ${stemPolish(tokens[tokens.length - 1])}`);
      if (tokens.length === 1) keys.add(stemPolish(tokens[0]));
    }
  }
  return keys;
}

/**
 * Persons introduced with a medical title in `text` whose name is NOT on `publicPersons` (inflected forms
 * such as "prof. Szaflika" are matched by stems). Dedupes by folded name. Returns [] for empty input.
 * The caller decides whether the context (a health narrative) makes the attribute meaningful.
 */
export function detectFictionalExperts(text: string, publicPersons: readonly Pick<PersonaEntry, "name" | "aliases">[]): FictionalExpert[] {
  if (!text) return [];
  const listed = listedKeys(publicPersons);
  const seen = new Set<string>();
  const out: FictionalExpert[] = [];
  for (const m of text.matchAll(EXPERT_RE)) {
    const title = m[1].trim();
    const name = m[2].trim();
    const tokens = foldDiacritics(name.toLowerCase()).split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
    if (!tokens.length || tokens.some((t) => NOT_A_NAME.has(t))) continue;
    const surname = stemPolish(tokens[tokens.length - 1]);
    const key = tokens.length >= 2 ? `${stemPolish(tokens[0])} ${surname}` : surname;
    const onList = listed.has(key) || [...listed].some((k) => !k.includes(" ") && k === surname) || (tokens.length === 1 && [...listed].some((k) => k.endsWith(` ${surname}`)));
    if (onList || seen.has(key)) continue;
    seen.add(key);
    out.push({ title, name });
  }
  return out;
}

let cachedList: PersonaEntry[] | null = null;

/**
 * The closed list of public figures (data/osoby-publiczne.json), read once; [] when the file is missing
 * (the attribute then only drops names already matched as personas by the caller).
 */
export function publicPersonsForExperts(): PersonaEntry[] {
  if (cachedList) return cachedList;
  try {
    cachedList = loadWatchlist(PUBLIC_PERSONS_FILE);
  } catch {
    cachedList = [];
  }
  return cachedList;
}
