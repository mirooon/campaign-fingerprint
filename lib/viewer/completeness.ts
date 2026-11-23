/**
 * Data completeness checklist (§8.9): what the sample holds and what is missing, with the effect
 * of every gap on the comparison. Built from the case record of provenance.json, the result's
 * errors, skipped entries, notes and `missing`, or from the node data of a sample in the base.
 */
import { belongsToDomain, parseLookupErrorLine } from "../pipeline/lookupFailures";

export type CheckStatus = "ok" | "missing" | "warn";

export interface CheckItem {
  id: string;
  status: CheckStatus;
  label: string;
  /** Effect of a gap ("No saved page: we cannot compare the template …"). */
  effect?: string;
  /** Optional source: its absence does not make the data incomplete. */
  optional?: boolean;
}

export interface Completeness {
  items: CheckItem[];
  /** No required source missing and no warning. */
  complete: boolean;
  /** Short summary for a badge ("incomplete data: missing: landing page; missing: page URL"). */
  summary: string;
}

/** Case record of provenance.json (fields of ImportedCase that matter here). */
export interface CaseProvenance {
  id?: string;
  caseId?: string;
  landingUrl?: string | null;
  landingInferred?: boolean;
  bodySource?: "har" | "saved-html" | "wayback" | "urlscan" | "none";
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
  /** Sample features (MaterialItemResult.features) or item node data. */
  features?: Record<string, unknown>;
  errors?: string[];
  /** Skipped entries that belong to this sample. */
  skipped?: Array<{ id: string; reason: string }>;
  /** Failed lookups of the import and of the analysis ("rdap:domain", "dns:domain", "ct:domain"). */
  failedLookups?: string[];
  /** Backend list of what to add (verdicts insufficient / new_campaign). */
  missing?: string[];
  /** Passive lookups (DNS, RDAP) were on for this run; undefined = unknown. */
  lookups?: boolean;
  /** Domains of the sample (to pick its failed lookups; an IDN label "żółw.pl (xn--…)" counts with both names). Absent: every failed lookup is shown. */
  domains?: string[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function hasAny(f: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((k) => {
    const v = f[k];
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== "" && v !== false;
  });
}

/** Plain text of a technical error (a failed RDAP or DNS lookup names its domain), or the original when there is none. */
export function plainError(e: string): string {
  const lookup = parseLookupErrorLine(e);
  if (lookup?.kind === "rdap") return `The domain registry (RDAP) did not respond for domain ${lookup.name}: no registration date or registrar`;
  if (lookup?.kind === "dns") return `DNS servers did not respond for ${lookup.name}: no IP address or name servers`;
  const rdap = /rdap[^a-z0-9]*(?:(?:dla|for)\s+)?([a-z0-9.-]+\.[a-z]{2,})?/i.exec(e);
  if (/rdap/i.test(e)) return `The domain registry (RDAP) did not respond${rdap?.[1] ? ` for domain ${rdap[1]}` : ""}: no registration date or registrar`;
  if (/\bdns\b/i.test(e)) return "DNS servers did not respond: no IP address or name servers";
  if (/ocr|tesseract/i.test(e)) return "Could not read the text from the screenshot (OCR)";
  if (/whisper|asr|transkry|transcri/i.test(e)) return "Could not transcribe the speech in the recording";
  if (/ffmpeg|ffprobe|klatk|\bframes?\b/i.test(e)) return "Could not read the frames of the recording";
  if (/timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed/i.test(e)) return "A network request failed (no response)";
  return e;
}

/**
 * Checklist of one sample: the sources it holds (screenshot, page, HAR, address, video, advertiser), passive
 * lookups that were off or got no answer for its domains (with the reason from its error line), the remaining
 * errors in plain words, skipped files and the backend list of what to add.
 */
export function completeness(input: CompletenessInput): Completeness {
  const p = input.provenance ?? null;
  const f = input.features ?? {};
  const items: CheckItem[] = [];

  // screenshot
  const shot = !!(p?.screenshot || (p?.moreScreenshots?.length ?? 0) > 0 || str(f.imagePath) || str(f.imageUrl) || str(f.ocrText));
  items.push(
    shot
      ? { id: "screenshot", status: "ok", label: "ad screenshot" }
      : { id: "screenshot", status: "missing", label: "ad screenshot", effect: "No screenshot: we cannot compare the ad image or the text from the screenshot" },
  );

  // page (from HAR or a saved copy)
  const archived = f.bodySource === "urlscan" || f.bodySource === "wayback" ? f.bodySource : null;
  const body = p?.bodySource ?? (str(f.domSimhash) || str(f.finalUrl) ? "saved-html" : p ? "none" : undefined);
  if (archived) {
    items.push({ id: "page", status: "warn", label: `page (archived copy: ${archived})`, effect: "The page content comes from a public copy (not a live fetch): it may differ from the page the viewer of the ad saw" });
  } else if (body === "har") items.push({ id: "page", status: "ok", label: p?.harFromCase ? "page (from a HAR of another case)" : "page (from HAR)" });
  else if (body === "saved-html") items.push({ id: "page", status: "ok", label: "page (from a saved copy)" });
  else if (body === "wayback") items.push({ id: "page", status: "ok", label: "page (copy from the Internet Archive)" });
  else
    items.push({
      id: "page",
      status: "missing",
      label: "landing page",
      effect: "No saved page: we cannot compare the template, form or trackers; the assignment relies on the image and text",
    });

  // HAR (optional when the page is saved)
  if (p) {
    if (p.har) items.push({ id: "har", status: "ok", label: "network traffic recording (HAR)" });
    else items.push({ id: "har", status: "missing", label: "network traffic recording (HAR)", effect: "Without a HAR, redirects and addresses called in the background are not visible", optional: body === "saved-html" });
  }

  // address
  const url = str(p?.landingUrl) ?? str(f.landingUrl) ?? str(f.finalUrl) ?? (Array.isArray(f.observedUrls) && f.observedUrls.length ? String(f.observedUrls[0]) : null);
  if (url && p?.landingInferred) items.push({ id: "address", status: "warn", label: "page URL rebuilt from other records of the case", effect: "The URL was not saved with the page; we took the host from the other files of the case" });
  else if (url) items.push({ id: "address", status: "ok", label: "page URL" });
  else items.push({ id: "address", status: "missing", label: "page URL", effect: "No URL: we cannot compare the domain or infrastructure" });

  // video (optional)
  const video = !!(p?.video || str(f.asrText) || str(f.videoPath));
  items.push(video ? { id: "video", status: "ok", label: "video" } : { id: "video", status: "missing", label: "video", optional: true, effect: "Without a recording we cannot compare the speech or the soundtrack" });

  // advertiser / ad library id (optional)
  if (p?.adLibraryId || hasAny(f, ["adLibraryIds"])) items.push({ id: "adlib", status: "ok", label: "ad library ID" });
  else if (p?.advertiser || str(f.advertiser)) items.push({ id: "advertiser", status: "ok", label: "advertiser name" });

  // passive lookups
  if (input.lookups === false) {
    items.push({ id: "lookups", status: "warn", label: "domain data was not fetched", effect: "Working offline: no registrar, registration date or name servers; we compare what is in the files" });
  }
  // the sample's domains: an IDN pivot is labelled "żółw.pl (xn--w-....pl)", a failed lookup names the ASCII form
  const doms = input.domains ? input.domains.flatMap((d) => d.toLowerCase().split(/[\s()]+/)).filter((d) => d.includes(".")) : null;
  const lookupLines = (input.errors ?? []).map(parseLookupErrorLine).filter((l): l is NonNullable<typeof l> => !!l);
  const shownLookups: Array<{ kind: string; domain: string }> = [];
  for (const fl of input.failedLookups ?? []) {
    const cut = fl.indexOf(":");
    const kind = cut < 0 ? fl : fl.slice(0, cut);
    const domain = cut < 0 ? "" : fl.slice(cut + 1).toLowerCase();
    if (doms && !(domain && doms.some((d) => belongsToDomain(domain, d)))) continue;
    if (shownLookups.some((s) => s.kind === kind && s.domain === domain)) continue;
    shownLookups.push({ kind, domain });
    const what = kind === "rdap" ? "The domain registry (RDAP) did not respond" : kind === "dns" ? "DNS servers did not respond" : kind === "ct" ? "The certificate log did not respond" : "The lookup failed";
    const lost = kind === "rdap" ? "The comparison has no registration date or registrar for this domain" : kind === "dns" ? "The comparison has no IP addresses or name servers for this domain" : "The comparison lacks this data";
    // the reason comes from the sample's own error line for that domain (analysis with live lookups)
    const reason = lookupLines.find((l) => l.kind === kind && domain && belongsToDomain(l.name, domain) && l.reason)?.reason;
    items.push({ id: `lookup:${fl}`, status: "warn", label: `${what} for domain ${domain || "?"}`, effect: `${reason ? `Reason: ${reason}. ` : ""}${lost}; the rest of the analysis went on` });
  }

  // errors and skipped parts (an error line of a lookup already shown above is not repeated)
  const seen = new Set<string>();
  for (const e of input.errors ?? []) {
    const lookup = parseLookupErrorLine(e);
    if (lookup && shownLookups.some((s) => s.kind === lookup.kind && belongsToDomain(lookup.name, s.domain))) continue;
    const label = plainError(e);
    if (seen.has(label)) continue;
    seen.add(label);
    items.push({ id: `error:${items.length}`, status: "warn", label });
  }
  for (const s of input.skipped ?? []) items.push({ id: `skipped:${s.id}`, status: "warn", label: `Skipped ${s.id}: ${s.reason}` });

  // backend list of what to add
  for (const m of input.missing ?? []) items.push({ id: `add:${m}`, status: "missing", label: `add: ${m}` });

  const gaps = items.filter((i) => (i.status === "missing" && !i.optional) || i.status === "warn");
  const complete = gaps.length === 0;
  const summary = complete ? "complete data" : `incomplete data: ${gaps.slice(0, 3).map((g) => (g.status === "missing" ? `missing: ${g.label}` : g.label)).join("; ")}${gaps.length > 3 ? " …" : ""}`;
  return { items, complete, summary };
}

/** Completeness of a sample of the base from its graph node data (no provenance, no errors). */
export function nodeCompleteness(data: Record<string, unknown>, provenance?: CaseProvenance | null): Completeness {
  return completeness({ provenance, features: data });
}
