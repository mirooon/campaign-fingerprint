/**
 * Settings of the host look-alike check (I28, B-357): which characters pass for a slash, a dot or a hyphen
 * inside a host name, and which Cyrillic and Greek letters pass for Latin ones. Read by
 * lib/osint/idnConfusable.ts.
 */

export const HOST_CONFIG = {
  /**
   * Characters that look like a structural character of an address but are not it (so the browser shows a
   * different host than the one that is resolved): division slash, full-width slash, Katakana "no", one dot
   * leader, full-width and ordinary dashes of another code point. Value: what the character imitates.
   */
  lookalikeChars: {
    "∕": "/",
    "／": "/",
    "ノ": "/",
    "⁄": "/",
    "․": ".",
    "．": ".",
    "‐": "-",
    "‑": "-",
    "‒": "-",
    "−": "-",
    "－": "-",
  } as Record<string, string>,
  /** Cyrillic and Greek letters that look like a Latin letter; value: the Latin letter. */
  homoglyphs: {
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "і": "i", "ј": "j", "ӏ": "l",
    "ο": "o", "α": "a", "ρ": "p", "ν": "v", "ι": "i",
  } as Record<string, string>,
} as const;
