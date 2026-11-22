/**
 * Public company registers behind the `--company-registry` flag (default OFF, network only): the VAT
 * taxpayer white list of the Polish Ministry of Finance (by NIP) and the current extract of the National
 * Court Register, KRS (by KRS number). Neither needs a key. CEIDG is skipped (it needs an account and a token).
 *
 * A lookup sends a number read from a page to a third-party service, so it is never run on case data
 * without the data owner's consent (the CLI prints a warning; the flag is not part of any default run).
 * Only company data is kept: name, address of the seat, status, dates. Representatives, partners and every
 * other personal field of the answers are dropped by the parsers and never stored or cached.
 *
 * The flags are explanations for the analyst, not evidence of a campaign and without weight in the graph:
 * a real firm can have a different trading name, a new seat or a young company.
 *
 * `parseVatWhitelist`, `parseKrsExtract` and `evaluateCompanyRegistry` are pure; `lookupVatWhitelist` and
 * `lookupKrs` do one HTTPS GET each (cached, the white list allows 100 searches a day).
 */
import { CACHE_TTL, createCache, type FileCache } from "../cache";
import { foldDiacritics } from "../text/normalize";

/** What the registry says about a company; no personal data. */
export interface CompanyRegistryRecord {
  source: "vat" | "krs";
  /** The identifier asked for (NIP or KRS number, digits). */
  id: string;
  /** False when the registry has no such number. */
  found: boolean;
  name: string | null;
  /** Address of the seat as one line, or null. */
  address: string | null;
  /** Postal code of the seat ("00-001"), or null. */
  postalCode: string | null;
  /** Registry status: the VAT status ("Czynny", "Zwolniony", "Niezarejestrowany") or "wpisany" / "wykreślony" for KRS. */
  status: string | null;
  /** Date of registration (YYYY-MM-DD), or null. */
  registeredAt: string | null;
  /** Date of removal (YYYY-MM-DD), or null. */
  removedAt: string | null;
  /** When the registry was asked (UTC ISO). */
  fetchedAt: string | null;
  error: string | null;
}

export type CompanyRegistryFlag = "companyNameMismatch" | "companyAddressMismatch" | "companyRemoved" | "companyRecent" | "companyYoungerThanDomain" | "domainYoungerThanCompany";

/** Flags of a material and one sentence of evidence per flag. */
export interface CompanyRegistryAssessment {
  flags: CompanyRegistryFlag[];
  details: Partial<Record<CompanyRegistryFlag, string>>;
}

/** What the page and the dataset say, to compare with the registry. */
export interface CompanyRegistryContext {
  /** Names the page uses for itself: legal entities, footer name, title. */
  brandNames: string[];
  /** Full addresses read from the page (postal code and street with number). */
  pageAddresses: Array<{ street: string; number: string; postalCode: string }>;
  /** ISO time the material was first seen. */
  firstSeen: string | null | undefined;
  /** RDAP creation date of the shop domain. */
  domainCreated: string | null | undefined;
}

export interface CompanyRegistryConfig {
  /** A company registered fewer days before `firstSeen` is "recent". */
  recentDays: number;
  /** The company was registered more than this many days after the domain. */
  companyYoungerGapDays: number;
  /** A company at least this old (years) behind a domain at most `youngDomainDays` old. */
  oldCompanyYears: number;
  youngDomainDays: number;
  /** VAT statuses that count as "removed" (folded: lower case, no diacritics). */
  removedVatStatuses: string[];
  /** Legal-form words dropped before names are compared (folded). */
  legalFormWords: string[];
  /** Share of the shorter name's words that must be in the other name to agree. */
  nameAgreeShare: number;
  /** Most identifiers of one kind asked per material. */
  maxIdsPerMaterial: number;
}

