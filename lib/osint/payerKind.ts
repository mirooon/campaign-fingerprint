/**
 * Kind of the payer and beneficiary declared in a public ad library (DSA art. 26 and 39: Meta's
 * `dsa_payor` and `dsa_beneficiary`, Google's "funded by"). The advertiser types these names in
 * and the platform does not verify them, so a name is a self-declaration, not proof of who paid.
 * What the name looks like still says something: scam ads often declare keyboard noise, a stub
 * of three letters, a private person in a foreign alphabet or a generic "... Media". The kind is
 * a hint for the analyst and a fact for the report ("the declared payer is keyboard noise"), not
 * a link: a stub shared by unrelated advertisers must not tie their ads (see `ad_payer` in the graph).
 *
 * Pure functions with dictionaries in `DEFAULT_PAYER_KIND_CONFIG`; the dictionaries are generic
 * (stock placeholders, keyboard rows, company words), not read off any case.
 */
import { foldDiacritics } from "../text/normalize";

/** The kinds in the order they are checked: the first that fits wins. */
export const PAYER_KINDS = ["placeholder", "gibberish", "person_foreign_script", "person", "generic_corp", "matches_page", "registered_form", "other"] as const;
export type PayerKind = (typeof PAYER_KINDS)[number];

export interface PayerKindConfig {
  /** A name of at most this many letters and digits (after folding) is a stub. */
  maxPlaceholderLength: number;
  /** Stock placeholders typed in to get past the form, compared as the whole folded name (lower case, letters and digits only). */
  placeholders: string[];
  /** Keyboard rows; a run of `keyboardRunMin` neighbouring keys (either direction) in one word is typing noise, not a name. */
  keyboardRows: string[];
  keyboardRunMin: number;
  /** A one-word name this long (in characters) can be judged gibberish by the letter/digit mix, missing vowels or entropy. */
  gibberishMinLength: number;
  /** Least number of switches between a letter and a digit that makes a mixed word gibberish ("qwe9f8sd7f6"; "Brand2024" has one). */
  gibberishMinSwitches: number;
  /** Shannon entropy per character (bits) and the largest share of vowels that together make a consonant-heavy word gibberish. */
  gibberishMinEntropy: number;
  gibberishMaxVowelShare: number;
  /** Number of words in a personal name. */
  personWords: { min: number; max: number };
  /**
   * Characters that mark Vietnamese spelling, matched on the decomposed form: đ and the combining circumflex,
   * tilde, breve, hook above, horn and dot below (ă â ơ ư and the tones). Polish uses none of them; French or
   * Portuguese names do (â, ã), so the kind is a hint that holds for Polish ads only.
   */
  vietnameseMarks: string;
  /**
   * Words of a company without a registry identity ("Global Media Corp"). A name made only of them is generic,
   * and so is a short name that ends in one ("Fikcyjna Media", "Przykładowa Corp"): the advertiser dressed a
   * made-up word as a company.
   */
  genericCorpWords: string[];
  /** A name that only ends in a generic word counts as generic up to this many words, and only without a registration number (a run of `registrationDigits` digits). */
  genericSuffixMaxWords: number;
  registrationDigits: number;
  /** Further words of organisations and shops: a name holding one is not a person's, though it is not generic either. */
  organisationWords: string[];
  /** Legal forms at the end of a name, lower case, without dots and spaces ("sp. z o.o." -> "spzoo"). */
  legalForms: string[];
  /** An ad with at least this many Polish letters (ąćęłńóśźż) in its text is read as Polish. */
  polishMinLetters: number;
  /** Region codes of a library record that make an ad Polish. */
  polishRegions: string[];
}

