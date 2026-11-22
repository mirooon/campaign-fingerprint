/**
 * Typography and translation traces of a text (B-309, B-310). The same article is posted on several
 * accounts with different quotation marks and number formats; a machine translation leaves words with
 * mixed alphabets, calques and jumps between "you" (singular) and "you" (plural). Both are descriptions
 * for the reviewer: typography tells templates apart, not owners, and nothing here says who the author is.
 * Pure functions.
 */

export const TYPOGRAPHY_CONFIG = {
  /** Texts shorter than this have no profile (the rates would be noise). */
  minChars: 200,
  /** Calques that no native writer produces: pattern on the text as written (case matters: a city in the nominative). */
  calques: [/\bmieszka(?:nka|niec|ńcy|nki) miasta [A-ZŁŚŻ]\p{L}*(?<![yi])\b/u],
  /** Both forms must appear at least this often to count as a jump. */
  formSwitchMin: 3,
  /** At least this many spelled-out numerals in a caption mean text written for speech synthesis. */
  spelledNumbersMin: 3,
};

const MARKS: Array<[string, RegExp]> = [
  ["guillemets", /[«»]/g],
  ["low9_quotes", /[„”]/g],
  ["curly_quotes", /[“]/g],
  ["straight_quotes", /"/g],
  ["apostrophe", /’/g],
  ["em_dash", /—/g],
  ["en_dash", /–/g],
  ["spaced_hyphen", / - /g],
  ["ellipsis_char", /…/g],
  ["three_dots", /\.\.\./g],
  ["nbsp", / /g],
  ["emoji", /\p{Extended_Pictographic}/gu],
];

export interface TypographyProfile {
  chars: number;
  /** Occurrences per 1000 characters, only for marks that occur. */
  per1000: Record<string, number>;
  /** Thousands separator of numbers: "space", "dot" or "comma" (counts). */
  numberFormats: Record<string, number>;
  /** Currency spelling: "zl_suffix", "pln", "dollar", "euro" (counts). */
  currency: Record<string, number>;
  /** Dominant kind of quotation mark, or null. */
  quoteStyle: "guillemets" | "low9" | "curly" | "straight" | null;
}

/** Profile of the typography of a text, or null for a text shorter than `minChars`. */
export function typographyOf(text: string | null | undefined): TypographyProfile | null {
  const t = text ?? "";
  if (t.length < TYPOGRAPHY_CONFIG.minChars) return null;
  const per1000: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const [name, re] of MARKS) {
    const n = (t.match(re) ?? []).length;
    if (n) {
      counts[name] = n;
      per1000[name] = Math.round((n * 10000) / t.length) / 10;
    }
  }
  const tally = (re: RegExp, kind: (m: RegExpMatchArray) => string) => {
    const out: Record<string, number> = {};
    for (const m of t.matchAll(re)) out[kind(m)] = (out[kind(m)] ?? 0) + 1;
    return out;
  };
  const numberFormats = tally(/\b\d{1,3}(?:([  .,])\d{3})+\b/g, (m) => (m[1] === "." ? "dot" : m[1] === "," ? "comma" : "space"));
  const currency = tally(/\d\s?(zł|PLN|\$|€|USD|EUR)|(\$|€)\s?\d/gi, (m) => {
    const c = (m[1] ?? m[2]).toLowerCase();
    return c === "zł" ? "zl_suffix" : c === "pln" ? "pln" : c === "usd" || c === "$" ? "dollar" : "euro";
  });
  const quotes: Array<[TypographyProfile["quoteStyle"], number]> = [
    ["guillemets", counts.guillemets ?? 0],
    ["low9", counts.low9_quotes ?? 0],
    ["curly", counts.curly_quotes ?? 0],
    ["straight", counts.straight_quotes ?? 0],
  ];
  const top = quotes.sort((a, b) => b[1] - a[1])[0];
  return { chars: t.length, per1000, numberFormats, currency, quoteStyle: top[1] >= 2 ? top[0] : null };
}

/**
 * True when two profiles differ clearly: another dominant quotation mark, or another thousands
 * separator. Used for "the same text, another editing" next to a shared narrative or template sentence.
 */
export function typographyDiffers(a: TypographyProfile | null | undefined, b: TypographyProfile | null | undefined): boolean {
  if (!a || !b) return false;
  if (a.quoteStyle && b.quoteStyle && a.quoteStyle !== b.quoteStyle) return true;
  const top = (o: Record<string, number>) => Object.entries(o).sort((x, y) => y[1] - x[1])[0]?.[0];
  const [na, nb] = [top(a.numberFormats), top(b.numberFormats)];
  return !!na && !!nb && na !== nb;
}

const SPELLED = /\b(?:jeden|dwa|dwie|trzy|cztery|pięć|sześć|siedem|osiem|dziewięć|dziesięć|dwadzieścia|trzydzieści|czterdzieści|pięćdziesiąt|sto|dwieście|trzysta|pięćset|tysiąc|tysiące|tysięcy|milion|miliony|milionów)\b/giu;
const PLURAL_YOU = /\b(?:wy|wam|wami|wasz\p{L}*|macie|jesteście|możecie|chcecie|zarobicie|dostaniecie)\b/giu;
const SINGULAR_YOU = /\b(?:ty|ciebie|tobie|tobą|twój|twoja|twoje|twoim|masz|jesteś|możesz|chcesz|zarobisz|dostaniesz)\b/giu;

export type TranslationArtifacts = Partial<Record<"mixed_alphabet" | "calque" | "form_switch" | "spelled_numbers", number>>;

/**
 * Signs of a translated text with their counts: words mixing Latin and Cyrillic letters, calques from
 * the configured list, jumps between the singular and plural "you" (both forms at least `formSwitchMin`
 * times) and spelled-out numerals in `captions` (text written for speech synthesis, at least
 * `spelledNumbersMin`). Null when none is found.
 */
export function translationArtifacts(text: string | null | undefined, captions?: string | null): TranslationArtifacts | null {
  const t = text ?? "";
  const c = TYPOGRAPHY_CONFIG;
  const out: TranslationArtifacts = {};
  const mixed = t.split(/\s+/).filter((w) => /[A-Za-z]/.test(w) && /[Ѐ-ӿ]/.test(w)).length;
  if (mixed) out.mixed_alphabet = mixed;
  const calques = c.calques.reduce((n, re) => n + (new RegExp(re.source, re.flags.replace("g", "") + "g").test(t) ? 1 : 0), 0);
  if (calques) out.calque = calques;
  const plural = (t.match(PLURAL_YOU) ?? []).length;
  const singular = (t.match(SINGULAR_YOU) ?? []).length;
  if (plural >= c.formSwitchMin && singular >= c.formSwitchMin) out.form_switch = Math.min(plural, singular);
  const spelled = (captions ?? "").match(SPELLED)?.length ?? 0;
  if (spelled >= c.spelledNumbersMin) out.spelled_numbers = spelled;
  return Object.keys(out).length ? out : null;
}
