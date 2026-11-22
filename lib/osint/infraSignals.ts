/**
 * Infrastructure attributes of a shop page that explain it without linking it: a known brand in the path of a
 * domain that does not carry it (a clone of a courier or classifieds site), the shop platform, and hosting
 * outside the EU and the EEA.
 *
 * None of them has a weight in the graph. Honest shops run on WordPress and host abroad; the attributes tell
 * the analyst where to look. Pure functions.
 */
import { foldDiacritics } from "../text/normalize";
import { registrableDomain } from "./urls";

export interface InfraConfig {
  /** Brands that scam pages use in the path ("/inpost/…", "/olx/…"), lower case, no diacritics, one word each. */
  pathBrands: string[];
  /** Platform name → patterns on the generator text (lower case) and on the page markup (lower case). */
  cms: Array<{ name: string; generator: string[]; markup: string[] }>;
  /** Country codes of the EU and the EEA. */
  euEea: string[];
}

export const DEFAULT_INFRA_CONFIG: InfraConfig = {
  pathBrands: ["inpost", "olx", "dpd", "dhl", "gls", "ups", "fedex", "vinted", "allegro", "orlen", "pocztex", "poczta", "paczkomat", "revolut", "blik", "paypal", "amazon", "ebay"],
  cms: [
    { name: "wordpress", generator: ["wordpress"], markup: ["/wp-content/", "/wp-includes/", "/wp-json/"] },
    { name: "woocommerce", generator: ["woocommerce"], markup: ["woocommerce"] },
    { name: "shopify", generator: ["shopify"], markup: ["cdn.shopify.com"] },
    { name: "shopline", generator: ["shopline"], markup: ["shopline"] },
    { name: "prestashop", generator: ["prestashop"], markup: ["prestashop"] },
    { name: "magento", generator: ["magento"], markup: ["/static/frontend/magento", "mage/cookies"] },
    { name: "opencart", generator: ["opencart"], markup: ["catalog/view/theme"] },
    { name: "shoper", generator: ["shoper"], markup: ["shoper.pl", "cdn.shoper"] },
    { name: "shoplo", generator: ["shoplo"], markup: ["shoplo.com"] },
    { name: "wix", generator: ["wix.com"], markup: ["static.wixstatic.com"] },
    { name: "squarespace", generator: ["squarespace"], markup: ["static1.squarespace.com"] },
  ],
  euEea: [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
    "IS", "LI", "NO",
  ],
};

/**
 * A brand from the list that stands as a whole path segment (or its first word: "/inpost-paczka/") of the URL,
 * while the domain's name does not contain it. Null when the path names no such brand. The query string does
 * not count: a tracking parameter naming a courier is not a clone of the courier.
 */
export function brandInPath(url: string, cfg: InfraConfig = DEFAULT_INFRA_CONFIG): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const domain = foldDiacritics((registrableDomain(parsed.hostname) ?? parsed.hostname).toLowerCase()).replace(/[^a-z0-9]/g, "");
  for (const segment of parsed.pathname.split("/")) {
    const words = foldDiacritics(decodeURIComponentSafe(segment).toLowerCase()).split(/[^a-z0-9]+/).filter(Boolean);
    const brand = words.length ? cfg.pathBrands.find((b) => words[0] === b) : undefined;
    if (brand && !domain.includes(brand)) return brand;
  }
  return null;
}

/** `decodeURIComponent` that leaves a malformed escape as written. */
function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Shop platforms named by the generator tag or by paths and hosts in the markup, each once, in the order of
 * the list ("wordpress" before "woocommerce"). Empty when the page carries no trace of a platform.
 */
export function detectCms(input: { generator: string | null; html: string }, cfg: InfraConfig = DEFAULT_INFRA_CONFIG): string[] {
  const generator = (input.generator ?? "").toLowerCase();
  const markup = input.html.slice(0, 2_000_000).toLowerCase();
  return cfg.cms.filter((c) => c.generator.some((g) => generator.includes(g)) || c.markup.some((m) => markup.includes(m))).map((c) => c.name);
}

/**
 * The country of the host's addresses when none of them is in the EU or the EEA (the first known country);
 * null when one address is inside, or when no country is known (enrichment gave none: no verdict).
 */
export function hostingOutsideEu(countries: Array<string | null | undefined>, cfg: InfraConfig = DEFAULT_INFRA_CONFIG): string | null {
  const known = countries.filter((c): c is string => !!c).map((c) => c.toUpperCase());
  if (!known.length || known.some((c) => cfg.euEea.includes(c))) return null;
  return known[0];
}
