/**
 * Identifiers of a company that a page gives in its footer, terms or seller data: Polish NIP, REGON and
 * KRS, bank accounts (IBAN of any country, Polish NRB), EU VAT numbers, the number of a UK company, LEI,
 * and names with a legal form. Fake shops and "broker" pages copy a real firm's data or invent it, so
 * the same number on two pages is a shared template or a shared recipient of money, and a made-up NIP
 * does not pass its checksum. An identifier is a trace that only supports a link (the graph keeps it
 * out of `campaignRules` joins on its own): anyone can copy a firm's data.
 *
 * Pure functions on text. An identifier is read only next to its label ("NIP", "REGON", "konto" ...),
 * because ten or twenty-six bare digits are an order number or a parcel; an IBAN needs no label when its
 * checksum holds. Checksums are checked where the number has one (NIP, REGON, IBAN, LEI); the rest are
 * checked by format only, which `check` says.
 */

/** Kind of an identifier; `nrb` is a Polish account given without the country code (written as an IBAN). */
export type CompanyIdKind = "nip" | "regon" | "krs" | "iban" | "nrb" | "vat" | "uk_company" | "lei";

/** Where on the page the identifier was found. */
export type CompanyIdSource = "text" | "html" | "jsonld" | "ocr";

export interface CompanyId {
  kind: CompanyIdKind;
  /** Normalised: digits for NIP, REGON and KRS; upper case without spaces for accounts, VAT and company numbers. */
  value: string;
  /** The identifier passes its check; a made-up number fails it. */
  valid: boolean;
  /** What `valid` rests on: a checksum, or only the format of the number (KRS, VAT outside Poland, UK). */
  check: "checksum" | "format";
  source: CompanyIdSource;
  /** The text around the number, as read (at most `quoteMax` characters). */
  quote: string;
}

export interface CompanyIdsResult {
  companyIds: CompanyId[];
  /** Names with a legal form ("Fikcyjny Sklep Sp. z o.o."). */
  legalEntities: string[];
  /** Some identifier fails its check: a made-up or mistyped number. */
  companyIdInvalid: boolean;
  /** Why a source was skipped (a JSON-LD block that is not JSON). */
  notes: string[];
}

export interface CompanyIdConfig {
  /** Labels (lower case) that introduce an identifier of a kind. */
  labels: { nip: string[]; regon: string[]; krs: string[]; account: string[]; vat: string[]; ukCompany: string[] };
  /** Most characters between a label and its number ("KRS pod numerem 0000123456"). */
  labelGap: number;
  /** Length of an IBAN by country; a country not listed is read only when the whole candidate passes mod 97. */
  ibanLengths: Record<string, number>;
  /** Format of an EU VAT number after the country code, by country (a regular expression, whole match). */
  vatFormats: Record<string, string>;
  /** Legal forms after a company name, as a regular expression source (case-sensitive). */
  legalForms: string;
  quoteMax: number;
  maxLegalEntities: number;
}