export const DEFAULT_COMPANY_REGISTRY_CONFIG: CompanyRegistryConfig = {
  recentDays: 180,
  companyYoungerGapDays: 30,
  oldCompanyYears: 5,
  youngDomainDays: 90,
  removedVatStatuses: ["wykreslony", "niezarejestrowany"],
  legalFormWords: ["sp", "z", "o", "oo", "sa", "s", "a", "k", "j", "p", "spolka", "akcyjna", "komandytowa", "jawna", "ltd", "limited", "gmbh", "llc", "inc", "sklep", "internetowy", "sklepu", "the"],
  nameAgreeShare: 0.5,
  maxIdsPerMaterial: 2,
};

const DAY_MS = 86_400_000;

type Json = Record<string, unknown>;

/** The value as an object, or null. */
function obj(v: unknown): Json | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}

/** The value as a trimmed non-empty string, or null. */
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** An empty record for an identifier (the base of every parse result). */
function emptyRecord(source: "vat" | "krs", id: string, fetchedAt: string | null): CompanyRegistryRecord {
  return { source, id, found: false, name: null, address: null, postalCode: null, status: null, registeredAt: null, removedAt: null, fetchedAt, error: null };
}

/** Date as YYYY-MM-DD from "YYYY-MM-DD…" or "DD.MM.YYYY"; null when neither. */
function isoDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (a) return `${a[1]}-${a[2]}-${a[3]}`;
  const b = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s);
  return b ? `${b[3]}-${b[2]}-${b[1]}` : null;
}

/** First postal code ("00-001") in a text, or null. */
function postalCodeOf(text: string | null): string | null {
  return text ? (/\b\d{2}-\d{3}\b/.exec(text)?.[0] ?? null) : null;
}

/**
 * Parses the answer of the white list (`/api/search/nip/{nip}`): name, seat address, VAT status, dates.
 * Representatives, clerks and partners in the answer are ignored. Never throws; a `subject` of null means
 * the number is not in the register.
 */
export function parseVatWhitelist(json: unknown, nip: string, fetchedAt: string | null = null): CompanyRegistryRecord {
  const rec = emptyRecord("vat", nip, fetchedAt);
  const subject = obj(obj(obj(json)?.result)?.subject);
  if (!subject) return rec;
  const address = str(subject.workingAddress) ?? str(subject.residenceAddress);
  return {
    ...rec,
    found: true,
    name: str(subject.name),
    address,
    postalCode: postalCodeOf(address),
    status: str(subject.statusVat),
    registeredAt: isoDate(subject.registrationLegalDate),
    removedAt: isoDate(subject.removalDate),
  };
}

/**
 * Parses the current KRS extract (`/api/krs/OdpisAktualny/{krs}`): name, seat address, date of entry and
 * removal. Bodies of the management and the partners are never read. Never throws; an answer without an
 * extract means the number is not in the register.
 */
