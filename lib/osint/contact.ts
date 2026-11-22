/**
 * Attributes of the contact data of a shop page: what kind of domain each e-mail address has, how
 * complete the postal address is, and whether a landline's area code fits the city of the address.
 *
 * None of them is a trace by itself. A free mailbox (gmail, wp.pl) or another domain than the shop's is
 * context for the analyst ("promo shop with a gmail address"); the domain of another address is read by
 * the enrichment like any linked domain. The address as a trace is `postal_address` (lib/text/postalAddress.ts).
 * Pure functions on text and markup.
 */
import { extractPostalAddresses, addressKey, type AddressCompleteness, type PostalAddress } from "../text/postalAddress";
import { foldDiacritics } from "../text/normalize";
import { registrableDomain } from "./urls";

/** Kind of the domain in an e-mail address, relative to the page that shows it. */
export type EmailDomainKind = "free_mail" | "site" | "other_domain";

export interface ContactConfig {
  /** Registrable domains of free mailbox providers. */
  freeMailDomains: string[];
  /** Polish landline area codes (two digits after +48) by the cities they serve (lower case, no diacritics). */
  phoneAreas: Record<string, string[]>;
}

export const DEFAULT_CONTACT_CONFIG: ContactConfig = {
  freeMailDomains: [
    "gmail.com", "googlemail.com", "outlook.com", "outlook.pl", "hotmail.com", "hotmail.co.uk", "live.com", "msn.com", "yahoo.com", "yahoo.pl", "ymail.com",
    "wp.pl", "o2.pl", "onet.pl", "onet.eu", "op.pl", "interia.pl", "interia.eu", "poczta.fm", "tlen.pl", "vp.pl", "proton.me", "protonmail.com", "pm.me",
    "gmx.com", "gmx.de", "gmx.net", "gmx.at", "mail.ru", "bk.ru", "inbox.ru", "list.ru", "yandex.ru", "yandex.com", "qq.com", "163.com", "126.com",
    "icloud.com", "me.com", "aol.com", "web.de", "t-online.de", "seznam.cz", "email.cz", "centrum.cz", "azet.sk", "zoznam.sk", "freemail.hu", "citromail.hu", "mail.com",
  ],
  phoneAreas: {
    "12": ["krakow", "wieliczka"],
    "14": ["tarnow"],
    "17": ["rzeszow"],
    "18": ["nowy sacz", "nowy targ", "zakopane"],
    "22": ["warszawa", "piaseczno", "pruszkow"],
    "24": ["plock"],
    "32": ["katowice", "gliwice", "zabrze", "sosnowiec", "bytom", "ruda slaska"],
    "33": ["bielsko-biala", "oswiecim"],
    "34": ["czestochowa"],
    "41": ["kielce"],
    "42": ["lodz"],
    "43": ["sieradz"],
    "52": ["bydgoszcz", "torun"],
    "54": ["wloclawek"],
    "55": ["elblag", "malbork"],
    "56": ["grudziadz"],
    "58": ["gdansk", "gdynia", "sopot", "wejherowo"],
    "59": ["slupsk"],
    "61": ["poznan"],
    "62": ["kalisz"],
    "63": ["konin"],
    "65": ["leszno"],
    "67": ["pila"],
    "68": ["zielona gora"],
    "71": ["wroclaw"],
    "74": ["walbrzych"],
    "75": ["jelenia gora"],
    "76": ["legnica"],
    "77": ["opole"],
    "81": ["lublin"],
    "82": ["chelm"],
    "83": ["biala podlaska"],
    "84": ["zamosc"],
    "85": ["bialystok"],
    "86": ["lomza"],
    "87": ["suwalki"],
    "89": ["olsztyn"],
    "91": ["szczecin"],
    "94": ["koszalin"],
    "95": ["gorzow wielkopolski"],
  },
};

export interface EmailDomainInfo {
  email: string;
  /** Registrable domain of the address. */
  domain: string;
  kind: EmailDomainKind;
}

export interface ContactAddress {
  completeness: AddressCompleteness;
  /** Full addresses with their graph key. */
  addresses: Array<PostalAddress & { key: string }>;
  quote: string | null;
}

