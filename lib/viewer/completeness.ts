/**
 * Data completeness checklist (§8.9): what the material holds and what is missing, with the effect
 * of every gap on the comparison. Built from the case record of provenance.json, the result's
 * errors, skipped entries, notes and `missing`, or from the node data of a material in the base.
 */

export type CheckStatus = "ok" | "missing" | "warn";

export interface CheckItem {
  id: string;
  status: CheckStatus;
  label: string;
  /** Effect of a gap ("Brak zapisanej strony: nie porównamy szablonu …"). */
  effect?: string;
  /** Optional source: its absence does not make the data incomplete. */
  optional?: boolean;
}

export interface Completeness {
  items: CheckItem[];
  /** No required source missing and no warning. */
  complete: boolean;
  /** Short summary for a badge ("dane niepełne: brak strony, brak adresu"). */
  summary: string;
}

/** Case record of provenance.json (fields of ImportedCase that matter here). */
export interface CaseProvenance {
  id?: string;
  caseId?: string;
  landingUrl?: string | null;
  landingInferred?: boolean;
  bodySource?: "har" | "saved-html" | "wayback" | "none";
  har?: string | null;
  harFromCase?: string | null;
  savedHtml?: string | null;
  screenshot?: string | null;
  moreScreenshots?: string[];
  video?: string | null;
  advertiser?: string | null;
  adLibraryId?: string | null;
  firstSeen?: string | null;
}