export const DEFAULT_PAYER_KIND_CONFIG: PayerKindConfig = {
  maxPlaceholderLength: 3,
  placeholders: ["test", "tests", "testing", "xyz", "xxx", "aaa", "abc", "asdf", "brak", "none", "null", "na", "nic", "unknown", "nieznany", "nieznane", "undefined", "tbd", "todo", "nodata", "niedotyczy", "company", "firma", "name", "nazwa", "admin", "user", "default"],
  keyboardRows: ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"],
  keyboardRunMin: 5,
  gibberishMinLength: 8,
  gibberishMinSwitches: 3,
  gibberishMinEntropy: 3.0,
  gibberishMaxVowelShare: 0.2,
  personWords: { min: 2, max: 4 },
  vietnameseMarks: "ăđơự̛̂̃̆̉",
  genericCorpWords: ["media", "corp", "corporation", "group", "global", "digital", "marketing", "agency", "solutions", "studio", "studios", "ltd", "llc", "inc", "limited", "company", "co", "international", "worldwide", "online", "services", "consulting", "ventures", "holding", "holdings", "network", "networks", "partners", "systems", "technologies", "tech", "labs", "invest", "capital", "trade", "trading", "business", "enterprise", "enterprises"],
  organisationWords: [
    "fundacja", "stowarzyszenie", "sklep", "klub", "bank", "apteka", "centrum", "instytut", "urząd", "gmina", "miasto", "szkoła", "uniwersytet", "kancelaria", "hurtownia", "salon", "gabinet", "przychodnia", "spółdzielnia", "zakład", "biuro", "serwis", "portal", "wydawnictwo", "foundation", "association", "institute", "university", "shop", "store", "bureau", "stiftung", "verein", "club",
  ],
  legalForms: ["spzoo", "sa", "spk", "spj", "sc", "spa", "gmbh", "ag", "kg", "ug", "sro", "ou", "bv", "nv", "sarl", "sas", "srl", "sl", "ltd", "llc", "inc", "limited", "plc", "oy", "ab", "as", "aps", "kft", "doo", "ood", "ooo", "zao", "oao"],
  genericSuffixMaxWords: 3,
  registrationDigits: 5,
  polishMinLetters: 2,
  polishRegions: ["pl", "polska", "poland"],
};

/** Context of a payer name: what the same ad says about the advertiser. */
export interface PayerContext {
  /** Name of the advertiser's page or account, or null. */
  pageName: string | null;
  /** The ad is in Polish or aimed at Poland. */
  polishAd: boolean;
}

export interface PayerClass {
  kind: PayerKind;
  /** Why the kind was chosen, in Polish, for the analyst. */
  reasons: string[];
}

/** Features of an ad derived from its payers and beneficiaries; `null` when the ad declares none. */
export interface PayerSummary {
  /** Distinct kinds of all declared payers and beneficiaries, in the order of `PAYER_KINDS`. */
  payerKinds: PayerKind[];
  /** Payer and beneficiary are declared and name the same (compared after folding case, diacritics and spaces). */
  payerEqualsBeneficiary: boolean;
  /** Some declared name is a placeholder, gibberish or a person in a foreign script. */
  payerSuspicious: boolean;
}

/** Caution shown with a kind in the viewer and the evidence pack (only for the kinds that need one). */
export const PAYER_KIND_NOTES_PL: Partial<Record<PayerKind, string>> = {
  person: "Płatnik to osoba prywatna: może być ofiarą kradzieży tożsamości, bo imię i nazwisko w repozytorium reklam wpisuje sam reklamodawca i nikt tego nie weryfikuje.",
};

/** Kinds that make the declared payer suspicious by themselves. */
const SUSPICIOUS_KINDS: readonly PayerKind[] = ["placeholder", "gibberish", "person_foreign_script"];

