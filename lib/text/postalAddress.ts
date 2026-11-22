/**
 * Postal address of a shop read from the text of its page or from JSON-LD `PostalAddress`, and the key
 * under which two pages that give the same address meet in the graph (`postal_address`).
 *
 * A real shop gives a street, a number, a postal code and a city. A fake one often gives the city alone,
 * a postal box, a virtual office or another shop's address copied from its footer. The address is a trace
 * that only supports a link: it can be copied from another page, so the graph keeps it out of the joins on
 * its own (`campaignRules.notAloneKinds`).
 *
 * Pure functions on text. Polish forms ("ul. Przykładowa 1/2, 00-001 Miasto") are read in both orders
 * (street first, or postal code and city first); German, Czech and Slovak forms with a street word or a
 * type word are read in the street-first order.
 */
import { foldDiacritics } from "./normalize";

/** How complete an address is; only `full` is a trace. */
export type AddressCompleteness = "full" | "city_only" | "po_box" | "none";

export interface PostalAddress {
  street: string;
  number: string;
  /** Flat or office number after the building number ("1/2", "lok. 2"); not part of the key: one building is one address. */
  flat: string | null;
  /** As written ("00-001"). */
  postalCode: string;
  city: string;
  /** The text the address was read from. */
  quote: string;
}

export interface PostalAddressResult {
  completeness: AddressCompleteness;
  /** Full addresses, each once (by key), at most `MAX_ADDRESSES`. */
  addresses: PostalAddress[];
  /** The text that decided the completeness; null for `none`. */
  quote: string | null;
}

const MAX_ADDRESSES = 3;
const MAX_TEXT = 400_000;

const TYPE = "(?:[Uu]l\\.?|[Uu]lica|[Aa]l\\.?|[Aa]leja|[Aa]leje|[Pp]l\\.?|[Pp]lac|[Oo]s\\.?|[Oo]siedle|[Uu]lice|[Nn]ám\\.?|[Nn]áměstí|[Nn]ámestie)";
const NAME = "[\\p{L}0-9.'’ -]{1,40}?";
const NUM = "\\d{1,4}[A-Za-z]?";
const FLAT = `(?:\\s*/\\s*(${NUM})|\\s+(?:m|lok|lokal)\\.?\\s*(${NUM}))?`;
const ZIP = "(\\d{2}-\\d{3}|\\d{5}|\\d{3}\\s\\d{2})";
const CITY = "(\\p{Lu}[\\p{L}'’-]+(?:\\s+\\p{Lu}[\\p{L}'’-]+){0,2})";
/** Words that follow a city in a footer without being part of it. */
const CITY_TAIL_STOP = new Set(["tel", "telefon", "phone", "email", "mail", "nip", "krs", "regon", "polska", "poland", "kontakt", "godziny", "otwarte"]);

const STREET_FIRST = new RegExp(`(?<![\\p{L}])${TYPE}\\s+(${NAME})\\s+(${NUM})${FLAT}\\s*[,;]?\\s*${ZIP}\\s+${CITY}`, "gu");
const CITY_FIRST = new RegExp(`${ZIP}\\s+${CITY}\\s*[,;]?\\s*${TYPE}\\s+(${NAME})\\s+(${NUM})${FLAT}(?![\\p{L}\\d])`, "gu");
const COMPOUND_STREET = new RegExp(`(?<![\\p{L}])(\\p{Lu}[\\p{L}'’-]*(?:str(?:aße|asse)|gasse|weg|platz|allee))\\.?\\s+(${NUM})\\s*[,;]?\\s*${ZIP}\\s+${CITY}`, "gu");
const PO_BOX = /(?<![\p{L}])(?:skrytka(?:\s+pocztowa)?|skr\.?\s*poczt\.?|p\.?\s?o\.?\s*box|postfach|casella postale|apartado)\s*(?:nr\.?|no\.?|№|#)?\s*\d+/iu;
const CITY_LABELLED = new RegExp(`(?<![\\p{L}])(?:[Aa]dres siedziby|[Aa]dres|[Ss]iedziba|[Aa]ddress|[Ss]itz|[Aa]dresa|[Ss]ídlo|[Ss]ediul)\\s*[:\\-–]\\s*${CITY}(?!\\s+\\p{Ll}|\\s*\\d)`, "u");
const ZIP_CITY = new RegExp(`(?<![\\d-])${ZIP}\\s+${CITY}`, "u");

/** City without the words of a footer that follow it ("Miasto Tel" → "Miasto"). */
function trimCity(city: string): string {
  const words = city.split(/\s+/);
  const stop = words.findIndex((w, i) => i > 0 && CITY_TAIL_STOP.has(foldDiacritics(w.toLowerCase())));
  return (stop > 0 ? words.slice(0, stop) : words).join(" ");
}

/** Street part of a JSON-LD `streetAddress` ("ul. Przykładowa 1/2") as street, number and flat; null without a number. */
function splitStreet(raw: string): { street: string; number: string; flat: string | null } | null {
  const m = new RegExp(`^\\s*(?:${TYPE}\\s+)?(${NAME})\\s+(${NUM})${FLAT}\\s*$`, "u").exec(raw);
  return m ? { street: m[1].trim(), number: m[2], flat: m[3] ?? m[4] ?? null } : null;
}

/** Addresses of JSON-LD nodes of type PostalAddress, and whether one of them names a locality without a street. */
function fromJsonLd(blocks: unknown[]): { full: PostalAddress[]; localityOnly: string | null } {
  const full: PostalAddress[] = [];
  let localityOnly: string | null = null;
  const visit = (v: unknown, depth: number) => {
    if (depth > 8 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v.slice(0, 200)) visit(x, depth + 1);
      return;
    }
    const n = v as Record<string, unknown>;
    const type = n["@type"];
    if (type === "PostalAddress" || (Array.isArray(type) && type.includes("PostalAddress"))) {
      const street = typeof n.streetAddress === "string" ? splitStreet(n.streetAddress) : null;
      const zip = typeof n.postalCode === "string" ? n.postalCode.trim() : "";
      const city = typeof n.addressLocality === "string" ? n.addressLocality.trim() : "";
      if (street && zip && city) full.push({ ...street, postalCode: zip, city, quote: `${String(n.streetAddress)}, ${zip} ${city}` });
      else if (city) localityOnly ??= city;
    }
    for (const x of Object.values(n)) visit(x, depth + 1);
  };
  visit(blocks, 0);
  return { full, localityOnly };
}

