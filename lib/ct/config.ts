/**
 * Configuration of the Certificate Transparency watcher: score levels, threshold and the
 * token lexicon (brands, impersonated media, institutions, lure words).
 *
 * Tokens never create a candidate on their own (a single common word gives too many false
 * positives); a candidate needs a pattern: a campaign's domain-name template, a configured
 * brand together with campaign context, a media name together with a campaign word, or the
 * same Lorem-style naming kit. Tokens add small bonuses and explanations.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

export interface CtLexicon {
  /** Brand names that campaigns invent or impersonate (configured per dataset). */
  brands: string[];
  /** Media outlets or news words that fake articles impersonate. */
  media: string[];
  /** Public institutions and banks. */
  institutions: string[];
  /** Lure words (investment, refund, prize...). */
  lures: string[];
}

export interface CtWatchConfig {
  /** Minimum score for a candidate (0..1). */
  threshold: number;
  scores: {
    /** Same domain-name template as a campaign domain, same TLD. */
    template: number;
    /** Same template, different TLD (TLD-agnostic variant). */
    templateOtherTld: number;
    /** A configured brand token used by a campaign plus campaign context. */
    brand: number;
    /** A media name used by a campaign plus another word of that campaign. */
    media: number;
    /** Same Lorem-style naming kit (different anchor word), same TLD. */
    loremKit: number;
    /** Same Lorem-style naming kit, different TLD. */
    loremKitOtherTld: number;
    /** Bonus when the template covers 2+ campaign domains. */
    supportBonus: number;
    /** Bonus per supporting token (at most two). */
    tokenBonus: number;
  };
  /** Minimum literal letters in a template (e.g. "zwrot" = 5) to use it as a fingerprint. */
  minTemplateLiteralChars: number;
  /** Minimum length of a brand token. */
  minBrandLength: number;
  /** Minimum length of a campaign word used as context. */
  minCampaignTokenLength: number;
  lexicon: CtLexicon;
  /** Words too generic to count as campaign context. */
  stopTokens: string[];
  /** Registrable domains never reported (own or known-good domains). */
  ignoreDomains: string[];
}

export const DEFAULT_CT_CONFIG: CtWatchConfig = {
  threshold: 0.6,
  scores: {
    template: 0.9,
    templateOtherTld: 0.8,
    brand: 0.7,
    media: 0.65,
    loremKit: 0.6,
    loremKitOtherTld: 0.5,
    supportBonus: 0.05,
    tokenBonus: 0.05,
  },
  minTemplateLiteralChars: 3,
  minBrandLength: 5,
  minCampaignTokenLength: 4,
  lexicon: {
    brands: [],
    media: ["wiadomosci", "fakty", "news", "dziennik", "gazeta", "kurier", "raport", "artykul", "wywiad", "telewizja"],
    institutions: ["gov", "rzad", "urzad", "zus", "nfz", "knf", "nbp", "bank", "policja", "poczta"],
    lures: ["inwest", "zysk", "krypto", "bitcoin", "dywidend", "zwrot", "doplat", "podatk", "gielda", "bonus", "wygran", "nagrod", "energia"],
  },
  stopTokens: [
    "demo", "test", "online", "info", "news", "shop", "site", "page", "web", "app", "www", "home", "official", "oficjalna",
    "strona", "portal", "start", "login", "secure", "mobile", "the", "and", "pl", "com", "net", "org", "lead", "leads",
  ],
  ignoreDomains: [],
};

const PartialSchema = z
  .object({
    threshold: z.number().min(0).max(1),
    scores: z.object({
      template: z.number(),
      templateOtherTld: z.number(),
      brand: z.number(),
      media: z.number(),
      loremKit: z.number(),
      loremKitOtherTld: z.number(),
      supportBonus: z.number(),
      tokenBonus: z.number(),
    }).partial(),
    minTemplateLiteralChars: z.number().int().min(0),
    minBrandLength: z.number().int().min(3),
    minCampaignTokenLength: z.number().int().min(2),
    lexicon: z.object({
      brands: z.array(z.string()),
      media: z.array(z.string()),
      institutions: z.array(z.string()),
      lures: z.array(z.string()),
    }).partial(),
    /** true: the file's lexicon lists replace the defaults instead of extending them. */
    replaceDefaultLexicon: z.boolean(),
    stopTokens: z.array(z.string()),
    ignoreDomains: z.array(z.string()),
  })
  .partial();

export type CtWatchConfigOverride = z.infer<typeof PartialSchema>;

export function mergeCtConfig(override: unknown): CtWatchConfig {
  const o = PartialSchema.parse(override ?? {});
  const base = DEFAULT_CT_CONFIG;
  const list = (key: keyof CtLexicon) => {
    const extra = o.lexicon?.[key];
    if (!extra) return [...base.lexicon[key]];
    return o.replaceDefaultLexicon ? [...extra] : [...new Set([...base.lexicon[key], ...extra])];
  };
  return {
    threshold: o.threshold ?? base.threshold,
    scores: { ...base.scores, ...o.scores },
    minTemplateLiteralChars: o.minTemplateLiteralChars ?? base.minTemplateLiteralChars,
    minBrandLength: o.minBrandLength ?? base.minBrandLength,
    minCampaignTokenLength: o.minCampaignTokenLength ?? base.minCampaignTokenLength,
    lexicon: { brands: list("brands"), media: list("media"), institutions: list("institutions"), lures: list("lures") },
    stopTokens: o.stopTokens ?? [...base.stopTokens],
    ignoreDomains: o.ignoreDomains ?? [...base.ignoreDomains],
  };
}

/** Loads a lexicon/config JSON file; a missing file gives the defaults. */
export function loadCtConfig(file: string | null | undefined): CtWatchConfig {
  if (!file || !existsSync(file)) return mergeCtConfig(null);
  return mergeCtConfig(JSON.parse(readFileSync(file, "utf8")));
}