export interface CompletenessInput {
  provenance?: CaseProvenance | null;
  /** Material features (MaterialItemResult.features) or item node data. */
  features?: Record<string, unknown>;
  errors?: string[];
  /** Skipped entries that belong to this material. */
  skipped?: Array<{ id: string; reason: string }>;
  /** Failed lookups of the import ("rdap:domain", "ct:domain"). */
  failedLookups?: string[];
  /** Backend list of what to add (verdicts insufficient / new_campaign). */
  missing?: string[];
  /** Passive lookups (DNS, RDAP) were on for this run; undefined = unknown. */
  lookups?: boolean;
  /** Domains of the material (to pick its failed lookups). */
  domains?: string[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function hasAny(f: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((k) => {
    const v = f[k];
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== "" && v !== false;
  });
}

/** Plain-Polish text of a technical error, or null to keep the original. */
export function plainError(e: string): string {
  const rdap = /rdap[^a-z0-9]*(?:dla\s+)?([a-z0-9.-]+\.[a-z]{2,})?/i.exec(e);
  if (/rdap/i.test(e)) return `Rejestr domen (RDAP) nie odpowiedział${rdap?.[1] ? ` dla domeny ${rdap[1]}` : ""}: brak daty rejestracji i rejestratora`;
  if (/\bdns\b/i.test(e)) return "Serwery DNS nie odpowiedziały: brak adresu IP i serwerów nazw";
  if (/ocr|tesseract/i.test(e)) return "Nie udało się odczytać tekstu ze zrzutu (OCR)";
  if (/whisper|asr|transkry/i.test(e)) return "Nie udało się przepisać mowy z nagrania";
  if (/ffmpeg|ffprobe|klatk/i.test(e)) return "Nie udało się odczytać klatek nagrania";
  if (/timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed/i.test(e)) return "Zapytanie sieciowe nie powiodło się (brak odpowiedzi)";
  return e;
}

export function completeness(input: CompletenessInput): Completeness {
  const p = input.provenance ?? null;
  const f = input.features ?? {};
  const items: CheckItem[] = [];

  // screenshot
  const shot = !!(p?.screenshot || (p?.moreScreenshots?.length ?? 0) > 0 || str(f.imagePath) || str(f.imageUrl) || str(f.ocrText));
  items.push(
    shot
      ? { id: "screenshot", status: "ok", label: "zrzut reklamy" }
      : { id: "screenshot", status: "missing", label: "zrzut reklamy", effect: "Brak zrzutu: nie porównamy obrazu reklamy ani tekstu ze zrzutu" },
  );

  // page (from HAR or a saved copy)
  const body = p?.bodySource ?? (str(f.domSimhash) || str(f.finalUrl) ? "saved-html" : p ? "none" : undefined);
  if (body === "har") items.push({ id: "page", status: "ok", label: p?.harFromCase ? "strona (z HAR z innej sprawy)" : "strona (z HAR)" });
  else if (body === "saved-html") items.push({ id: "page", status: "ok", label: "strona (z zapisu)" });
  else if (body === "wayback") items.push({ id: "page", status: "ok", label: "strona (kopia z archiwum internetu)" });
  else
    items.push({
      id: "page",
      status: "missing",
      label: "strona docelowa",
      effect: "Brak zapisanej strony: nie porównamy szablonu, formularza ani trackerów; przypisanie opiera się na obrazie i tekście",
    });

  // HAR (optional when the page is saved)
  if (p) {
    if (p.har) items.push({ id: "har", status: "ok", label: "zapis ruchu sieciowego (HAR)" });
    else items.push({ id: "har", status: "missing", label: "zapis ruchu sieciowego (HAR)", effect: "Bez HAR nie widać przekierowań ani adresów wywoływanych w tle", optional: body === "saved-html" });
  }

  // address
  const url = str(p?.landingUrl) ?? str(f.landingUrl) ?? str(f.finalUrl) ?? (Array.isArray(f.observedUrls) && f.observedUrls.length ? String(f.observedUrls[0]) : null);
  if (url && p?.landingInferred) items.push({ id: "address", status: "warn", label: "adres strony odtworzony z innych zapisów sprawy", effect: "Adres nie był zapisany przy stronie; host wzięliśmy z pozostałych plików sprawy" });
  else if (url) items.push({ id: "address", status: "ok", label: "adres strony" });
  else items.push({ id: "address", status: "missing", label: "adres strony", effect: "Brak adresu: nie porównamy domeny ani infrastruktury" });

  // video (optional)
  const video = !!(p?.video || str(f.asrText) || str(f.videoPath));
  items.push(video ? { id: "video", status: "ok", label: "wideo" } : { id: "video", status: "missing", label: "wideo", optional: true, effect: "Bez nagrania nie porównamy mowy ani podkładu dźwiękowego" });

  // advertiser / ad library id (optional)
  if (p?.adLibraryId || hasAny(f, ["adLibraryIds"])) items.push({ id: "adlib", status: "ok", label: "identyfikator biblioteki reklam" });
  else if (p?.advertiser || str(f.advertiser)) items.push({ id: "advertiser", status: "ok", label: "nazwa reklamodawcy" });

  // passive lookups
  if (input.lookups === false) {
    items.push({ id: "lookups", status: "warn", label: "dane o domenach nie były pobierane", effect: "Praca bez internetu: brak rejestratora, daty rejestracji i serwerów nazw; porównujemy to, co jest w plikach" });
  }
  const doms = new Set((input.domains ?? []).map((d) => d.toLowerCase()));
  for (const fl of input.failedLookups ?? []) {
    const [kind, domain] = fl.split(":");
    if (doms.size && domain && !doms.has(domain.toLowerCase())) continue;
    const what = kind === "rdap" ? "Rejestr domen (RDAP) nie odpowiedział" : kind === "ct" ? "Rejestr certyfikatów nie odpowiedział" : "Zapytanie nie powiodło się";
    items.push({ id: `lookup:${fl}`, status: "warn", label: `${what} dla domeny ${domain ?? "?"}`, effect: "Brak tych danych w porównaniu; reszta analizy poszła dalej" });
  }

  // errors and skipped parts
  const seen = new Set<string>();
  for (const e of input.errors ?? []) {
    const label = plainError(e);
    if (seen.has(label)) continue;
    seen.add(label);
    items.push({ id: `error:${items.length}`, status: "warn", label });
  }
  for (const s of input.skipped ?? []) items.push({ id: `skipped:${s.id}`, status: "warn", label: `Pominięto ${s.id}: ${s.reason}` });

  // backend list of what to add
  for (const m of input.missing ?? []) items.push({ id: `add:${m}`, status: "missing", label: `dorzuć: ${m}` });

  const gaps = items.filter((i) => (i.status === "missing" && !i.optional) || i.status === "warn");
  const complete = gaps.length === 0;
  const summary = complete ? "dane kompletne" : `dane niepełne: ${gaps.slice(0, 3).map((g) => (g.status === "missing" ? `brak: ${g.label}` : g.label)).join("; ")}${gaps.length > 3 ? " …" : ""}`;
  return { items, complete, summary };
}

/** Completeness of a material of the base from its graph node data (no provenance, no errors). */
export function nodeCompleteness(data: Record<string, unknown>, provenance?: CaseProvenance | null): Completeness {
  return completeness({ provenance, features: data });
}
