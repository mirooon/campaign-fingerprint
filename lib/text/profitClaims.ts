/**
 * Profit claims of the copy (I23): "nastolatek zarobił 3 tys. w ciągu dnia", "4000 zł tygodniowo",
 * "€250 dziennie". Operators pick believable amounts and repeat them across a script, so the set of
 * amount + period pairs is a trait of the scheme's script: an attribute of the material and a trace for
 * groups of similar campaigns only (familyOnlyKinds), never of one operator. Standard deposits ("minimalny
 * depozyt 250 USD") stay in the attribute but never in the pivot. Pure functions.
 */
import { LEAD_CONFIG } from "../osint/leadConfig";

export type ProfitPeriod = "hour" | "day" | "week" | "month";

export interface ProfitClaim {
  /** Amount in units of the currency (thousands expanded: "3 tys." = 3000). */
  amount: number;
  /** ISO code (PLN, EUR, USD, GBP) or null when the text names no currency. */
  currency: string | null;
  /** Period of the promised profit; null for a deposit named without one. */
  period: ProfitPeriod | null;
  /** The amount and its period as written. */
  quote: string;
  /** A deposit or a standard amount (LEAD_CONFIG.profitClaims): left out of profitClaimKey. */
  standard: boolean;
}

const CUR_BEFORE = "(€|\\$|£)\\s?";
const NUMBER = "(\\d{1,3}(?:[ \\u00a0.]\\d{3})+|\\d+(?:[.,]\\d+)?)";
const MULT = "(?:\\s?(tys\\.?|tysi[ęe]c[ya]?|tysi[ęe]cy|k|mln)(?![\\p{L}]))?";
const CUR_AFTER = "(?:\\s?(zł|złotych|zl|pln|eur|euro|usd|dolar[óo]w|\\$|€|gbp|£)(?![\\p{L}]))?";
const PERIOD =
  "(?:\\s?(?:/\\s?|na |w ciągu |w |per |a |each )?)(godzin[ęey]|godz\\.?|h|hour|dzie[ńn]|dnia|dziennie|day|daily|tydzie[ńn]|tygodnia|tygodniowo|week|weekly|miesi[ąa]c[a]?|miesi[ęe]cznie|mies\\.?|month|monthly)(?![\\p{L}])";
const CLAIM_RE = new RegExp(`(?:${CUR_BEFORE})?${NUMBER}${MULT}${CUR_AFTER}(?:${PERIOD})?`, "giu");

const CURRENCY: Record<string, string> = { "€": "EUR", eur: "EUR", euro: "EUR", $: "USD", usd: "USD", dolarów: "USD", dolarow: "USD", "£": "GBP", gbp: "GBP", zł: "PLN", złotych: "PLN", zl: "PLN", pln: "PLN" };

/** Period word of the copy as a ProfitPeriod (null when there is none). */
function periodOf(word: string | undefined): ProfitPeriod | null {
  if (!word) return null;
  const w = word.toLowerCase();
  if (/^(godz|h$|hour)/.test(w)) return "hour";
  if (/^(dzie|dnia|dzienn|day|daily)/.test(w)) return "day";
  if (/^(tydz|tygod|week)/.test(w)) return "week";
  return "month";
}

/** Number of the copy ("1 200", "3,5") times its multiplier ("tys.", "k", "mln"). */
function amountOf(num: string, mult: string | undefined): number {
  const digits = /^\d{1,3}(?:[  .]\d{3})+$/.test(num) ? num.replace(/[  .]/g, "") : num.replace(",", ".");
  const m = (mult ?? "").toLowerCase();
  const factor = m.startsWith("mln") ? 1_000_000 : m.startsWith("tys") || m === "k" ? 1000 : 1;
  return Math.round(parseFloat(digits) * factor);
}

/**
 * Finds amounts with a period of profit ("3 tys. w ciągu dnia", "1 200 PLN/dzień") and deposits named
 * with a currency ("depozyt 250 USD", period null) in `text` (copy, page text, OCR or transcript), in
 * text order. An amount with neither a period nor a deposit context (a price, a date) is no claim, and
 * neither is a number with no currency and no "tys." ("w ciągu 24 godziny").
 */
export function profitClaims(text: string | null | undefined): ProfitClaim[] {
  if (!text) return [];
  const cfg = LEAD_CONFIG.profitClaims;
  const out: ProfitClaim[] = [];
  for (const m of text.matchAll(CLAIM_RE)) {
    const [whole, curBefore, num, mult, curAfter, periodWord] = m;
    const currencyWord = (curBefore ?? curAfter ?? "").toLowerCase();
    const currency = currencyWord ? (CURRENCY[currencyWord] ?? null) : null;
    const period = periodOf(periodWord);
    const before = text.slice(Math.max(0, (m.index ?? 0) - cfg.contextChars), m.index ?? 0);
    const deposit = cfg.depositContext.test(before);
    if (!period && !(deposit && currency)) continue;
    // money needs a currency or a "tys." multiplier: "w ciągu 24 godziny" is a time, not a profit
    if (!currency && !mult) continue;
    const amount = amountOf(num, mult);
    const standard = deposit || (cfg.standardAmounts as readonly number[]).includes(amount);
    out.push({ amount, currency, period, quote: whole.trim(), standard });
  }
  return out;
}

/**
 * Pivot key of the claims of one material: the sorted unique "amount/period" pairs of its non-standard
 * claims joined with "|" ("3000/day|4000/week"), or null when none is left. The currency is left out:
 * one script is translated for several countries with the same numbers.
 */
export function profitClaimKey(claims: ProfitClaim[]): string | null {
  const pairs = [...new Set(claims.filter((c) => !c.standard && c.period).map((c) => `${c.amount}/${c.period}`))].sort();
  return pairs.length ? pairs.join("|") : null;
}
