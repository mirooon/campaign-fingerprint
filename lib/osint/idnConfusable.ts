/**
 * Hosts that look like another host (I28, B-357): a character that passes for the slash, dot or hyphen of an
 * address ("bank.example∕login.evil.test" reads as a path on bank.example), or a label that mixes Latin
 * with Cyrillic or Greek letters ("skl" + Cyrillic "е" + "p"). An attribute of the material for the reviewer:
 * it says how the host looks to the eye and where the odd character is, and never links materials.
 * Pure functions over the host as written (Unicode form).
 */
import { HOST_CONFIG } from "./hostConfig";
import { toUnicodeHost } from "./urls";

export interface IdnConfusable {
  /** lookalike_char: a character that imitates "/", "." or "-"; mixed_script: Latin mixed with Cyrillic or Greek in one label. */
  kind: "lookalike_char" | "mixed_script";
  /** The host as written. */
  host: string;
  /** The label with the odd letters, for kind "mixed_script"; null for a look-alike character. */
  label: string | null;
  /** Index in the host of the first odd character. */
  position: number;
  /** The odd character as "U+XXXX" (the first one). */
  char: string;
  /** The host as it looks to the eye: look-alikes replaced by what they imitate. */
  looksLike: string;
}

const codePoint = (ch: string) => `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
const LATIN = /\p{Script=Latin}/u;
const OTHER_SCRIPT = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;

/** The host with every look-alike character and homoglyph replaced by the character it imitates. */
function looksLike(host: string): string {
  return [...host].map((ch) => HOST_CONFIG.lookalikeChars[ch] ?? HOST_CONFIG.homoglyphs[ch] ?? ch).join("");
}

/**
 * The first reason the host (Unicode form, as written) is not what it looks like, or null: a look-alike of
 * "/", "." or "-" first, then a label that mixes Latin with Cyrillic or Greek letters. A label written
 * entirely in one script is an ordinary name in that language; Polish letters are Latin.
 */
export function idnConfusable(host: string): IdnConfusable | null {
  const odd = [...host].findIndex((ch) => ch in HOST_CONFIG.lookalikeChars);
  if (odd >= 0) {
    // the index of a spread array counts code points, the position counts UTF-16 units like String#indexOf
    const char = [...host][odd];
    return { kind: "lookalike_char", host, label: null, position: host.indexOf(char), char: codePoint(char), looksLike: looksLike(host) };
  }
  let offset = 0;
  for (const label of host.split(".")) {
    if (LATIN.test(label) && OTHER_SCRIPT.test(label)) {
      const char = [...label].find((ch) => OTHER_SCRIPT.test(ch))!;
      return { kind: "mixed_script", host, label, position: offset + label.indexOf(char), char: codePoint(char), looksLike: looksLike(host) };
    }
    offset += label.length + 1;
  }
  return null;
}

/**
 * The same check for an address: the host is read as written, up to the first real "/", "?" or "#" (a
 * look-alike of the slash is part of the host, not the start of the path); a punycode label is decoded first.
 * Null for text that is not an address with a scheme.
 */
export function idnConfusableInUrl(url: string): IdnConfusable | null {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?([^/?#:]+)/i.exec(url.trim());
  return m ? idnConfusable(toUnicodeHost(m[1])) : null;
}
