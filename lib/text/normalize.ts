/**
 * Text normalisation for similarity matching of ad copy.
 *
 * Scam ads evade filters with homoglyphs (Cyrillic "а" for Latin "a"), stripped
 * diacritics and leetspeak ("z4r4bi4j"). We fold all of these to a canonical form
 * before vectorising, so reworded/obfuscated variants still match.
 */

const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y",
  х: "x", і: "i", ї: "i", ј: "j", ѕ: "s", һ: "h", ԁ: "d", ԛ: "q", ԝ: "w", ү: "y", ɡ: "g",
  // Greek
  α: "a", β: "b", ε: "e", η: "n", ι: "i", κ: "k", μ: "m", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u",
  χ: "x", ω: "w",
  // Latin look-alikes that do not decompose under NFD
  ł: "l", đ: "d", ø: "o", ß: "ss", æ: "ae", œ: "oe", ı: "i",
};

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

/** Removes combining marks (ą→a, ż→z, ó→o) and maps non-decomposing look-alikes. */
export function foldDiacritics(input: string): string {
  let out = "";
  for (const ch of input.normalize("NFD").replace(/\p{M}+/gu, "")) out += HOMOGLYPHS[ch] ?? ch;
  return out;
}

function deLeetToken(token: string): string {
  // Only tokens that mix letters and leet characters, so "1000 zł" stays numeric.
  if (!/[a-z]/.test(token) || !/[0-9@$]/.test(token)) return token;
  if (/^\d+[a-z]{1,3}$/.test(token)) return token; // "100zl", "24h", "5x"
  return token.replace(/[0-9@$]/g, (c) => LEET[c] ?? c);
}

/** Canonical form of ad text used for n-gram vectorisation. */
export function normalizeForMatching(text: string): string {
  if (!text) return "";
  let s = text.normalize("NFKC").toLowerCase();
  s = s.replace(/\b(?:https?|hxxps?):\/\/\S+|\bwww\.\S+/g, " ");
  s = s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, " ");
  s = foldDiacritics(s);
  s = s
    .split(/\s+/)
    .map((t) => deLeetToken(t))
    .join(" ");
  s = s.replace(/[^\p{L}\p{N}]+/gu, " ");
  return s.replace(/\s+/g, " ").trim();
}