export function parseKrsExtract(json: unknown, krs: string, fetchedAt: string | null = null): CompanyRegistryRecord {
  const rec = emptyRecord("krs", krs, fetchedAt);
  const odpis = obj(obj(json)?.odpis);
  if (!odpis) return rec;
  const head = obj(odpis.naglowekA);
  const d1 = obj(obj(odpis.dane)?.dzial1);
  const seat = obj(d1?.siedzibaIAdres);
  const adr = obj(seat?.adres);
  const street = [str(adr?.ulica), str(adr?.nrDomu) ? `${str(adr?.nrDomu)}${str(adr?.nrLokalu) ? `/${str(adr?.nrLokalu)}` : ""}` : null].filter(Boolean).join(" ");
  const postalCode = str(adr?.kodPocztowy);
  const city = str(adr?.miejscowosc);
  const address = [street, [postalCode, city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
  const removedAt = isoDate(head?.dataWykreslenia) ?? isoDate(obj(obj(odpis.dane)?.dzial6)?.dataWykreslenia) ?? isoDate(obj(head?.wykreslenie)?.data);
  return {
    ...rec,
    found: true,
    name: str(obj(d1?.danePodmiotu)?.nazwa),
    address,
    postalCode,
    status: removedAt ? "wykreślony" : "wpisany",
    registeredAt: isoDate(head?.dataRejestracjiWKRS),
    removedAt,
  };
}

/** Words of a name: folded, no punctuation, legal-form words and one-letter words dropped. */
function nameWords(name: string, cfg: CompanyRegistryConfig): string[] {
  const drop = new Set(cfg.legalFormWords);
  return foldDiacritics(name.toLowerCase())
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !drop.has(w));
}

/** Two names agree when enough of the shorter one's words are in the other (or one contains the other glued). */
function namesAgree(a: string, b: string, cfg: CompanyRegistryConfig): boolean {
  const wa = nameWords(a, cfg);
  const wb = nameWords(b, cfg);
  if (!wa.length || !wb.length) return true;
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const longJoined = long.join("");
  const hit = short.filter((w) => long.includes(w) || (w.length >= 4 && longJoined.includes(w))).length;
  return hit / short.length >= cfg.nameAgreeShare || (short.join("").length >= 4 && longJoined.includes(short.join("")));
}

/** Whole days from `from` to `to`; null when either is not a date. */
function daysBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = Date.parse(from ?? "");
  const b = Date.parse(to ?? "");
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.floor((b - a) / DAY_MS);
}

/** A page address agrees with the registry seat: same postal code, or the same street word and number. */
function addressAgrees(page: CompanyRegistryContext["pageAddresses"][number], rec: CompanyRegistryRecord): boolean {
  if (rec.postalCode && page.postalCode && rec.postalCode.replace("-", "") === page.postalCode.replace("-", "")) return true;
  const hay = foldDiacritics((rec.address ?? "").toLowerCase());
  const street = foldDiacritics(page.street.toLowerCase()).split(/\s+/).filter((w) => w.length > 2).pop();
  return !!street && hay.includes(street) && new RegExp(`(?<![\\d])${page.number.replace(/[^\w/]/g, "")}(?![\\d])`).test(hay);
}

/**
 * Compares the registry records of a material with what the page and the dataset say. Only records that
 * were found (without an error) count. One sentence of evidence per flag that holds.
 */
export function evaluateCompanyRegistry(records: CompanyRegistryRecord[], ctx: CompanyRegistryContext, cfg: CompanyRegistryConfig = DEFAULT_COMPANY_REGISTRY_CONFIG): CompanyRegistryAssessment {
  const flags = new Set<CompanyRegistryFlag>();
  const details: Partial<Record<CompanyRegistryFlag, string>> = {};
  const raise = (f: CompanyRegistryFlag, text: string) => {
    if (!flags.has(f)) {
      flags.add(f);
      details[f] = text;
    }
  };
  for (const r of records.filter((x) => x.found && !x.error)) {
    const label = `${r.source === "vat" ? "NIP" : "KRS"} ${r.id}`;
    if (r.name && ctx.brandNames.length && !ctx.brandNames.some((b) => namesAgree(b, r.name!, cfg))) {
      raise("companyNameMismatch", `${label}: w rejestrze „${r.name}”, na stronie „${ctx.brandNames[0]}”`);
    }
    if (r.address && ctx.pageAddresses.length && !ctx.pageAddresses.some((a) => addressAgrees(a, r))) {
      raise("companyAddressMismatch", `${label}: siedziba w rejestrze ${r.address}, na stronie ${ctx.pageAddresses[0].street} ${ctx.pageAddresses[0].number}, ${ctx.pageAddresses[0].postalCode}`);
    }
    const vatRemoved = r.source === "vat" && r.status !== null && cfg.removedVatStatuses.includes(foldDiacritics(r.status.toLowerCase()));
    if (r.removedAt || vatRemoved) raise("companyRemoved", `${label}: ${r.removedAt ? `wykreślona ${r.removedAt}` : `status VAT „${r.status}”`}`);
    const age = daysBetween(r.registeredAt, ctx.firstSeen);
    if (age !== null && age >= 0 && age < cfg.recentDays) raise("companyRecent", `${label}: zarejestrowana ${age} dni przed pierwszym zapisem materiału`);
    const gap = daysBetween(ctx.domainCreated, r.registeredAt);
    if (gap !== null && gap > cfg.companyYoungerGapDays) raise("companyYoungerThanDomain", `${label}: firma zarejestrowana ${r.registeredAt}, ${gap} dni po domenie sklepu`);
    const domainAge = daysBetween(ctx.domainCreated, ctx.firstSeen);
    const companyYears = age === null ? null : age / 365;
    if (domainAge !== null && domainAge >= 0 && domainAge <= cfg.youngDomainDays && companyYears !== null && companyYears >= cfg.oldCompanyYears) {
      raise("domainYoungerThanCompany", `${label}: firma z ${r.registeredAt}, a domena sklepu ma ${domainAge} dni`);
    }
  }
  const order: CompanyRegistryFlag[] = ["companyNameMismatch", "companyAddressMismatch", "companyRemoved", "companyRecent", "companyYoungerThanDomain", "domainYoungerThanCompany"];
  const held = order.filter((f) => flags.has(f));
  return { flags: held, details: Object.fromEntries(held.map((f) => [f, details[f]])) as CompanyRegistryAssessment["details"] };
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RegistryLookupOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Cache of parsed records; `false` disables it. Default: namespace "company-registry", TTL one day. */
  cache?: FileCache | false;
  /** Clock override for tests (ms). */
  now?: () => number;
}

