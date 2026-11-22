/**
 * Weak attributes of a shop page and of its domain that explain it without linking it: a TLD that shops
 * rarely use, a domain name in another language than the page, a privacy policy whose controller is not the
 * shop in the footer, a page that imitates a courier and asks for a card.
 *
 * None has a weight in the graph; each is a hint for the analyst. The word lists are small and general, not
 * tuned to any captured page. Pure functions.
 */
import { foldDiacritics } from "../text/normalize";
import { DEFAULT_INFRA_CONFIG } from "./infraSignals";
import { registrableDomain } from "./urls";

export interface SiteAttributesConfig {
  /** TLDs of typical shops (a registrable domain's suffix without the dot); any other is "rare". */
  typicalTlds: string[];
  /** Words of a domain name by language (folded). Loanwords used in every market ("shop", "store", "online") are left out. */
  domainWords: Record<string, string[]>;
  /** Function words by language (folded) used to guess the language of a page without a `lang` attribute. */
  functionWords: Record<string, string[]>;
  /** The page language needs at least this many function words and this many times the runner-up. */
  languageMinHits: number;
  languageDominance: number;
  /** Phrases that introduce the data controller of a privacy policy (folded). */
  controllerPhrases: string[];
  /** Characters after a controller phrase searched for the controller's e-mail address. */
  controllerWindow: number;
  /** Words of a parcel locker or pickup point choice (folded). */
  lockerWords: string[];
  /** Patterns of a card field in the markup (attribute values, folded). */
  cardFieldPatterns: string[];
}

export const DEFAULT_SITE_ATTRIBUTES_CONFIG: SiteAttributesConfig = {
  typicalTlds: ["com", "pl", "eu", "net", "org", "de", "cz", "sk", "ro", "hu", "uk", "co.uk", "fr", "it", "es", "nl", "at", "ch", "shop", "store"],
  domainWords: {
    pl: ["sklep", "tani", "tanie", "oferta", "oferty", "promocja", "wyprzedaz", "hurtownia", "zakupy", "okazje", "kupuj"],
    en: ["deals", "cheap", "best", "discount", "official", "buy", "bargain"],
    de: ["kaufen", "angebot", "angebote", "versand", "geschenk", "gunstig", "billig", "laden"],
    cs: ["obchod", "slevy", "akce", "levne", "nakup", "prodej"],
    sk: ["zlavy", "lacne", "predaj"],
    ro: ["magazin", "reduceri", "oferte", "ieftin", "cumpara"],
    hu: ["akcio", "olcso", "webaruhaz", "vasarlas"],
  },
  functionWords: {
    pl: ["oraz", "jest", "nie", "sie", "dla", "jak", "przez", "tylko", "to", "na", "do", "ze", "nasza", "panstwa"],
    en: ["the", "and", "for", "with", "your", "this", "from", "our", "you", "are"],
    de: ["und", "der", "die", "das", "mit", "fur", "nicht", "ist", "sie", "wir"],
    cs: ["je", "pro", "ktery", "nebo", "jako", "jsou", "nase", "pri", "ale"],
    sk: ["je", "pre", "ktory", "alebo", "ako", "sme", "nase", "pri", "ale"],
    ro: ["si", "pentru", "este", "din", "care", "sunt", "nostru", "dar"],
    hu: ["es", "hogy", "nem", "egy", "van", "meg", "vagy", "mint"],
  },
  languageMinHits: 3,
  languageDominance: 2,
  controllerPhrases: ["administrator danych", "administratorem danych", "administratorem jest", "data controller", "controller of", "verantwortlicher", "verantwortliche stelle", "spravce osobnich udaju", "operator de date"],
  controllerWindow: 250,
  lockerWords: ["paczkomat", "parcel locker", "punkt odbioru", "packstation", "pickup point", "automat paczkowy"],
  cardFieldPatterns: ["cc-number", "card[-_ ]?number", "cardnumber", "numer karty", "nr karty", "\\bcvv\\b", "\\bcvc\\b"],
};

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;

/** Registrable domain of a host or an address's domain part; the text as written when it has none. */
const regDomain = (host: string): string => registrableDomain(host.toLowerCase()) ?? host.toLowerCase();

/** The TLD of the host when it is not in the list of typical shop TLDs; null for a typical one. */
export function tldRare(host: string, cfg: SiteAttributesConfig = DEFAULT_SITE_ATTRIBUTES_CONFIG): string | null {
  const reg = regDomain(host.replace(/^www\./, ""));
  const tld = reg.split(".").slice(1).join(".");
  return tld && !cfg.typicalTlds.includes(tld) ? tld : null;
}

/**
 * Language of a page: the primary subtag of `<html lang>` when it is a language the lists know, otherwise the
 * language whose function words occur most in `text` (at least `languageMinHits`, and `languageDominance` times
 * the runner-up). Null when neither decides.
 */