export interface ContactSignals {
  emailDomains: EmailDomainInfo[];
  /** Registrable domains of the addresses on another domain than the shop's, each once. */
  otherEmailDomains: string[];
  address: ContactAddress;
  /** A landline whose area code belongs to a known city other than the one in the address; null otherwise (P2). */
  phoneAreaMismatch: { phone: string; area: string; city: string } | null;
}

/**
 * Kind of the domain of an e-mail address on a page of `pageHost`: a free mailbox, the shop's own domain
 * (or a subdomain of it), or another domain.
 */
export function classifyEmailDomain(email: string, pageHost: string | null | undefined, cfg: ContactConfig = DEFAULT_CONTACT_CONFIG): EmailDomainKind {
  const host = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  const domain = registrableDomain(host) ?? host;
  if (cfg.freeMailDomains.includes(domain) || cfg.freeMailDomains.includes(host)) return "free_mail";
  const pageDomain = pageHost ? (registrableDomain(pageHost) ?? pageHost.toLowerCase().replace(/^www\./, "")) : null;
  return pageDomain && domain === pageDomain ? "site" : "other_domain";
}

/** Parsed JSON-LD blocks of a document (a block that is not JSON is skipped: broken JSON-LD is common). */
function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const lower = html.toLowerCase();
  for (let i = lower.indexOf("<script"); i >= 0 && out.length < 50; i = lower.indexOf("<script", i + 1)) {
    const open = lower.indexOf(">", i);
    if (open < 0) break;
    if (!lower.slice(i, open).includes("ld+json")) continue;
    const end = lower.indexOf("</script", open);
    try {
      out.push(JSON.parse(html.slice(open + 1, end < 0 ? html.length : end)));
    } catch {
      // not JSON: the block carries no address we can read
    }
  }
  return out;
}

/**
 * A landline number (+48 and a two-digit area code from the table) whose area code belongs to another city
 * than `city`. A mobile number, an area code outside the table and a city outside the table give null:
 * the table is not a complete register, so no verdict is better than a guess.
 */
export function phoneAreaMismatch(phone: string, city: string | null | undefined, cfg: ContactConfig = DEFAULT_CONTACT_CONFIG): { area: string; city: string } | null {
  const m = /^\+48(\d{2})\d{7}$/.exec(phone.replace(/[\s-]/g, ""));
  if (!m || !city) return null;
  const cities = cfg.phoneAreas[m[1]];
  const folded = foldDiacritics(city.toLowerCase()).replace(/\s+/g, " ").trim();
  if (!cities) return null;
  const known = Object.values(cfg.phoneAreas).some((list) => list.includes(folded));
  return known && !cities.includes(folded) ? { area: m[1], city } : null;
}

/**
 * Contact attributes of a page: the domain kind of each e-mail address, the completeness of the postal
 * address (text and JSON-LD), and the area-code check of a landline against the city of the address.
 */
export function extractContactSignals(input: { html: string; text: string; url?: string | null; emails: string[]; phones: string[] }, cfg: ContactConfig = DEFAULT_CONTACT_CONFIG): ContactSignals {
  let host: string | null = null;
  try {
    host = input.url ? new URL(input.url).hostname : null;
  } catch {
    host = null;
  }
  const emailDomains = input.emails.map((email) => {
    const at = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
    return { email, domain: registrableDomain(at) ?? at, kind: classifyEmailDomain(email, host, cfg) };
  });
  const found = extractPostalAddresses({ text: input.text, jsonLd: jsonLdBlocks(input.html) });
  const addresses = found.addresses.map((a) => ({ ...a, key: addressKey(a) }));
  const city = addresses[0]?.city ?? null;
  let mismatch: ContactSignals["phoneAreaMismatch"] = null;
  for (const phone of input.phones) {
    const r = phoneAreaMismatch(phone, city, cfg);
    if (r) {
      mismatch = { phone, ...r };
      break;
    }
  }
  return {
    emailDomains,
    otherEmailDomains: [...new Set(emailDomains.filter((e) => e.kind === "other_domain").map((e) => e.domain))],
    address: { completeness: found.completeness, addresses, quote: found.quote },
    phoneAreaMismatch: mismatch,
  };
}