/**
 * Reads the postal addresses of a page. `full` needs a street, a number, a postal code and a city; a
 * postal box is `po_box`; a postal code with a city, or a city after a label like "Adres:", is `city_only`.
 * When several kinds are present the most complete wins (full, po_box, city_only).
 */
export function extractPostalAddresses(input: { text?: string | null; jsonLd?: unknown[] }): PostalAddressResult {
  const text = (input.text ?? "").slice(0, MAX_TEXT).replace(/\s+/g, " ");
  const addresses: PostalAddress[] = [];
  const add = (a: PostalAddress) => {
    if (addresses.length < MAX_ADDRESSES && !addresses.some((x) => addressKey(x) === addressKey(a))) addresses.push(a);
  };
  for (const m of text.matchAll(STREET_FIRST)) add({ street: m[1].trim(), number: m[2], flat: m[3] ?? m[4] ?? null, postalCode: m[5], city: trimCity(m[6]), quote: m[0].trim() });
  for (const m of text.matchAll(CITY_FIRST)) add({ street: m[3].trim(), number: m[4], flat: m[5] ?? m[6] ?? null, postalCode: m[1], city: trimCity(m[2]), quote: m[0].trim() });
  for (const m of text.matchAll(COMPOUND_STREET)) add({ street: m[1], number: m[2], flat: null, postalCode: m[3], city: trimCity(m[4]), quote: m[0].trim() });
  const ld = fromJsonLd(input.jsonLd ?? []);
  for (const a of ld.full) add(a);
  if (addresses.length) return { completeness: "full", addresses, quote: addresses[0].quote };
  const box = PO_BOX.exec(text);
  if (box) return { completeness: "po_box", addresses: [], quote: box[0].trim() };
  const city = CITY_LABELLED.exec(text) ?? ZIP_CITY.exec(text);
  if (city) return { completeness: "city_only", addresses: [], quote: city[0].trim() };
  if (ld.localityOnly) return { completeness: "city_only", addresses: [], quote: ld.localityOnly };
  return { completeness: "none", addresses: [], quote: null };
}

/** Words that name the kind of a street and carry no identity ("ul.", "aleja", "plac"). */
const STREET_TYPE_WORDS = new Set(["ul", "ulica", "al", "aleja", "aleje", "pl", "plac", "os", "osiedle", "ulice", "nam", "namesti", "namestie"]);

/** Lower case, no diacritics, words made of letters and digits separated by single spaces. */
function words(s: string): string {
  return foldDiacritics(s.toLowerCase()).replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Key of an address in the graph: street name without its type, building number, postal code (digits)
 * and city, written in lower case without diacritics. "ul. Przykładowa 1/2, 00-001 Miasto" and
 * "ulica PRZYKŁADOWA 1, 00001 Miasto" give the same key; the flat number is left out on purpose
 * (one building is one address, a virtual office hands out flats).
 */
export function addressKey(a: Pick<PostalAddress, "street" | "number" | "postalCode" | "city">): string {
  const street = words(a.street).split(" ").filter((w, i) => !(i === 0 && STREET_TYPE_WORDS.has(w))).join(" ");
  const number = a.number.toLowerCase().replace(/\s/g, "");
  return `${street} ${number}|${a.postalCode.replace(/\D/g, "")}|${words(a.city)}`;
}