export const DEFAULT_COMPANY_ID_CONFIG: CompanyIdConfig = {
  labels: {
    nip: ["nip", "n.i.p.", "numer identyfikacji podatkowej"],
    regon: ["regon"],
    krs: ["krs", "krajowy rejestr sądowy"],
    account: ["iban", "konto", "rachunek", "nr konta", "numer konta", "numer rachunku", "nr rachunku", "account", "bank account", "nrb"],
    vat: ["vat id", "vat no", "vat number", "vat reg", "vat", "ust-idnr", "ust.-idnr", "ustid", "uid", "tva", "iva", "btw", "mwst", "umsatzsteuer"],
    ukCompany: ["company no", "company number", "registration no", "registration number", "registered number", "registered no", "company registration number"],
  },
  labelGap: 16,
  ibanLengths: { PL: 28, DE: 22, GB: 22, FR: 27, ES: 24, IT: 27, NL: 18, BE: 16, AT: 20, CZ: 24, SK: 24, LT: 20, LV: 21, EE: 20, HU: 28, RO: 24, BG: 22, HR: 21, SI: 19, PT: 25, IE: 22, LU: 20, DK: 18, SE: 24, FI: 18, NO: 15, CH: 21, GR: 27, CY: 28, MT: 31, LI: 21, UA: 29, MD: 24, TR: 26 },
  vatFormats: {
    AT: "U\\d{8}", BE: "0\\d{9}", BG: "\\d{9,10}", CY: "\\d{8}[A-Z]", CZ: "\\d{8,10}", DE: "\\d{9}", DK: "\\d{8}", EE: "\\d{9}", EL: "\\d{9}", GR: "\\d{9}",
    ES: "[A-Z0-9]\\d{7}[A-Z0-9]", FI: "\\d{8}", FR: "[A-Z0-9]{2}\\d{9}", HR: "\\d{11}", HU: "\\d{8}", IE: "\\d[A-Z0-9+*]\\d{5}[A-Z]", IT: "\\d{11}",
    LT: "(?:\\d{9}|\\d{12})", LU: "\\d{8}", LV: "\\d{11}", MT: "\\d{8}", NL: "\\d{9}B\\d{2}", PL: "\\d{10}", PT: "\\d{9}", RO: "\\d{2,10}", SE: "\\d{12}", SI: "\\d{8}", SK: "\\d{10}",
  },
  legalForms:
    "[Ss]p\\.\\s?z\\s?o\\.\\s?o\\.|[Ss]p\\.\\s?k\\.|[Ss]p\\.\\s?j\\.|[Ss]p\\.\\s?p\\.|S\\.\\s?A\\.|GmbH(?:\\s?&\\s?Co\\.?\\s?KG)?|Ltd(?![\\p{L}])|Limited|LLC|OÜ|[Ss]\\.\\s?r\\.\\s?o\\.|B\\.\\s?V\\.|N\\.\\s?V\\.|S\\.\\s?r\\.\\s?l\\.|Sàrl|Inc(?![\\p{L}])|UAB|SIA|Kft(?![\\p{L}])|d\\.o\\.o\\.|Oy(?![\\p{L}])",
  quoteMax: 80,
  maxLegalEntities: 10,
};

/** Weights of the NIP checksum (first nine digits). */
const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];
const REGON9_WEIGHTS = [8, 9, 2, 3, 4, 5, 6, 7];
const REGON14_WEIGHTS = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8];

/** Weighted sum of the leading digits of `digits` modulo 11. */
function weightedMod11(digits: string, weights: number[]): number {
  return weights.reduce((sum, w, i) => sum + w * Number(digits[i]), 0) % 11;
}

/** NIP: ten digits whose weighted sum modulo 11 equals the last digit (remainder 10 never does, such a number is not issued). */
export function nipValid(digits: string): boolean {
  if (!/^\d{10}$/.test(digits) || /^0+$/.test(digits)) return false;
  const r = weightedMod11(digits, NIP_WEIGHTS);
  return r !== 10 && r === Number(digits[9]);
}

/** REGON of 9 or 14 digits: weighted sum modulo 11 of the leading digits is the last digit, remainder 10 giving 0. */
export function regonValid(digits: string): boolean {
  if (!/^(?:\d{9}|\d{14})$/.test(digits) || /^0+$/.test(digits)) return false;
  const r = weightedMod11(digits, digits.length === 9 ? REGON9_WEIGHTS : REGON14_WEIGHTS) % 10;
  return r === Number(digits[digits.length - 1]);
}

/** ISO 7064 mod 97-10 of a string of letters and digits (letters count 10..35), as used by IBAN and LEI: the value is 1 when valid. */
function mod97(s: string): number {
  let rem = 0;
  for (const ch of s) rem = Number(`${rem}${parseInt(ch, 36)}`) % 97;
  return rem;
}

/** IBAN: country code, check digits, the length known for the country (when it is known) and the mod 97 check. */
export function ibanValid(iban: string, cfg: CompanyIdConfig = DEFAULT_COMPANY_ID_CONFIG): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const expected = cfg.ibanLengths[iban.slice(0, 2)];
  if (expected !== undefined && iban.length !== expected) return false;
  return mod97(iban.slice(4) + iban.slice(0, 4)) === 1;
}