/** Name reduced for comparison: no case, diacritics, spaces or punctuation (homoglyphs are folded to Latin as in the rest of the repo). */
export function payerKey(name: string): string {
  return foldDiacritics(name.normalize("NFKC").toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Shannon entropy of the characters of `s`, in bits per character. */
function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}

/** Whether `word` holds `run` neighbouring keys of one keyboard row, forwards or backwards. */
function hasKeyboardRun(word: string, cfg: PayerKindConfig): boolean {
  for (const row of cfg.keyboardRows) {
    for (const r of [row, [...row].reverse().join("")]) {
      for (let i = 0; i + cfg.keyboardRunMin <= r.length; i++) {
        if (word.includes(r.slice(i, i + cfg.keyboardRunMin))) return true;
      }
    }
  }
  return false;
}

/**
 * Why a one-word name is gibberish, or `null`. Judged on the folded Latin form: a run of keys, letters
 * mixed with digits switching back and forth, no vowel at all, a consonant-heavy high-entropy word, or
 * one or two characters repeated. A real brand with a year ("Brand2024") switches once and is not caught.
 */
function gibberishReason(token: string, cfg: PayerKindConfig): string | null {
  const word = payerKey(token);
  if (!/^[a-z0-9]+$/.test(word)) return null;
  if (word.length >= cfg.keyboardRunMin && hasKeyboardRun(word, cfg)) return "ciąg klawiszy z jednego rzędu klawiatury";
  if (word.length < cfg.gibberishMinLength) return null;
  if (new Set(word).size <= 2) return "powtórzone jeden lub dwa znaki";
  const switches = (word.match(/[a-z][0-9]|[0-9][a-z]/g) ?? []).length;
  if (switches >= cfg.gibberishMinSwitches) return "litery wymieszane z cyframi";
  const letters = word.replace(/[0-9]/g, "");
  const vowels = (letters.match(/[aeiouy]/g) ?? []).length;
  if (letters.length >= cfg.gibberishMinLength && vowels === 0) return "ciąg liter bez samogłosek";
  if (vowels / word.length <= cfg.gibberishMaxVowelShare && entropy(word) >= cfg.gibberishMinEntropy) return "ciąg znaków o wysokiej entropii i prawie bez samogłosek";
  return null;
}

/** Splits a name into words, dropping punctuation around them. */
function wordsOf(name: string): string[] {
  return name.normalize("NFKC").split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter(Boolean);
}

/** Script of a letter group: "latin", a non-Latin script name, or null when it is no letter. */
function scriptOf(word: string): string | null {
  for (const [name, re] of [
    ["cyrillic", /\p{Script=Cyrillic}/u],
    ["greek", /\p{Script=Greek}/u],
    ["arabic", /\p{Script=Arabic}/u],
    ["hebrew", /\p{Script=Hebrew}/u],
    ["han", /\p{Script=Han}/u],
    ["kana", /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
    ["hangul", /\p{Script=Hangul}/u],
    ["thai", /\p{Script=Thai}/u],
    ["devanagari", /\p{Script=Devanagari}/u],
    ["latin", /\p{Script=Latin}/u],
  ] as const) {
    if (re.test(word)) return name;
  }
  return null;
}

/** A word that looks like a part of a name: a capital letter first (or a script without case), letters and `'`, `-`, and an initial may end with a dot. */
function looksLikeNameWord(word: string): boolean {
  return /^[\p{L}\p{M}'’-]+$/u.test(word) && (/^\p{Lu}/u.test(word) || /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}]/u.test(word));
}

/**
 * Whether a legal form of `cfg.legalForms` closes the name as separate tokens ("Przykład sp. z o.o." yes,
 * "Przykladsa" no, "SA Przykład" no): the last tokens of the name, with dots dropped, spell exactly one form.
 * A registration number after the form ("Ltd 12345678") is skipped, because that is the proof the form is real.
 */
function endsWithLegalForm(name: string, cfg: PayerKindConfig): boolean {
  const tokens = name.normalize("NFKC").toLowerCase().split(/\s+/).map((t) => foldDiacritics(t).replace(/[^\p{L}\p{N}]+/gu, "")).filter(Boolean);
  while (tokens.length > 1 && /^\d+$/.test(tokens[tokens.length - 1]) && tokens[tokens.length - 1].length >= cfg.registrationDigits) tokens.pop();
  return cfg.legalForms.some((form) => {
    let acc = "";
    for (let i = tokens.length - 1; i >= 1; i--) {
      acc = tokens[i] + acc;
      if (acc === form) return true;
      if (acc.length >= form.length) break;
    }
    return false;
  });
}

/**
 * Classifies one declared payer or beneficiary name. The kinds are tried in the order of `PAYER_KINDS`
 * and the first that fits wins, so a stub is never also gibberish and a person is never also "other".
 * Returns the kind and the reasons in Polish. A name in a foreign script counts as suspicious only on
 * a Polish ad: there it is a stranger's name where a Polish firm would stand.
 */
export function classifyPayer(name: string, ctx: PayerContext, cfg: PayerKindConfig = DEFAULT_PAYER_KIND_CONFIG): PayerClass {
  const key = payerKey(name);
  const words = wordsOf(name);
  const scripts = words.map(scriptOf);
  const nonLatinWords = words.filter((_, i) => scripts[i] !== null && scripts[i] !== "latin");
  const manyNonLatin = words.length >= 2 && nonLatinWords.length === words.length;

  if (!manyNonLatin) {
    if (key.length <= cfg.maxPlaceholderLength) return { kind: "placeholder", reasons: [`zaślepka: nazwa ma ${key.length} znaków (próg ${cfg.maxPlaceholderLength})`] };
    if (cfg.placeholders.includes(key)) return { kind: "placeholder", reasons: ["zaślepka: typowe słowo wpisywane, żeby ominąć formularz"] };
    if (!/\p{L}/u.test(name)) return { kind: "placeholder", reasons: ["zaślepka: nazwa bez liter"] };
  }

  if (words.length === 1) {
    const reason = gibberishReason(words[0], cfg);
    if (reason) return { kind: "gibberish", reasons: [`bełkot: ${reason}`] };
  }

  const inRange = words.length >= cfg.personWords.min && words.length <= cfg.personWords.max;
  const companyWord = (w: string) => {
    const k = payerKey(w);
    return cfg.genericCorpWords.includes(k) || cfg.organisationWords.some((o) => payerKey(o) === k) || cfg.legalForms.includes(k);
  };
  const nameShaped = inRange && words.every(looksLikeNameWord) && !words.some(companyWord);
  if (nameShaped) {
    const vietnamese = [...name.normalize("NFD")].some((ch) => cfg.vietnameseMarks.includes(ch));
    if (ctx.polishAd && nonLatinWords.length > 0) return { kind: "person_foreign_script", reasons: ["imię i nazwisko w obcym alfabecie na reklamie po polsku"] };
    if (ctx.polishAd && vietnamese) return { kind: "person_foreign_script", reasons: ["imię i nazwisko ze znakami typowymi dla pisowni wietnamskiej na reklamie po polsku"] };
    return { kind: "person", reasons: ["osoba prywatna jako płatnik (może być ofiarą kradzieży tożsamości)"] };
  }

  if (words.length > 0 && words.every((w) => cfg.genericCorpWords.includes(payerKey(w)))) return { kind: "generic_corp", reasons: ["ogólna nazwa firmowa złożona z samych ogólnych słów, bez formy prawnej z numerem"] };
  const hasRegistrationNumber = new RegExp(`\\d{${cfg.registrationDigits},}`).test(name.replace(/[\s-]/g, ""));
  if (words.length > 1 && words.length <= cfg.genericSuffixMaxWords && !hasRegistrationNumber && cfg.genericCorpWords.includes(payerKey(words[words.length - 1]))) {
    return { kind: "generic_corp", reasons: ["ogólna nazwa firmowa: zmyślone słowo z ogólną końcówką („… Media”, „… Corp”), bez formy prawnej z numerem"] };
  }

  if (ctx.pageName && key && payerKey(ctx.pageName) === key) return { kind: "matches_page", reasons: ["płatnik równy nazwie strony reklamodawcy"] };

  if (endsWithLegalForm(name, cfg)) return { kind: "registered_form", reasons: ["nazwa z formą prawną"] };

  return { kind: "other", reasons: ["nazwa nie pasuje do żadnego z rodzajów"] };
}

/**
 * Features of an ad from the names it declares: the kinds of all payers and beneficiaries, whether the
 * payer equals the beneficiary (usually so in scam ads) and whether some name is suspicious by itself.
 * `null` when the ad declares neither. The equality is false when only one side is declared.
 */
export function summarizePayers(declared: { payers: string[]; beneficiaries: string[] }, ctx: PayerContext, cfg: PayerKindConfig = DEFAULT_PAYER_KIND_CONFIG): PayerSummary | null {
  const names = [...declared.payers, ...declared.beneficiaries].filter((n) => n.trim());
  if (!names.length) return null;
  const found = new Set(names.map((n) => classifyPayer(n, ctx, cfg).kind));
  const keys = (list: string[]) => new Set(list.map(payerKey).filter(Boolean));
  const payers = keys(declared.payers);
  const beneficiaries = keys(declared.beneficiaries);
  return {
    payerKinds: PAYER_KINDS.filter((k) => found.has(k)),
    payerEqualsBeneficiary: payers.size > 0 && payers.size === beneficiaries.size && [...payers].every((k) => beneficiaries.has(k)),
    payerSuspicious: SUSPICIOUS_KINDS.some((k) => found.has(k)),
  };
}

/** Whether an ad is Polish or aimed at Poland: a Polish region in the library record, or Polish letters in the text. */
export function isPolishAd(text: string | null, regions: string[], cfg: PayerKindConfig = DEFAULT_PAYER_KIND_CONFIG): boolean {
  if (regions.some((r) => cfg.polishRegions.includes(r.trim().toLowerCase()))) return true;
  return (text?.match(/[ąćęłńóśźż]/gi) ?? []).length >= cfg.polishMinLetters;
}
