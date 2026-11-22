/**
 * Infinitive title or button as a trace of machine translation (B-328).
 *
 * Polish calls to action are in the imperative ("Czytaj", "Kup teraz"). A title or a button that is a
 * bare infinitive ("Czytać", "Dowiedzieć się", "Kupować") is typical of text translated word by word
 * from a language where the dictionary form is used on buttons. An attribute of the material,
 * never a trace that links ads.
 */

/** Longest title (words) treated as a call to action. */
const MAX_WORDS = 3;

/** A Polish infinitive: -ać, -eć, -ić, -yć, -uć, -ąć, -ść, -źć (no accidental match on short words). */
const INFINITIVE = /^[a-ząćęłńóśźż]{3,}(?:ać|eć|ić|yć|uć|ąć|ść|źć)$/i;

/** The infinitive a title or button consists of ("Dowiedzieć się" -> "dowiedzieć się"), or null. */
export function infinitiveCta(text: string | null | undefined): string | null {
  const words = (text ?? "")
    .replace(/[.!…>»›→]+$/u, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length || words.length > MAX_WORDS) return null;
  if (!INFINITIVE.test(words[0])) return null;
  // after the infinitive only "się" or a short object/adverb: "Czytać więcej", "Kupować teraz"
  if (words.slice(1).some((w) => w.length > 8)) return null;
  return words.join(" ").toLowerCase();
}