/** LEI (ISO 17442): 20 letters and digits, the last two are check digits (mod 97). */
function leiValid(lei: string): boolean {
  return /^[A-Z0-9]{18}\d{2}$/.test(lei) && mod97(lei) === 1;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Alternation of labels, as whole words (a label inside a longer word does not count). */
const labelRe = (labels: string[]): string => `(?<![\\p{L}\\p{N}])(?:${labels.map(esc).join("|")})(?![\\p{L}\\p{N}])`;
const SEP = "[ \\u00a0-]";

/** The text around a match, shortened to `max` characters and with the whitespace collapsed. */
function quoteOf(match: string, max: number): string {
  const q = match.replace(/\s+/g, " ").trim();
  return q.length > max ? `${q.slice(0, max - 1)}…` : q;
}

/** Characters of `s` up to and including the `n`-th letter or digit (the span of an IBAN inside a longer match). */
function spanOfAlnum(s: string, n: number): string {
  let seen = 0;
  for (let i = 0; i < s.length; i++) {
    if (/[\p{L}\p{N}]/u.test(s[i]) && ++seen === n) return s.slice(0, i + 1);
  }
  return s;
}

/**
 * Identifiers and legal entities in one piece of text, tagged with `source`. Pure. A labelled number is
 * read after its label within `labelGap` characters; an IBAN is also read without a label when it passes
 * its checks. Every identifier is returned once.
 */
function scanText(text: string, source: CompanyIdSource, cfg: CompanyIdConfig): CompanyId[] {
  const out: CompanyId[] = [];
  const seen = new Set<string>();
  const gap = `[^\\d\\n]{0,${cfg.labelGap}}?`;
  const push = (kind: CompanyIdKind, value: string, valid: boolean, check: CompanyId["check"], match: string) => {
    const group = kind === "iban" || kind === "nrb" ? "bank" : kind;
    const key = `${group}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, value, valid, check, source, quote: quoteOf(match, cfg.quoteMax) });
  };
  const accountLabel = new RegExp(labelRe(cfg.labels.account), "iu");

  // account numbers first: an IBAN with its country code, then the Polish NRB next to an account label
  for (const m of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])([A-Z]{2}\\d{2}(?:${SEP}?[A-Z0-9]{4}){2,7}(?:${SEP}?[A-Z0-9]{1,4})?)(?![\\p{L}\\p{N}])`, "gu"))) {
    const cc = m[1].slice(0, 2);
    const expected = cfg.ibanLengths[cc];
    let iban = m[1].replace(/[  -]/g, "");
    let span = m[1];
    if (expected !== undefined && iban.length > expected) {
      iban = iban.slice(0, expected);
      span = spanOfAlnum(m[1], expected);
    }
    const labelled = accountLabel.test(text.slice(Math.max(0, (m.index ?? 0) - 24), m.index ?? 0));
    const valid = ibanValid(iban, cfg);
    if (valid || (labelled && expected !== undefined)) push("iban", iban, valid, "checksum", span);
  }
  for (const m of text.matchAll(new RegExp(`${labelRe(cfg.labels.account)}${gap}(?<![\\d])(\\d{2}(?:${SEP}?\\d{4}){6})(?!\\d)`, "giu"))) {
    const nrb = `PL${m[1].replace(/[  -]/g, "")}`;
    push("nrb", nrb, ibanValid(nrb, cfg), "checksum", m[0]);
  }

  for (const m of text.matchAll(new RegExp(`${labelRe(cfg.labels.nip)}${gap}(?<!\\d)(\\d{3}${SEP}\\d{3}${SEP}\\d{2}${SEP}\\d{2}|\\d{3}${SEP}\\d{2}${SEP}\\d{2}${SEP}\\d{3}|\\d{10})(?!\\d)`, "giu"))) {
    const nip = m[1].replace(/\D/g, "");
    push("nip", nip, nipValid(nip), "checksum", m[0]);
  }
  for (const m of text.matchAll(new RegExp(`${labelRe(cfg.labels.regon)}${gap}(?<!\\d)(\\d{3}${SEP}?\\d{3}${SEP}?\\d{3}(?:${SEP}?\\d{5})?)(?!\\d)`, "giu"))) {
    const regon = m[1].replace(/\D/g, "");
    push("regon", regon, regonValid(regon), "checksum", m[0]);
  }
  for (const m of text.matchAll(new RegExp(`${labelRe(cfg.labels.krs)}${gap}(?<!\\d)(\\d{10})(?!\\d)`, "giu"))) {
    push("krs", m[1], !/^0+$/.test(m[1]), "format", m[0]);
  }

  for (const m of text.matchAll(new RegExp(`${labelRe(cfg.labels.vat)}[^\\p{L}\\p{N}\\n]{0,6}([A-Z]{2}[ .-]?[A-Z0-9](?:[ .-]?[A-Z0-9]){4,13})(?![\\p{L}\\p{N}])`, "giu"))) {
    if (m[1] !== m[1].toUpperCase()) continue; // the label is read in any case, the number is written in capitals
    const norm = m[1].replace(/[ .-]/g, "");
    const cc = norm.slice(0, 2);
    const body = norm.slice(2);
    const format = cfg.vatFormats[cc];
    if (cc === "PL") {
      const digits = body.replace(/\D/g, "");
      push("nip", digits, nipValid(digits), "checksum", m[0]);
    } else {
      push("vat", norm, format !== undefined && new RegExp(`^(?:${format})$`).test(body), "format", m[0]);
    }
  }
  for (const m of text.matchAll(new RegExp(`${labelRe(cfg.labels.ukCompany)}\\.?[^\\p{L}\\p{N}\\n]{0,4}(\\d{8}|[A-Za-z]{2}\\d{6})(?![\\p{L}\\p{N}])`, "giu"))) {
    if (/^[A-Za-z]/.test(m[1]) && m[1] !== m[1].toUpperCase()) continue;
    push("uk_company", m[1], true, "format", m[0]);
  }
  return out;
}

