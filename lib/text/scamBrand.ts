/**
 * Brand of the scam itself (B-139): the product or "investment platform" name the operator gives its offer
 * ("Fikcyjnol Forte", "TradeSynthIQ 4.7", "Zyskowo Invest S.A."), not the brand it impersonates (a bank,
 * a news portal). It survives a change of face and domain, so it ties pages of one offer; but one product is
 * sold by many affiliates and platform names are copied, so in the graph it is a page-kit trait
 * (campaignRules.notAloneKinds: never joins alone) and generic platform names are discounted.
 *
 * Candidates are read from text with three patterns: a CamelCase name (optionally with a version), a
 * capitalised word followed by a product suffix (Forte, Max, Pro, AI ...), and the words before a legal
 * form (S.A., Ltd ...); plus the lander name the page platform records. Keys are normalised for matching:
 * lower case, no diacritics, letters and digits only ("TradeSynthIQ 4.7" = "tradesynthiq47").
 */
import { foldDiacritics } from "./normalize";

export interface ScamBrandConfig {
  /** Second words that make a capitalised word a product name ("Fikcyjnol Forte"), lower case. */
  suffixes: string[];
  /** Legal forms after a company name, lower case without dots. */
  legalForms: string[];
  /**
   * Normalised tokens of brands scams impersonate (banks, portals, platforms): a candidate holding one is
   * dropped; tokens of `minPrefixToken` letters or more also match inflected words ("InPostu").
   */
  impersonated: string[];
  /** A candidate key shorter than this is too unspecific. */
  minKeyLength: number;
  /** Impersonated tokens at least this long match as word prefixes (Polish inflection), shorter ones whole words only. */
  minPrefixToken: number;
}

export const DEFAULT_SCAM_BRAND_CONFIG: ScamBrandConfig = {
  suffixes: ["forte", "max", "plus", "pro", "ai", "active", "gold", "ultra", "premium", "extra", "duo", "complex", "invest", "capital", "trade", "trader", "app"],
  legalForms: ["sa", "ltd", "llc", "inc", "gmbh", "plc", "limited"],
  impersonated: [
    "pko", "pkobp", "pekao", "mbank", "ing", "santander", "millennium", "aliorbank", "nbp", "zus", "knf", "orlen", "pge", "lotos",
    "tvn", "tvn24", "onet", "wp", "wirtualnapolska", "interia", "gazeta", "gazetapl", "forbes", "bankier", "money", "moneypl", "polsat", "tvp", "businessinsider", "rzeczpospolita",
    "facebook", "google", "meta", "youtube", "tiktok", "instagram", "whatsapp", "telegram", "amazon", "netflix",
    // brands that pages of every kind mention (payments, software, devices, exchanges scams impersonate)
    "paypal", "linkedin", "wordpress", "javascript", "iphone", "ipad", "macbook", "playstation", "xbox", "coinbase", "binance", "revolut", "blik", "visa", "mastercard", "applepay", "googlepay", "chatgpt", "openai", "spacex", "tesla", "microsoft", "apple",
    // couriers and marketplaces that delivery and payment scams impersonate
    "inpost", "allegro", "olx", "vinted", "dhl", "dpd", "ups", "fedex", "pocztapolska",
  ],
  minKeyLength: 5,
  minPrefixToken: 5,
};

export interface ScamBrand {
  /** Normalised key ("fikcyjnolforte"). */
  key: string;
  /** The name as written. */
  name: string;
  source: "camel_case" | "product_suffix" | "legal_form" | "lander_name";
}

/** Matching key of a brand name: lower case, no diacritics, letters and digits only. */
export function normalizeBrand(name: string): string {
  return foldDiacritics(name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

const CAMEL = /(?<![\p{L}\p{N}])(\p{Lu}\p{Ll}+(?:\p{Lu}[\p{L}\p{N}]*)+)(?:\s+(v?\d+(?:\.\d+)?|AI|X\d*))?(?![\p{L}\p{N}])/gu;
// the second word is a lookahead, so "Zamów Fikcyjnol Forte" still yields the pair "Fikcyjnol Forte"
const CAPITALISED_PAIR = /(?<![\p{L}\p{N}])(\p{Lu}[\p{Ll}\p{Lu}]{3,})(?=\s+([\p{L}]{2,10})(?![\p{L}\p{N}]))/gu;
const LEGAL = /(?<![\p{L}\p{N}])((?:\p{Lu}[\p{L}]+\s+){0,2}\p{Lu}[\p{L}]+)\s+(S\.?\s?A\.?|Ltd\.?|LLC|Inc\.?|GmbH|PLC|Limited)(?![\p{L}])/gu;

/**
 * Scam brand candidates of a material from its texts (copy, OCR, page text) and the lander name of the page
 * platform. Drops candidates that name an impersonated brand or are too short. Deduplicated by key. Pure.
 */
export function scamBrands(input: { body?: string | null; landingName?: string | null }, config: ScamBrandConfig = DEFAULT_SCAM_BRAND_CONFIG): ScamBrand[] {
  const out = new Map<string, ScamBrand>();
  const impersonated = new Set(config.impersonated);
  const keep = (name: string, source: ScamBrand["source"]) => {
    const key = normalizeBrand(name);
    if (key.length < config.minKeyLength || out.has(key)) return;
    const words = foldDiacritics(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const named = (w: string) => impersonated.has(w) || config.impersonated.some((t) => t.length >= config.minPrefixToken && w.startsWith(t));
    if (words.some(named) || impersonated.has(key)) return;
    out.set(key, { key, name: name.trim(), source });
  };
  const body = input.body ?? "";
  for (const m of body.matchAll(CAMEL)) keep(m[2] ? `${m[1]} ${m[2]}` : m[1], "camel_case");
  for (const m of body.matchAll(CAPITALISED_PAIR)) {
    if (config.suffixes.includes(foldDiacritics(m[2]).toLowerCase())) keep(`${m[1]} ${m[2]}`, "product_suffix");
  }
  for (const m of body.matchAll(LEGAL)) {
    if (config.legalForms.includes(m[2].replace(/[.\s]/g, "").toLowerCase())) keep(m[1], "legal_form");
  }
  if (input.landingName && input.landingName.trim().length >= 3) keep(input.landingName, "lander_name");
  return [...out.values()];
}