const USER_AGENT = "odcisk-kampanii (passive company register lookup)";
let defaultCache: FileCache | null = null;

/** The default cache of parsed records (no personal data). */
function getDefaultCache(): FileCache {
  if (!defaultCache) defaultCache = createCache({ namespace: "company-registry", defaultTtlMs: CACHE_TTL.dns });
  return defaultCache;
}

/** One cached GET: a 404 is "not found", any other failure comes back as a record with `error`, never thrown. */
async function lookup(source: "vat" | "krs", id: string, url: string, parse: (json: unknown, fetchedAt: string) => CompanyRegistryRecord, opts: RegistryLookupOptions): Promise<CompanyRegistryRecord> {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const run = async (): Promise<CompanyRegistryRecord> => {
    const fetchedAt = new Date(opts.now?.() ?? Date.now()).toISOString();
    try {
      const res = await fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) });
      if (res.status === 404 || res.status === 400) return emptyRecord(source, id, fetchedAt);
      if (!res.ok) return { ...emptyRecord(source, id, fetchedAt), error: `HTTP ${res.status}` };
      return parse(await res.json(), fetchedAt);
    } catch (e) {
      return { ...emptyRecord(source, id, fetchedAt), error: e instanceof Error ? e.message : String(e) };
    }
  };
  if (opts.cache === false) return run();
  return (opts.cache ?? getDefaultCache()).wrap(`${source}:${id}`, run, { shouldCache: (r) => !r.error });
}

/** Looks a NIP up in the VAT white list as of `date` (YYYY-MM-DD). */
export function lookupVatWhitelist(nip: string, date: string, opts: RegistryLookupOptions = {}): Promise<CompanyRegistryRecord> {
  return lookup("vat", nip, `https://wl-api.mf.gov.pl/api/search/nip/${encodeURIComponent(nip)}?date=${date}`, (j, at) => parseVatWhitelist(j, nip, at), opts);
}

/** Looks a KRS number up in the current extract of the register of entrepreneurs. */
export function lookupKrs(krs: string, opts: RegistryLookupOptions = {}): Promise<CompanyRegistryRecord> {
  return lookup("krs", krs, `https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/${encodeURIComponent(krs)}?rejestr=P&format=json`, (j, at) => parseKrsExtract(j, krs, at), opts);
}