/** Names with a legal form in `text`, each once, in order of appearance. */
function scanLegalEntities(text: string, cfg: CompanyIdConfig): string[] {
  const re = new RegExp(`((?:\\p{Lu}[\\p{L}0-9&'’-]*\\.?\\s+){0,4}\\p{Lu}[\\p{L}0-9&'’-]*)\\s+(${cfg.legalForms})`, "gu");
  const names: string[] = [];
  for (const m of text.matchAll(re)) {
    const name = `${m[1]} ${m[2]}`.replace(/\s+/g, " ").trim();
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Splits markup in one pass into the text a reader could find (tags replaced by spaces, comments kept: a
 * footer hidden in a comment is still on the page, scripts and styles dropped) and the bodies of the
 * JSON-LD blocks. Linear in the length of the input: an unclosed tag, comment or script ends the scan
 * instead of being searched for again from every opening (pages are untrusted).
 */
function splitMarkup(html: string): { text: string; jsonLd: string[] } {
  const text: string[] = [];
  const jsonLd: string[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      text.push(html.slice(i));
      break;
    }
    text.push(html.slice(i, lt), " ");
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      text.push(html.slice(lt + 4, end < 0 ? undefined : end), " ");
      if (end < 0) break;
      i = end + 3;
      continue;
    }
    const tagEnd = html.indexOf(">", lt);
    if (tagEnd < 0) break;
    const raw = /^<(script|style)(?![a-z0-9])/i.exec(html.slice(lt, lt + 8));
    if (!raw) {
      i = tagEnd + 1;
      continue;
    }
    const close = new RegExp(`</${raw[1]}\\s*>`, "gi");
    close.lastIndex = tagEnd + 1;
    const found = close.exec(html);
    if (/application\/ld\+json/i.test(html.slice(lt, tagEnd))) jsonLd.push(html.slice(tagEnd + 1, found ? found.index : undefined));
    if (!found) break;
    i = found.index + found[0].length;
  }
  return { text: text.join("").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&"), jsonLd };
}

/** Values of a JSON-LD node as text lines the labelled readers understand ("VAT ID: DE123456789"), plus the LEI. */
function jsonLdValues(node: unknown, lines: string[], leis: string[], entities: string[]): void {
  if (Array.isArray(node)) {
    for (const n of node) jsonLdValues(n, lines, leis, entities);
    return;
  }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" || typeof v === "number" ? String(v).trim() || null : null);
  const vat = str(o.vatID);
  if (vat) lines.push(`VAT ID: ${vat}`);
  const tax = str(o.taxID);
  if (tax) lines.push(/^[A-Za-z]{2}/.test(tax) ? `VAT ID: ${tax}` : `NIP: ${tax}`);
  const lei = str(o.leiCode);
  if (lei) leis.push(lei.replace(/\s+/g, "").toUpperCase());
  const ident = o.identifier;
  for (const id of Array.isArray(ident) ? ident : ident ? [ident] : []) {
    if (id && typeof id === "object") {
      const p = id as Record<string, unknown>;
      const label = str(p.propertyID) ?? str(p.name);
      const value = str(p.value);
      if (label && value) lines.push(`${label}: ${value}`);
    }
  }
  const legal = str(o.legalName);
  if (legal) entities.push(legal);
  for (const v of Object.values(o)) if (v && typeof v === "object") jsonLdValues(v, lines, leis, entities);
}

/**
 * Identifiers and legal entities of a page from its visible text, its markup, its JSON-LD blocks and the
 * OCR of screenshots. Markup adds what the visible text lacks (hidden elements, comments); JSON-LD reads
 * `vatID`, `taxID`, `leiCode`, `identifier` and `legalName`; OCR gives the same labelled numbers from a
 * picture. An identifier found in several places is kept once, with the first source in the order text,
 * JSON-LD, markup, OCR. A JSON-LD block that is not JSON is skipped and `notes` says so.
 */
export function extractCompanyIds(input: { text?: string | null; html?: string | null; ocr?: string | null }, cfg: CompanyIdConfig = DEFAULT_COMPANY_ID_CONFIG): CompanyIdsResult {
  const ids: CompanyId[] = [];
  const notes: string[] = [];
  const entities: string[] = [];
  const add = (found: CompanyId[]) => {
    for (const c of found) {
      const group = c.kind === "iban" || c.kind === "nrb" ? "bank" : c.kind;
      if (!ids.some((x) => (x.kind === "iban" || x.kind === "nrb" ? "bank" : x.kind) === group && x.value === c.value)) ids.push(c);
    }
  };
  const addEntities = (names: string[]) => {
    for (const n of names) if (!entities.includes(n)) entities.push(n);
  };

  if (input.text) {
    add(scanText(input.text, "text", cfg));
    addEntities(scanLegalEntities(input.text, cfg));
  }
  if (input.html) {
    const lines: string[] = [];
    const leis: string[] = [];
    const legal: string[] = [];
    const { text: markup, jsonLd } = splitMarkup(input.html);
    for (const block of jsonLd) {
      try {
        jsonLdValues(JSON.parse(block), lines, leis, legal);
      } catch (e) {
        notes.push(`JSON-LD pominięty: blok nie jest poprawnym JSON (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    add(scanText(lines.join("\n"), "jsonld", cfg));
    for (const lei of leis) add([{ kind: "lei", value: lei, valid: leiValid(lei), check: "checksum", source: "jsonld", quote: `leiCode: ${lei}` }]);
    addEntities(legal.filter((n) => scanLegalEntities(n, cfg).length > 0));
    add(scanText(markup, "html", cfg));
    addEntities(scanLegalEntities(markup, cfg));
  }
  if (input.ocr) {
    add(scanText(input.ocr, "ocr", cfg));
    addEntities(scanLegalEntities(input.ocr, cfg));
  }
  return { companyIds: ids, legalEntities: entities.slice(0, cfg.maxLegalEntities), companyIdInvalid: ids.some((c) => !c.valid), notes };
}

/**
 * Company data of a material: what the page extract already holds (read from the page's text, markup and
 * JSON-LD when the page was fetched) joined with what the OCR of the screenshots says. One entry per
 * identifier, the page first. Shared by the graph and the evidence pack, so both show the same facts.
 */
export function companyIdsOfMaterial(
  page: { companyIds?: CompanyId[]; legalEntities?: string[]; companyIdNotes?: string[] } | null | undefined,
  ocr: string | null | undefined,
  cfg: CompanyIdConfig = DEFAULT_COMPANY_ID_CONFIG,
): CompanyIdsResult {
  const fromOcr = extractCompanyIds({ ocr }, cfg);
  const bank = (c: CompanyId) => c.kind === "iban" || c.kind === "nrb";
  const companyIds = [...(page?.companyIds ?? []), ...fromOcr.companyIds].filter((c, i, all) => all.findIndex((x) => x.value === c.value && bank(x) === bank(c)) === i);
  return {
    companyIds,
    legalEntities: [...new Set([...(page?.legalEntities ?? []), ...fromOcr.legalEntities])].slice(0, cfg.maxLegalEntities),
    companyIdInvalid: companyIds.some((c) => !c.valid),
    notes: [...(page?.companyIdNotes ?? []), ...fromOcr.notes],
  };
}
