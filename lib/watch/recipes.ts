/**
 * Search recipes of the scan scheduler: which public source to ask, with what query, how often, and
 * which infrastructure evidence confirms a hit. Recipes are configuration (JSON), so the values of
 * known campaigns (tenant ids, hashes, domains) stay in a file outside the repository; the repository
 * holds only this format, the engine and a synthetic example (data/examples/watch-przepisy.example.json).
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { WATCH_CONFIG } from "./config";

/** Registration facts a hit must share with a campaign to be kept (the RDAP/NS filter of the CERT list and CT recipes). */
const confirmSchema = z.object({
  /** Registrar names (RDAP), compared case-insensitively as substrings. */
  registrars: z.array(z.string().min(1)).optional(),
  /** Pairs of name servers the campaign's domains use; a hit matches when its NS set contains every name of one pair. */
  nameserverPairs: z.array(z.array(z.string().min(1)).min(1)).optional(),
  /** Window of the hour of registration (UTC, 0-23; `from` > `to` wraps over midnight). */
  registeredHoursUtc: z.object({ from: z.number().int().min(0).max(23), to: z.number().int().min(0).max(23) }).optional(),
  /** Kinds of the above that must match; default: all that the rule names. */
  minMatches: z.number().int().positive().optional(),
});

export const watchRecipeSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  source: z.enum(WATCH_CONFIG.sources),
  /**
   * urlscan: search query (urlscan syntax); adlibrary: keyword; certlist and ct: a regular expression over the
   * registrable domain (matched case-insensitively).
   */
  query: z.string().min(1),
  /** How often this recipe is asked, e.g. "6h"; default: every cycle. */
  every: z.string().regex(/^\d+[smhd]$/, "np. 30m, 6h, 1d").optional(),
  /**
   * Feature read from the scan's request list (urlscan): the first capture group of `regex` over the request
   * addresses, e.g. a tenant id in a path. With `alarm` only a hit whose value is in the list is kept; an entry ending
   * in `*` matches any value that starts with it (a shortened id). The list holds values of known campaigns, so it
   * belongs in the file outside the repository.
   */
  feature: z.object({ name: z.string().min(1), regex: z.string().min(1), alarm: z.array(z.string().min(1)).optional() }).optional(),
  limit: z.number().int().positive().optional(),
  /** Filter that keeps only hits sharing registration facts with a campaign (required for a `certlist` recipe: a regex alone gives hundreds of false hits). */
  confirm: confirmSchema.optional(),
  /** Platform of an ad-library recipe (meta, google, tiktok, x); default: all that work without a key. */
  platform: z.string().optional(),
});

export const watchRecipesFileSchema = z.object({
  version: z.literal(1).optional(),
  recipes: z.array(watchRecipeSchema),
});

export type WatchRecipe = z.infer<typeof watchRecipeSchema>;
export type ConfirmRule = z.infer<typeof confirmSchema>;

/**
 * Recipes from parsed JSON (a bare array or `{ recipes: [...] }`). A recipe with a wrong shape, a duplicate id,
 * a `certlist` recipe without `confirm` or an invalid regular expression is an error naming the recipe: a typo
 * must not silently turn a recipe off.
 */
export function parseRecipes(json: unknown): WatchRecipe[] {
  const parsed = watchRecipesFileSchema.safeParse(Array.isArray(json) ? { recipes: json } : json);
  if (!parsed.success) throw new Error(`recipes: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const seen = new Set<string>();
  for (const r of parsed.data.recipes) {
    if (seen.has(r.id)) throw new Error(`recipes: repeated ID “${r.id}”`);
    seen.add(r.id);
    if (r.source === "certlist" && !r.confirm) throw new Error(`recipe “${r.id}”: the CERT list needs a confirm filter (registrar, NS or registration time); a regex alone gives hundreds of false hits`);
    for (const [what, pattern] of [["query", r.source === "certlist" || r.source === "ct" ? r.query : null], ["feature.regex", r.feature?.regex ?? null]] as const) {
      if (!pattern) continue;
      try {
        new RegExp(pattern, "i");
      } catch (e) {
        throw new Error(`recipe “${r.id}”: bad regex in ${what} (${(e as Error).message})`);
      }
    }
  }
  return parsed.data.recipes;
}

/** Reads and validates a recipes file (the path comes from `--recipes` or `WATCH_RECIPES`). */
export function loadRecipes(file: string): WatchRecipe[] {
  return parseRecipes(JSON.parse(readFileSync(file, "utf8")));
}

/** Registration facts of a domain, the input of `confirmByRegistration` (from RDAP and DNS). */
export interface RegistrationFacts {
  registrar: string | null;
  /** ISO time of registration (RDAP `created`). */
  created: string | null;
  nameservers: string[];
}

/**
 * Which of the recipe's registration conditions a domain meets: the filter that makes a pattern hit (a regex over
 * thousands of new domains) credible. Returns the matching kinds as human-readable confirmations; `ok` is true when
 * at least `minMatches` kinds (default all kinds the rule names) match. A rule that names nothing never confirms.
 */
export function confirmByRegistration(rule: ConfirmRule, facts: RegistrationFacts): { ok: boolean; confirmations: string[] } {
  const confirmations: string[] = [];
  let named = 0;
  if (rule.registrars?.length) {
    named++;
    const hit = rule.registrars.find((r) => facts.registrar?.toLowerCase().includes(r.toLowerCase()));
    if (hit) confirmations.push(`same registrar (${facts.registrar})`);
  }
  if (rule.nameserverPairs?.length) {
    named++;
    const ns = new Set(facts.nameservers.map((n) => n.toLowerCase().replace(/\.$/, "")));
    const pair = rule.nameserverPairs.find((p) => p.every((n) => ns.has(n.toLowerCase().replace(/\.$/, ""))));
    if (pair) confirmations.push(`same name server pair (${pair.join(", ")})`);
  }
  if (rule.registeredHoursUtc) {
    named++;
    const t = facts.created ? Date.parse(facts.created) : NaN;
    if (Number.isFinite(t)) {
      const h = new Date(t).getUTCHours();
      const { from, to } = rule.registeredHoursUtc;
      if (from <= to ? h >= from && h <= to : h >= from || h <= to) confirmations.push(`registered within the hour window ${from}–${to} UTC (${h}:00)`);
    }
  }
  const need = Math.min(rule.minMatches ?? named, named);
  return { ok: named > 0 && confirmations.length >= need, confirmations };
}

/**
 * Value of a recipe's feature in a list of request addresses (the first capture group, or the whole match without
 * groups) and whether it triggers an alarm. Null when the recipe has no feature or no request carries it.
 */
export function extractFeature(recipe: WatchRecipe, requestUrls: string[]): { value: string; alarm: boolean } | null {
  if (!recipe.feature) return null;
  const re = new RegExp(recipe.feature.regex, "i");
  for (const url of requestUrls) {
    const m = re.exec(url);
    if (!m) continue;
    const value = (m[1] ?? m[0]).toLowerCase();
    return { value, alarm: recipe.feature.alarm ? recipe.feature.alarm.some((a) => (a.endsWith("*") ? value.startsWith(a.slice(0, -1).toLowerCase()) : a.toLowerCase() === value)) : true };
  }
  return null;
}