export function detectPageLanguage(html: string, text: string, cfg: SiteAttributesConfig = DEFAULT_SITE_ATTRIBUTES_CONFIG): string | null {
  const attr = /<html\b[^>]*\blang\s*=\s*["']?([a-zA-Z]{2,3})/i.exec(html.slice(0, 5000))?.[1]?.toLowerCase();
  if (attr && attr in cfg.functionWords) return attr;
  const words = foldDiacritics(text.toLowerCase()).split(/[^a-z]+/).filter(Boolean);
  const score = Object.entries(cfg.functionWords)
    .map(([lang, list]) => [lang, words.filter((w) => list.includes(w)).length] as const)
    .sort((a, b) => b[1] - a[1]);
  const [best, next] = [score[0], score[1]];
  return best && best[1] >= cfg.languageMinHits && best[1] >= cfg.languageDominance * (next?.[1] ?? 0) ? best[0] : null;
}

/**
 * Words of the domain name that belong to another language than the page's: `{ domainLang, pageLang }` when
 * the name holds words of one language (as a whole label or as its start or end) and none of the page's language.
 * Null for a neutral name, an unknown page language, or a name in the page's language.
 */
export function domainLangMismatch(host: string, pageLang: string | null, cfg: SiteAttributesConfig = DEFAULT_SITE_ATTRIBUTES_CONFIG): { domainLang: string; pageLang: string } | null {
  if (!pageLang) return null;
  const core = foldDiacritics(regDomain(host.replace(/^www\./, "")).split(".")[0]);
  const labels = core.split("-");
  const hasWord = (list: string[]) => list.some((w) => labels.some((l) => l === w || (w.length >= 5 && (l.startsWith(w) || l.endsWith(w)))));
  if (hasWord(cfg.domainWords[pageLang] ?? [])) return null;
  const other = Object.entries(cfg.domainWords).find(([lang, list]) => lang !== pageLang && hasWord(list));
  return other ? { domainLang: other[0], pageLang } : null;
}

/**
 * A data controller named in the page text whose e-mail address is on another domain than the shop's and than
 * every other address of the page: `{ controllerDomains }`. Null when no controller phrase has an address
 * after it, when the controller is on the shop's domain or on the domain of another address, or when the page
 * has no other address to compare with (no verdict).
 */
export function privacyControllerMismatch(text: string, emails: string[], shopHost: string, cfg: SiteAttributesConfig = DEFAULT_SITE_ATTRIBUTES_CONFIG): { controllerDomains: string[] } | null {
  const folded = foldDiacritics(text.toLowerCase());
  const controllerEmails = new Set<string>();
  for (const phrase of cfg.controllerPhrases) {
    for (let at = folded.indexOf(phrase); at >= 0; at = folded.indexOf(phrase, at + phrase.length)) {
      // the nearest address after the phrase is the controller's; later ones in the window belong to other parts of the page
      const m = EMAIL.exec(folded.slice(at, at + cfg.controllerWindow));
      if (m) controllerEmails.add(m[0]);
    }
  }
  if (!controllerEmails.size) return null;
  const controllerDomains = [...new Set([...controllerEmails].map((e) => regDomain(e.slice(e.indexOf("@") + 1))))];
  const others = emails.map((e) => e.toLowerCase()).filter((e) => !controllerEmails.has(e)).map((e) => regDomain(e.slice(e.indexOf("@") + 1)));
  const known = new Set([...others, regDomain(shopHost)]);
  if (!others.length || controllerDomains.some((d) => known.has(d))) return null;
  return { controllerDomains };
}

/**
 * A page that imitates a courier or a classifieds site and asks for a card with a parcel locker or pickup
 * point choice: a card field in the markup, a locker word in the text, and a brand from the list (InPost, DPD,
 * OLX ...) in the title or the address.
 */
export function fakeCourierPayment(html: string, url: string, cfg: SiteAttributesConfig = DEFAULT_SITE_ATTRIBUTES_CONFIG): boolean {
  const doc = html.slice(0, 2_000_000);
  const folded = foldDiacritics(doc.toLowerCase());
  const card = [...folded.matchAll(/<input\b[^>]*>/g)].some((m) => cfg.cardFieldPatterns.some((p) => new RegExp(p).test(m[0])));
  if (!card || !cfg.lockerWords.some((w) => folded.includes(w))) return false;
  const title = /<title[^>]*>([^<]{0,200})/.exec(folded)?.[1] ?? "";
  const where = `${title} ${foldDiacritics(url.toLowerCase())}`;
  return DEFAULT_INFRA_CONFIG.pathBrands.some((b) => where.includes(b));
}

/** The weak attributes of a page read together; each is null (or false) when it does not apply. */
export interface SiteAttributes {
  tldRare: string | null;
  domainLangMismatch: { domainLang: string; pageLang: string } | null;
  privacyControllerMismatch: { controllerDomains: string[] } | null;
  fakeCourierPayment: boolean;
}

/** Weak attributes of the page at `url`: its markup, its visible text and the e-mail addresses read from it. */
export function extractSiteAttributes(input: { html: string; text: string; url: string; emails: string[] }, cfg: SiteAttributesConfig = DEFAULT_SITE_ATTRIBUTES_CONFIG): SiteAttributes {
  let host: string;
  try {
    host = new URL(input.url).hostname;
  } catch {
    return { tldRare: null, domainLangMismatch: null, privacyControllerMismatch: null, fakeCourierPayment: false };
  }
  return {
    tldRare: tldRare(host, cfg),
    domainLangMismatch: domainLangMismatch(host, detectPageLanguage(input.html, input.text, cfg), cfg),
    privacyControllerMismatch: privacyControllerMismatch(input.text, input.emails, host, cfg),
    fakeCourierPayment: fakeCourierPayment(input.html, input.url, cfg),
  };
}
