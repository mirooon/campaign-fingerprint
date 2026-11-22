/**
 * The advertiser's name against the content of the ad (I23). Investment scams are run from taken-over ad
 * accounts paid with cards of earlier victims (a guest house, a shop, a private person), so an investment
 * ad from an account named like a local business or a person most likely shows the victim's name. An
 * attribute of the material for the reviewer, never evidence of a campaign. Pure function.
 */
import { LEAD_CONFIG } from "../osint/leadConfig";
import { foldDiacritics } from "./normalize";

export interface AdvertiserMismatch {
  /** "business": a word of a local business in the name; "person": a private person's name. */
  kind: "business" | "person";
  /** The business word that matched (folded), for kind "business". */
  word?: string;
}

/**
 * Says whether the advertiser `name` does not fit investment content (`investment`: the ad or its page
 * has a financial narrative). Returns null when the content is not about investing, the name is empty,
 * or the name has a financial word ("Invest", "Kapitał" …); otherwise the kind of unrelated name, or
 * null when the name looks neither like a local business nor like a person (brand words such as
 * "Studio" or "Stream" rule the person out). A heuristic for the reviewer: the dictionaries are in
 * LEAD_CONFIG.advertiserMismatch.
 */
export function advertiserMismatch(name: string | null | undefined, investment: boolean): AdvertiserMismatch | null {
  if (!investment || !name || !name.trim()) return null;
  const cfg = LEAD_CONFIG.advertiserMismatch;
  const folded = foldDiacritics(name.toLowerCase());
  const words = folded.split(/[^a-z0-9]+/).filter(Boolean);
  if (cfg.financeWords.some((f) => words.some((w) => w.startsWith(f)))) return null;
  const word = cfg.businessWords.find((b) => (b.includes(" ") ? folded.includes(b) : words.some((w) => w.startsWith(b))));
  if (word) return { kind: "business", word };
  if (words.some((w) => (cfg.brandWords as readonly string[]).includes(w))) return null;
  return cfg.personName.test(name.trim()) ? { kind: "person" } : null;
}
