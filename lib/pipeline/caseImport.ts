/**
 * Case folders -> pipeline input and offline fixtures.
 *
 * Analysts often hand over one folder per reported ad: the landing page saved from a browser
 * ("save as": HTML plus a `<name>_files` folder), a HAR of the page load and a screenshot of the ad.
 * This step turns such folders into `input.json` (one record per case) and a fixture directory in
 * the format of the offline mode (`sources.ts`), so the whole pipeline runs on the captures and
 * never contacts the landing pages.
 *
 * Page content comes from the HAR (the raw server response) when it holds the document, otherwise
 * from the saved page. A/AAAA records come from the HAR (state at capture time). Everything else
 * about a domain (NS/MX/TXT/CNAME, RDAP, crt.sh, ASN) is asked through `lookups` only when one is
 * given; those are passive queries about the domain, not requests to it.
 *
 * Real case folders are untidy, so the importer also takes: captures in sub-folders (several pages
 * of one case, a capture bundle with dom.html + page.har + page.mhtml + manifest.json), several
 * HAR files, a HAR filed in a neighbouring case, a page saved from disk (no address), several
 * screenshots, a video of the ad and a yt-dlp `.info.json`, and cases with media only.
 * One case with several different pages gives one record per page (`<case>_<sub-folder>`).
 * Folders collected from public sources (scan service, web archive, press; `collectedCase.ts`) take
 * the address from their source file and the role of each file from its name.
 */
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { adRecordColumns } from "../adlib/toItem";
import { parseAdRecord } from "../adlib/record";
import { AD_RECORD_FILE, type AdRecord } from "../adlib/types";
import { findStreamSegments, stitchSegments, type StreamSegments } from "../media/hls";
import { cymruAsNameQuery, cymruOriginQuery, pickCymruOrigin } from "../osint/asn";
import type { DnsRecordType } from "../osint/dns";
import { TEXT_CONFIG } from "../osint/textConfig";
import { isStealerCandidateUrl } from "../osint/stealerKit";
import { normalizeUrl, registrableDomain } from "../osint/urls";
import {
  COLLECTED_SOURCE_FILE,
  collectedImageRole,
  isCollectedPage,
  readCollectedSource,
  recordedLookups,
  scanCymruAnswers,
  scanMeta,
  unwrapWayback,
  waybackTime,
  type CollectedSource,
  type RecordedLookups,
  type ScanMeta,
} from "./collectedCase";
import { redactHar, redactPageHtml } from "../osint/redact";
import { hashCaseFiles, type CaseFileRecord, type CaseFileRole } from "./caseFiles";
import type { TlsDetails } from "../osint/tlsSignals";

export interface CaseLookups {
  /** Passive DNS answers for the requested record types (missing types = no records). */
  dns(name: string, types: DnsRecordType[]): Promise<Partial<Record<DnsRecordType, string[]>>>;
  /** Raw RDAP JSON of a registrable domain, or null. */
  rdapRaw(domain: string): Promise<unknown | null>;
  /** Raw crt.sh JSON of a registrable domain, or null (optional: crt.sh is slow). */
  ctRaw?(domain: string): Promise<unknown | null>;
  /** TXT answers (Team Cymru IP-to-ASN). */
  txt(name: string): Promise<string[]>;
}

export interface CaseImportOptions {
  /** Directory with one sub-directory per case. */
  casesDir: string;
  /** Output: input.json, mapping.json, provenance.json and fixtures/. */
  outDir: string;
  lookups?: CaseLookups;
  log?: (message: string) => void;
}

export interface ImportedCase {
  /** Record id: the case folder, or `<case>_<capture>` when the case holds several different pages. */
  id: string;
  /** Case folder name. */
  caseId: string;
  /** Sub-folder of the capture inside the case ("" = the case folder itself). */
  capture: string;
  landingUrl: string | null;
  /** True when the page was saved without its address and the host was taken from the other captures of the case. */
  landingInferred: boolean;
  /** Fixture key of the landing page (normalised URL, as the pipeline requests it). */
  pageKey: string | null;
  /** "har" also covers a HAR with requests only (a scan service's request list); "wayback" = an archived copy. */
  bodySource: "har" | "saved-html" | "wayback" | "none";
  har: string | null;
  /** Case folder the HAR was found in, when it is not this case (a HAR filed in the wrong folder). */
  harFromCase: string | null;
  savedHtml: string | null;
  screenshot: string | null;
  moreScreenshots: string[];
  /** Screenshots of the landing page (a scan service's screenshot, press images of the page): kept for the record, not read as the ad. */
  pageScreenshots: string[];
  video: string | null;
  /** Further videos of the case: the landing page's own video saved as an HLS stream, stitched (`lib/media/hls.ts`). */
  moreVideos: string[];
  advertiser: string | null;
  adLibraryId: string | null;
  /** Page ID of the advertiser from the library ad's description (`uploader_id`), or null. */
  adPageId: string | null;
  /** Title of the ad from the yt-dlp description, or null. */
  adTitle: string | null;
  /** Record of a public ad library (`adlib.json`, written by `adRecordToCaseDir`), or null. */
  adRecord: AdRecord | null;
  firstSeen: string | null;
  /** Public sources of a collected folder (address, type, entry and access dates). */
  sources: CollectedSource[];
  /** Page metadata from a scan service's search record. */
  scan: ScanMeta | null;
  /** Every input file of the case this record rests on, with SHA-256 taken at import (provenance.json, evidence pack). */
  files: CaseFileRecord[];
  /** Time of the import (UTC ISO), the same for the whole run. */
  importedAt: string;
}

export interface CaseImportResult {
  cases: ImportedCase[];
  skipped: Array<{ id: string; reason: string }>;
  httpEntries: number;
  /** Lookups that gave nothing, as "rdap:<domain>" / "ct:<domain>" (rate limits and timeouts are common). */
  failedLookups: string[];
}

interface HarEntry {
  /** Page record of the HAR the entry belongs to (one per navigation in the browser session). */
  pageref?: string;
  /** What started the request (Chrome): a script stack, the parser, or another request. */
  _initiator?: HarInitiator;
  _resourceType?: string;
  serverIPAddress?: string;
  /** Certificate of the connection (Chrome): issuer, names, validity as epoch seconds. */
  _securityDetails?: { issuer?: string; subjectName?: string; sanList?: string[]; validFrom?: number | string; validTo?: number | string };
  startedDateTime?: string;
  request: { method: string; url: string };
  response: { status: number; headers?: Array<{ name: string; value: string }>; content?: { mimeType?: string; text?: string; encoding?: string } };
}
interface HttpFixture {
  status: number;
  headers: Record<string, string>;
  bodyFile: string;
  /** URLs the page requested while loading (from the HAR): traces visible only in the requests. */
  requests?: string[];
  /** Certificate the page was served with (HAR `_securityDetails`). */
  tls?: TlsDetails;
}

const MAX_REQUESTS = 1000;

/** Certificate details of a HAR entry as the fixture field `tls`; empty when the entry carries none (a HAR of plain HTTP or from a tool that does not record them). */
function tlsOfEntry(e: HarEntry): { tls?: TlsDetails } {
  const d = e._securityDetails;
  if (!d || (!d.issuer && !d.sanList?.length && !d.subjectName)) return {};
  return { tls: { issuer: d.issuer ?? null, validFrom: d.validFrom ?? null, validTo: d.validTo ?? null, sanList: d.sanList ?? [], subjectName: d.subjectName ?? null } };
}

/** Unique http(s) request URLs of a HAR, in recorded order. */
function requestUrls(entries: HarEntry[]): string[] {
  const out = new Set<string>();
  for (const e of entries) {
    const u = e.request?.url;
    if (u && /^https?:\/\//i.test(u) && u.length <= 2048) out.add(u);
    if (out.size >= MAX_REQUESTS) break;
  }
  return [...out];
}

const IMAGE_EXT = /\.(ico|png|jpe?g|gif|webp|svg|avif)$/i;
/**
 * Scripts of a saved page's `_files` folder: ".js", or the browser's download names ("x.js.pobrane",
 * "x.js.download", and ".pobierz" that Polish Chrome gives files of an unknown type).
 */
const SAVED_SCRIPT = /\.(?:m?js(?:\.(?:pobrane|download))?|pobierz)$/i;
const SCREENSHOT_EXT = /\.(png|jpe?g|webp)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)$/i;
const HTML_EXT = /\.html?$/i;
/** Image formats that phones and browsers save but the importer does not read as a screenshot (see SCREENSHOT_EXT). */
const UNREAD_IMAGE_EXT = /\.(heic|heif|tiff?|bmp|gif|avif)$/i;
/**
 * A file the importer takes as material (HAR, saved page, MHTML snapshot, screenshot, video), as
 * opposed to notes, manifests and page assets: what two copies of one case must share.
 */
export function isMaterialFile(name: string): boolean {
  return /\.har$/i.test(name) || /\.mhtml?$/i.test(name) || (HTML_EXT.test(name) && !SAVED_FRAME.test(name)) || SCREENSHOT_EXT.test(name) || VIDEO_EXT.test(name);
}

/**
 * Upper-case extensions (e.g. "HEIC") of the images in a case folder that the importer leaves out
 * because it does not read their format, in alphabetical order. Empty when there are none. It lets a
 * case with nothing else say why it was skipped, instead of "no page, screenshot or video".
 */
export function unreadImageFormats(root: string): string[] {
  const found = walkCase(root)
    .map((f) => UNREAD_IMAGE_EXT.exec(f.name)?.[1])
    .filter((e): e is string => !!e)
    .map((e) => e.toUpperCase());
  return [...new Set(found)].sort();
}

/** A case id as a file name (the stitched page video is named after its case). */
const safeFileName = (id: string) => id.replace(/[^\p{L}\p{N}._-]+/gu, "_");

/** Frames a browser saves next to the page ("saved_resource.html"). */
const SAVED_FRAME = /^saved_resource(\(\d+\))?\.html?$/i;
const MAX_DEPTH = 4;
const MAX_ASSET_BYTES = 2_000_000;
/** Describe the stored body, not the transfer: the fixture holds the decoded bytes. */
const DROP_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding", "location", "set-cookie"]);
/** Chromium appends this to script names in "save as" (localised). */
const DOWNLOAD_SUFFIX = /\.(?:pobrane|download)(?=["'?#\s>])/g;

const safeName = (s: string) => s.replace(/[^a-z0-9.-]/gi, "_");
const cleanName = (s: string) => s.toLowerCase().replace(/\.$/, "");

/**
 * Failure to write the import output (fixtures, input.json): it concerns the whole batch, so the per-case
 * error handling of `importCases` passes it on instead of skipping the case.
 */
class ImportOutputError extends Error {}

/** Writes one output file of the import, creating its folder; a failure is an `ImportOutputError`. */
function write(file: string, data: Buffer | string): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, data);
  } catch (e) {
    throw new ImportOutputError(`nie udało się zapisać wyniku importu (${file}): ${(e as Error).message}`, { cause: e });
  }
}

/** Message of an error for the user, with the case folder cut from the paths in it (no server paths in the GUI). */
function errorText(e: unknown, dir: string): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.split(`${dir}${path.sep}`).join("").split(dir).join(".");
}

function urlKey(u: string, base?: string): string | null {
  try {
    return new URL(u, base).toString();
  } catch {
    return null;
  }
}

function hostOf(u: string | null | undefined): string | null {
  try {
    return u ? new URL(u).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function harBody(e: HarEntry): Buffer | null {
  const c = e.response.content;
  if (!c?.text) return null;
  return Buffer.from(c.text, c.encoding === "base64" ? "base64" : "utf8");
}

function harHeaders(e: HarEntry): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of e.response.headers ?? []) {
    const k = h.name.toLowerCase();
    if (k.startsWith(":") || DROP_HEADERS.has(k)) continue;
    out[k] = out[k] ? `${out[k]}, ${h.value}` : h.value;
  }
  return out;
}

function isDocument(e: HarEntry): boolean {
  return e.response.status === 200 && !!e.response.content?.text && (e._resourceType === "document" || /html/i.test(e.response.content?.mimeType ?? ""));
}

/**
 * The HAR entry of the landing page itself: the saved URL, else a document on its host. Without a
 * saved URL: the page the HAR names (a HAR of a page opened from disk holds only third-party
 * frames, so it has no landing document), else the first document.
 */
interface HarInitiator {
  type?: string;
  url?: string;
  stack?: HarStack;
}
interface HarStack {
  callFrames?: Array<{ url?: string }>;
  parent?: HarStack;
}

const EXTENSION_URL = /^(?:chrome|moz|safari-web|ms-browser)-extension:\/\//i;

/**
 * Whether a request was started by a browser extension of whoever saved the HAR (B-116): its initiator, or
 * any frame of the initiator's script stack (and its parents), runs from an extension. Such requests are
 * the analyst's tools, not the page; a script of the page that calls a third party keeps its request.
 */
export function fromExtension(e: HarEntry): boolean {
  const init = e._initiator;
  if (!init) return false;
  if (init.url && EXTENSION_URL.test(init.url)) return true;
  for (let s: HarStack | undefined = init.stack, depth = 0; s && depth < 20; s = s.parent, depth++) {
    if ((s.callFrames ?? []).some((f) => !!f.url && EXTENSION_URL.test(f.url))) return true;
  }
  return false;
}

/**
 * Entries of a HAR that belong to the page of `main` (B-211): a HAR saved after browsing holds requests of
 * earlier pages of the session, whose hosts, IPs and images are not traits of this page. With page records
 * the entries of main's `pageref`; otherwise the entries from main's start time on, plus the redirect hops
 * that lead to main (they precede it but are part of its navigation). Entries without a time stay. Without
 * main (a HAR of requests only) all entries.
 */
export function pageEntries(entries: HarEntry[], main: HarEntry | null): HarEntry[] {
  if (!main) return entries;
  if (main.pageref && entries.some((e) => e.pageref && e.pageref !== main.pageref)) return entries.filter((e) => !e.pageref || e.pageref === main.pageref);
  const start = Date.parse(main.startedDateTime ?? "");
  if (Number.isNaN(start)) return entries;
  const hops = new Set<HarEntry>();
  let target = main.request.url;
  for (let i = 0; i < entries.length; i++) {
    const hop = entries.find((e) => !hops.has(e) && e.response.status >= 300 && e.response.status < 400 && redirectTarget(e) === target);
    if (!hop) break;
    hops.add(hop);
    target = hop.request.url;
  }
  return entries.filter((e) => {
    const t = Date.parse(e.startedDateTime ?? "");
    return Number.isNaN(t) || t >= start || hops.has(e);
  });
}

/** Absolute address in the Location header of a redirect entry, or null. */
function redirectTarget(e: HarEntry): string | null {
  const loc = e.response.headers?.find((h) => h.name.toLowerCase() === "location")?.value;
  if (!loc) return null;
  try {
    return new URL(loc, e.request.url).toString();
  } catch {
    return null;
  }
}

export function mainDocument(entries: HarEntry[], savedFrom: string | null, harPageUrl: string | null = null): HarEntry | null {
  const docs = entries.filter(isDocument);
  const on = (u: string) => docs.find((e) => e.request.url === u) ?? docs.find((e) => hostOf(e.request.url) === hostOf(u)) ?? null;
  if (savedFrom) return on(savedFrom);
  if (harPageUrl && /^[a-z][a-z0-9+.-]*:/i.test(harPageUrl)) return /^https?:/i.test(harPageUrl) ? on(harPageUrl) : null;
  return docs[0] ?? null;
}

/** URL in the comment a browser writes at the top of a saved page. */
export function savedFromUrl(html: string): string | null {
  return /<!--\s*saved from url=\(\d+\)(\S+)\s*-->/.exec(html.slice(0, 4000))?.[1] ?? null;
}

/** "… 2026-01-15 101500.png" -> ISO time, read as local time of the machine running the import. */
function screenshotTime(name: string): string | null {
  const m = /(\d{4})-(\d{2})-(\d{2})[ _T](\d{2})[.:]?(\d{2})[.:]?(\d{2})/.exec(name);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function earliest(entries: HarEntry[]): string | null {
  const times = entries.map((e) => Date.parse(e.startedDateTime ?? "")).filter((t) => !Number.isNaN(t));
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}

export interface CaseFile {
  /** Path relative to the case folder, "/"-separated. */
  rel: string;
  /** Folder relative to the case folder ("" = the case folder). */
  dir: string;
  name: string;
}

/**
 * Files of a case, the case folder first. Asset folders of saved pages and of capture bundles are not entered.
 * A folder that cannot be listed (no permission, removed meanwhile) is left out and passed to `onError`
 * ("" = the case folder itself), so one unreadable folder never stops a batch.
 */
export function walkCase(root: string, onError?: (dir: string, e: unknown) => void): CaseFile[] {
  const out: CaseFile[] = [];
  const visit = (dir: string, depth: number) => {
    const subdirs: string[] = [];
    let names: string[];
    try {
      names = readdirSync(path.join(root, dir)).sort();
    } catch (e) {
      onError?.(dir, e);
      return;
    }
    for (const name of names) {
      const rel = dir ? `${dir}/${name}` : name;
      let isDir = false;
      try {
        isDir = statSync(path.join(root, rel)).isDirectory();
      } catch {
        continue; // a broken link
      }
      if (!isDir) out.push({ rel, dir, name });
      else if (!name.endsWith("_files") && name !== "resources" && depth < MAX_DEPTH) subdirs.push(rel);
    }
    for (const d of subdirs) visit(d, depth + 1);
  };
  visit("", 0);
  return out;
}

interface Har {
  file: string;
  caseId: string;
  entries: HarEntry[];
  /** What the HAR says it recorded: a URL in browser exports, a title in other tools. */
  pageUrl: string | null;
}

function httpUrl(u: string | null | undefined): string | null {
  return u && /^https?:\/\//i.test(u) && normalizeUrl(u) ? u : null;
}

/** Address of the page stored in an MHTML snapshot. */
function mhtmlLocation(file: string): string | null {
  const buf = Buffer.alloc(16_384);
  const fd = openSync(file, "r");
  try {
    const n = readSync(fd, buf, 0, buf.length, 0);
    return /^Snapshot-Content-Location:\s*(\S+)/im.exec(buf.toString("utf8", 0, n))?.[1] ?? null;
  } finally {
    closeSync(fd);
  }
}

function titleOf(html: string): string {
  return (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html.slice(0, 200_000))?.[1] ?? "").replace(/\s+/g, " ").trim();
}

/** Hosts in absolute links of a page, with the number of links. */
function linkedHosts(html: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of html.matchAll(/(?:src|href|action)=["'](https?:\/\/[^"'\s>]+)/gi)) {
    const h = hostOf(m[1]);
    if (h) out.set(h, (out.get(h) ?? 0) + 1);
  }
  return out;
}

/** One saved copy of a landing page inside a case. */
interface Capture {
  /** Sub-folder inside the case, "/" replaced ("" = the case folder). */
  name: string;
  dir: string;
  htmlName: string | null;
  saved: string | null;
  savedFrom: string | null;
  har: Har | null;
  main: HarEntry | null;
  landingUrl: string | null;
  /** A HAR without the document body (e.g. rebuilt from the request list of a scan): only its requests are read. */
  requestsOnly?: boolean;
  /** Archive time of a web-archive copy (ISO); the body is the archived page. */
  archivedAt?: string | null;
  inferred: boolean;
}

/** What a folder collected from public sources says about itself (`collectedCase.ts`). */
interface Collected {
  target: string | null;
  sources: CollectedSource[];
  scan: ScanMeta | null;
  lookups: RecordedLookups | null;
}

interface CaseScan {
  id: string;
  dir: string;
  captures: Capture[];
  /** HAR files of the case that match none of its pages. */
  spareHars: Har[];
  screenshots: string[];
  pageScreenshots: string[];
  video: string | null;
  /** HLS streams saved in the case (also inside `resources/`), not yet stitched. */
  streams: StreamSegments[];
  advertiser: string | null;
  adLibraryId: string | null;
  /** The yt-dlp description of the video (absolute path), when there is one. */
  infoFile: string | null;
  /** Title of the ad from the yt-dlp description (`title`), or null. */
  adTitle: string | null;
  adPageId: string | null;
  adRecord: AdRecord | null;
  infoTime: string | null;
  /** "was_live" or "is_live" from the yt-dlp description (a recorded or running live stream), else null (B-301). */
  liveStatus: string | null;
  notes: string[];
  /** Material files and folders of the case that could not be read or parsed, with the reason in Polish ("" = the case folder). */
  unreadable: Array<{ rel: string; reason: string }>;
  collected: Collected | null;
}

/** Parsed JSON of a file, or null with a note when it cannot be read. */
function readJsonNote(file: string, rel: string, notes: string[]): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    notes.push(`${rel}: nieczytelny plik (${(e as Error).message})`);
    return null;
  }
}

/**
 * Source file, search record and recorded lookups of a folder collected from public sources; null for
 * other folders. Only the address and the public sources are read from the source file (no labels).
 */
function readCollected(files: CaseFile[], abs: (f: CaseFile) => string, notes: string[]): Collected | null {
  const root = (name: string) => files.find((f) => f.dir === "" && f.name === name);
  const src = root(COLLECTED_SOURCE_FILE);
  if (!src) return null;
  const { target, sources } = readCollectedSource(readJsonNote(abs(src), src.rel, notes));
  if (!target) notes.push(`${src.rel}: brak adresu docelowego (pole cel)`);
  const rec = root("urlscan_rekord.json");
  const look = root("rdap_dns.json");
  return {
    target,
    sources,
    scan: rec ? scanMeta(readJsonNote(abs(rec), rec.rel, notes)) : null,
    lookups: look ? recordedLookups(readJsonNote(abs(look), look.rel, notes)) : null,
  };
}

/**
 * Reads one case folder: its page captures (saved pages, HARs, capture bundles), screenshots, videos and
 * descriptions. A page or HAR that cannot be read or parsed is left out and listed in `unreadable`, so the
 * other files of the case still count and the reason reaches the batch result.
 */
function scanCase(casesDir: string, id: string): CaseScan {
  const dir = path.resolve(casesDir, id); // absolute: media paths in input.json must not depend on the working directory
  const notes: string[] = [];
  const unreadable: CaseScan["unreadable"] = [];
  const files = walkCase(dir, (d, e) => unreadable.push({ rel: d, reason: `nie udało się odczytać katalogu ${d || "sprawy"}: ${errorText(e, dir)}` }));
  const abs = (f: CaseFile) => path.join(dir, ...f.rel.split("/"));
  /** Text of a material file, or null when it cannot be read (then listed in `unreadable`). */
  const readText = (f: CaseFile): string | null => {
    try {
      return readFileSync(abs(f), "utf8");
    } catch (e) {
      unreadable.push({ rel: f.rel, reason: `nie udało się odczytać pliku ${f.rel}: ${errorText(e, dir)}` });
      return null;
    }
  };
  const collected = readCollected(files, abs, notes);

  const hars: Array<Har & { dir: string }> = [];
  for (const f of files.filter((x) => /\.har$/i.test(x.name))) {
    const text = readText(f);
    if (text === null) continue;
    try {
      // redacted on reading: the analyst's cookies, headers and visit data never enter the record (the original's hash is in `files`)
      const j = JSON.parse(redactHar(text).text) as { log?: { entries?: HarEntry[]; pages?: Array<{ title?: string }> } };
      hars.push({ file: abs(f), caseId: id, dir: f.dir, entries: j.log?.entries ?? [], pageUrl: j.log?.pages?.[0]?.title ?? null });
    } catch (e) {
      unreadable.push({ rel: f.rel, reason: `nie udało się odczytać pliku ${f.rel} (uszkodzony HAR): ${errorText(e, dir)}` });
    }
  }
  const used = new Set<Har>();
  const captures: Capture[] = [];
  const dirs = [...new Set(files.map((f) => f.dir))];
  for (const d of dirs) {
    const here = files.filter((f) => f.dir === d);
    // in a collected folder only web-archive copies are pages (not a scan service's result page, not a press article);
    // a page that cannot be read is left out (listed in `unreadable`), so a HAR next to it can still stand for the page
    const htmls = here
      .filter((f) => HTML_EXT.test(f.name) && !SAVED_FRAME.test(f.name) && (!collected || isCollectedPage(f.name)))
      .map((f) => ({ f, text: readText(f) }))
      .filter((p): p is { f: CaseFile; text: string } => p.text !== null);
    const dirHars = hars.filter((h) => h.dir === d);
    const mhtml = here.find((f) => /\.mhtml?$/i.test(f.name));
    const manifest = here.find((f) => f.name === "manifest.json");
    let bundleUrl: string | null = null;
    try {
      bundleUrl = httpUrl(mhtml ? mhtmlLocation(abs(mhtml)) : null);
      if (!bundleUrl && manifest) bundleUrl = httpUrl((JSON.parse(readFileSync(abs(manifest), "utf8")) as { page_url?: string }).page_url);
    } catch {
      // an unreadable bundle file: the address may still come from the page or the HAR
    }
    if (collected?.target) bundleUrl = collected.target;
    const name = d.replace(/\//g, "_");
    for (const { f, text } of htmls) {
      const archivedAt = collected ? waybackTime(f.name) : null;
      if (archivedAt) {
        const saved = redactPageHtml(unwrapWayback(text)).text;
        captures.push({ name, dir: d, htmlName: f.rel, saved, savedFrom: bundleUrl, har: null, main: null, landingUrl: bundleUrl, archivedAt, inferred: false });
        continue;
      }
      const saved = redactPageHtml(text).text;
      const savedFrom = httpUrl(savedFromUrl(saved)) ?? bundleUrl;
      let har: Har | null = null;
      if (savedFrom) har = dirHars.find((h) => mainDocument(h.entries, savedFrom)) ?? hars.find((h) => mainDocument(h.entries, savedFrom)) ?? null;
      // one page and one HAR side by side belong together even when the HAR holds no copy of the page
      if (!har && htmls.length === 1 && dirHars.length === 1) har = dirHars[0];
      if (har) used.add(har);
      const main = har ? mainDocument(har.entries, savedFrom, har.pageUrl) : null;
      captures.push({ name, dir: d, htmlName: f.rel, saved, savedFrom, har, main, landingUrl: savedFrom ?? main?.request.url ?? null, inferred: false });
    }
    if (htmls.length) continue;
    for (const h of dirHars) {
      const main = mainDocument(h.entries, bundleUrl, h.pageUrl);
      if (!main) {
        // no document body: the page address from the bundle, the HAR's page record or its document request
        const docUrl = h.entries.find((e) => e._resourceType === "document" || /html/i.test(e.response?.content?.mimeType ?? ""))?.request.url ?? null;
        const url = bundleUrl ?? httpUrl(h.pageUrl) ?? httpUrl(docUrl);
        if (!url || !h.entries.length) continue;
        used.add(h);
        captures.push({ name, dir: d, htmlName: null, saved: null, savedFrom: bundleUrl, har: h, main: null, landingUrl: url, inferred: false, requestsOnly: true });
        continue;
      }
      used.add(h);
      captures.push({ name, dir: d, htmlName: null, saved: null, savedFrom: bundleUrl, har: h, main, landingUrl: bundleUrl ?? main.request.url, inferred: false });
    }
  }

  // A page saved from disk has no address: take the host of another capture of the case, or one its HAR contacted, that the page links to.
  const known = new Set(captures.map((c) => hostOf(c.landingUrl)).filter((h): h is string => !!h));
  for (const c of captures) {
    if (c.landingUrl || !c.saved) continue;
    const contacted = new Set((c.har?.entries ?? []).map((e) => hostOf(e.request.url)).filter((h): h is string => !!h));
    const best = [...linkedHosts(c.saved)].filter(([h]) => known.has(h) || contacted.has(h)).sort((x, y) => y[1] - x[1])[0];
    if (!best) continue;
    c.landingUrl = `https://${best[0]}/`;
    c.inferred = true;
    notes.push(`${c.htmlName}: strona zapisana bez adresu, host ${best[0]} wzięty z jej odnośników (${best[1]}) i z innych zapisów tej sprawy`);
  }

  const rootMedia = files.filter((f) => f.dir === "");
  const shots = rootMedia.filter((f) => SCREENSHOT_EXT.test(f.name));
  const isAd = (f: CaseFile) => !collected || collectedImageRole(f.name) === "ad";
  const videos = rootMedia.filter((f) => VIDEO_EXT.test(f.name));
  if (videos.length > 1) notes.push(`kilka plików wideo, użyty pierwszy: ${videos[0].name}`);
  let advertiser: string | null = null;
  let adLibraryId: string | null = null;
  let adPageId: string | null = null;
  let infoTime: string | null = null;
  let adTitle: string | null = null;
  let liveStatus: string | null = null;
  const info = rootMedia.find((f) => /\.info\.json$/i.test(f.name));
  if (info) {
    try {
      const j = JSON.parse(readFileSync(abs(info), "utf8")) as { webpage_url?: string; playlist_uploader?: string; uploader?: string; epoch?: number; uploader_id?: string; title?: string; was_live?: boolean; is_live?: boolean; live_status?: string };
      adLibraryId = /\/ads\/library\/?\?(?:.*&)?id=(\d{6,})/.exec(j.webpage_url ?? "")?.[1] ?? null;
      advertiser = j.playlist_uploader ?? j.uploader ?? null;
      // the uploader of a library ad is its advertiser page: a stable ID, unlike the name
      adPageId = adLibraryId && /^\d+$/.test(j.uploader_id ?? "") ? (j.uploader_id ?? null) : null;
      adTitle = typeof j.title === "string" && j.title.trim() ? j.title.trim().slice(0, 200) : null;
      liveStatus = j.is_live === true || j.live_status === "is_live" ? "is_live" : j.was_live === true || j.live_status === "was_live" ? "was_live" : null;
      infoTime = typeof j.epoch === "number" ? new Date(j.epoch * 1000).toISOString() : null;
    } catch {
      notes.push(`${info.name}: nieczytelny plik opisu`);
    }
  }
  let adRecord: AdRecord | null = null;
  const adFile = files.find((f) => f.dir === "" && f.name === AD_RECORD_FILE);
  if (adFile) {
    const parsed = parseAdRecord(readJsonNote(abs(adFile), adFile.name, notes));
    adRecord = parsed.record;
    if (parsed.error) notes.push(`${AD_RECORD_FILE}: pominięty (${parsed.error})`);
  }
  return {
    id,
    dir,
    captures,
    spareHars: hars.filter((h) => !used.has(h)),
    screenshots: shots.filter(isAd).map(abs),
    pageScreenshots: shots.filter((f) => !isAd(f)).map(abs),
    video: videos[0] ? abs(videos[0]) : null,
    streams: findStreamSegments(dir),
    advertiser,
    adLibraryId,
    infoFile: info ? abs(info) : null,
    adPageId,
    adTitle,
    adRecord,
    infoTime,
    liveStatus,
    notes,
    unreadable,
    collected,
  };
}

/**
 * Imports every case folder of `o.casesDir` into `o.outDir` (input.json, mapping.json, provenance.json, fixtures/).
 * Errors are kept per case: a file that cannot be read or parsed is listed in `skipped` (`<case>/<file>`) and the
 * case goes on with its other files; a case that fails part-way is rolled back and skipped with the reason. Only
 * a failure that concerns the whole batch (the cases folder or the output cannot be read or written) throws.
 */
export async function importCases(o: CaseImportOptions): Promise<CaseImportResult> {
  const log = o.log ?? (() => {});
  const importedAt = new Date().toISOString();
  const fix = path.join(o.outDir, "fixtures");
  /** Checksums by role and path: a screenshot shared by several pages of a case is read once. */
  const hashed = new Map<string, CaseFileRecord>();
  const filesOf = (entries: Array<{ role: CaseFileRole; file: string }>): CaseFileRecord[] =>
    entries.map((e) => {
      const key = `${e.role}|${e.file}`;
      if (!hashed.has(key)) hashed.set(key, hashCaseFiles([e])[0]);
      return hashed.get(key)!;
    });
  const http: Record<string, HttpFixture> = {};
  const dns: Record<string, Partial<Record<DnsRecordType, string[]>>> = {};
  const cymru: Record<string, string[]> = {};
  const hostIps = new Map<string, Set<string>>();
  const landingHosts = new Set<string>();
  const cases: ImportedCase[] = [];
  const skipped: CaseImportResult["skipped"] = [];
  const failedLookups: string[] = [];
  const records: Array<Record<string, unknown>> = [];
  /** SHA-256 of the page body stored under each fixture key: one address saved with different content needs separate keys. */
  const bodyAt = new Map<string, string>();

  /** Skips a whole case with the reason (`skipped` and the log); the other cases of the batch go on. */
  const skipCase = (id: string, reason: string) => {
    skipped.push({ id, reason });
    log(`[${id}] ${reason}`);
  };
  // A case folder that cannot be read (a broken link, a file the scan trips on) is skipped with the reason.
  const scans: CaseScan[] = [];
  for (const id of readdirSync(o.casesDir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const dir = path.resolve(o.casesDir, id);
    try {
      if (statSync(dir).isDirectory()) scans.push(scanCase(o.casesDir, id));
    } catch (e) {
      skipCase(id, `nie udało się odczytać sprawy: ${errorText(e, dir)}`);
    }
  }

  // A HAR filed in another case: it holds exactly the address a page of this case was saved from.
  const spare = scans.flatMap((s) => s.spareHars);
  for (const s of scans) {
    for (const c of s.captures) {
      if (c.main || !c.savedFrom) continue;
      const har = spare.find((h) => h.caseId !== s.id && h.entries.some((e) => isDocument(e) && e.request.url === c.savedFrom));
      if (!har) continue;
      c.har = har;
      c.main = mainDocument(har.entries, c.savedFrom);
      s.notes.push(`HAR ${path.basename(har.file)} z katalogu sprawy ${har.caseId} zawiera dokładnie adres tej strony, więc został użyty tutaj`);
    }
  }

  /**
   * Turns the scan of one case into its records, fixtures and `skipped` entries. It may throw part-way (a file
   * the scan did not read); the loop below then rolls back what the case added and skips it with the reason.
   */
  const importScan = (s: CaseScan): void => {
    const id = s.id;
    for (const n of s.notes) log(`[${id}] ${n}`);
    for (const h of s.spareHars) {
      if (!scans.some((x) => x.captures.some((c) => c.har === h))) log(`[${id}] HAR ${path.basename(h.file)} nie pasuje do żadnej strony tej sprawy, pominięty`);
    }
    // a page's video saved as an HLS stream: stitched into one file; it is the case's video when there is no other
    const stitched = s.streams.flatMap((st, k) => {
      const from = path.relative(s.dir, st.dir) || ".";
      try {
        const out = stitchSegments(st.segments, path.join(o.outDir, "media", `${safeFileName(id)}-wideo-strony${k ? `-${k + 1}` : ""}.ts`));
        log(`[${id}] wideo strony z HLS: ${st.segments.length} fragmentów z ${from} sklejone w ${path.basename(out)}`);
        return [out];
      } catch (e) {
        log(`[${id}] wideo strony z HLS z ${from} pominięte: ${errorText(e, s.dir)}`);
        return [];
      }
    });
    /** Bytes of an asset file of a saved page; null when it is over `maxBytes` or cannot be read (logged: the page itself still imports). */
    const readAsset = (file: string, maxBytes = Infinity): Buffer | null => {
      try {
        return statSync(file).size > maxBytes ? null : readFileSync(file);
      } catch (e) {
        log(`[${id}] plik ${path.relative(s.dir, file)} pominięty: ${errorText(e, s.dir)}`);
        return null;
      }
    };
    const video = s.video ?? stitched[0] ?? null;
    const media = {
      screenshot: s.screenshots[0] ?? null,
      moreScreenshots: s.screenshots.slice(1),
      pageScreenshots: s.pageScreenshots,
      video,
      moreVideos: stitched.filter((f) => f !== video),
      advertiser: s.advertiser,
      adLibraryId: s.adLibraryId,
      adPageId: s.adPageId,
      adTitle: s.adTitle,
      adRecord: s.adRecord,
      sources: s.collected?.sources ?? [],
      scan: s.collected?.scan ?? null,
    };
    const mediaFiles: Array<{ role: CaseFileRole; file: string }> = [
      ...(media.screenshot ? [{ role: "screenshot" as const, file: media.screenshot }] : []),
      ...media.moreScreenshots.map((file) => ({ role: "more_screenshot" as const, file })),
      ...media.pageScreenshots.map((file) => ({ role: "page_screenshot" as const, file })),
      ...(media.video ? [{ role: s.video ? ("video" as const) : ("page_video" as const), file: media.video }] : []),
      ...media.moreVideos.map((file) => ({ role: "page_video" as const, file })),
      ...(s.infoFile ? [{ role: "info_json" as const, file: s.infoFile }] : []),
    ];
    /** Files behind one page record: its HAR and saved page, and the media of the case. */
    const filesOfCapture = (c: Capture | null) =>
      filesOf([
        ...(c?.har ? [{ role: "har" as const, file: c.har.file }] : []),
        ...(c?.htmlName ? [{ role: "saved_html" as const, file: path.join(s.dir, ...c.htmlName.split("/")) }] : []),
        ...mediaFiles,
      ]);
    const hasMedia = !!(media.screenshot || media.video || media.adLibraryId || media.adRecord);
    if (!s.captures.length && !hasMedia) return; // not a case folder (or nothing in it could be read: see `unreadable`)

    // The same page saved twice (same address and title) is one capture; the copy with a HAR wins.
    const pages: Array<{ c: Capture; norm: NonNullable<ReturnType<typeof normalizeUrl>>; body: Buffer }> = [];
    const seen = new Map<string, number>();
    for (const c of s.captures) {
      const norm = c.landingUrl ? normalizeUrl(c.landingUrl) : null;
      if (!c.landingUrl || !norm) {
        skipped.push({ id: c.name ? `${id}/${c.name}` : id, reason: "brak adresu strony (ani komentarza „saved from url”, ani dokumentu w HAR)" });
        continue;
      }
      if (!c.main && !c.saved && !c.requestsOnly) {
        skipped.push({ id: c.name ? `${id}/${c.name}` : id, reason: "HAR bez treści dokumentu i brak zapisanej strony" });
        continue;
      }
      const body = c.main ? harBody(c.main)! : c.saved !== null ? Buffer.from(c.saved.replace(DOWNLOAD_SUFFIX, ""), "utf8") : Buffer.alloc(0);
      const key = `${norm.host}${new URL(norm.url).pathname}|${titleOf(body.toString("utf8"))}`;
      const prev = seen.get(key);
      if (prev === undefined) {
        seen.set(key, pages.length);
        pages.push({ c, norm, body });
      } else if (!pages[prev].c.main && c.main) pages[prev] = { c, norm, body };
    }
    if (!pages.length && !hasMedia) return;

    const earliestHar = (c: Capture | null) => (c?.har ? earliest(c.har.entries) : null);
    const mediaTime = media.screenshot ? screenshotTime(path.basename(media.screenshot)) : null;
    const ids = new Set<string>();
    const push = (rec: ImportedCase) => {
      cases.push(rec);
      // columns of a library record first: the case's own fields below win where both are known
      const libraryColumns: Record<string, string> = rec.adRecord ? adRecordColumns(rec.adRecord) : {};
      delete libraryColumns.id;
      records.push({
        ...libraryColumns,
        id: rec.id,
        landing_url: rec.landingUrl,
        screenshot: rec.screenshot,
        first_seen: rec.firstSeen ?? libraryColumns.first_seen ?? null,
        ...(rec.id !== rec.caseId ? { case: rec.caseId } : {}),
        ...(rec.moreScreenshots.length ? { more_screenshots: rec.moreScreenshots } : {}),
        ...(rec.video ? { video: rec.video } : {}),
        ...(rec.moreVideos.length ? { more_videos: rec.moreVideos } : {}),
        ...(rec.advertiser ? { advertiser: rec.advertiser } : {}),
        ...(s.liveStatus ? { live_status: s.liveStatus } : {}),
        ...(rec.adLibraryId ? { ad_library_id: rec.adLibraryId } : {}),
        ...(rec.adTitle ? { ad_title: rec.adTitle } : {}),
        ...(rec.adPageId ? { advertiser_id: rec.adPageId, ad_platform: "meta" } : {}),
      });
    };

    if (!pages.length) {
      // a collected folder names its target even when no copy of the page survived (press images only)
      const target = s.collected?.target ?? s.adRecord?.landingUrl ?? null;
      const targetHost = target ? normalizeUrl(target)?.host : null;
      if (targetHost) landingHosts.add(targetHost);
      push({ id, caseId: id, capture: "", landingUrl: target, landingInferred: false, pageKey: null, bodySource: "none", har: null, harFromCase: null, savedHtml: null, ...media, files: filesOfCapture(null), importedAt, firstSeen: mediaTime ?? s.infoTime });
      log(`[${id}] bez strony docelowej | zrzuty: ${s.screenshots.length} | wideo: ${media.video ? "tak" : "nie"}${media.adLibraryId ? ` | biblioteka reklam: ${media.adLibraryId}` : ""}`);
      return;
    }

    for (const { c, norm, body } of pages) {
      let itemId = pages.length > 1 && c.name ? `${id}_${c.name}` : id;
      for (let k = 2; ids.has(itemId); k++) itemId = `${id}_${c.name || "strona"}_${k}`;
      ids.add(itemId);
      const ownEntries = c.har ? pageEntries(c.har.entries, c.main).filter((e) => !fromExtension(e)) : [];
      for (const e of ownEntries) {
        const host = hostOf(e.request.url);
        const ip = e.serverIPAddress?.replace(/^\[|\]$/g, "");
        if (!host || !ip) continue;
        if (!hostIps.has(host)) hostIps.set(host, new Set());
        hostIps.get(host)!.add(ip);
      }
      landingHosts.add(norm.host);

      // One address saved with different content (cloaking, a funnel behind one URL): each copy gets its own key.
      const sha = createHash("sha256").update(body).digest("hex");
      let pageKey = urlKey(norm.url)!;
      let landingUrl = c.landingUrl!;
      if ((bodyAt.get(pageKey) ?? sha) !== sha) {
        const tag = `#capture=${safeName(itemId)}`;
        pageKey += tag;
        landingUrl = landingUrl.replace(/#.*$/, "") + tag;
      }
      bodyAt.set(pageKey, sha);

      const bodyFile = `pages/${safeName(itemId)}.html`;
      write(path.join(fix, bodyFile), body);
      const bodySource: ImportedCase["bodySource"] = c.main || c.requestsOnly ? "har" : c.archivedAt ? "wayback" : "saved-html";
      const requests = c.har ? requestUrls(ownEntries) : [];
      http[pageKey] = {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", ...(c.main ? harHeaders(c.main) : {}) },
        bodyFile,
        ...(requests.length ? { requests } : {}),
        ...(c.main ? tlsOfEntry(c.main) : {}),
      };
      if (!c.main && c.htmlName) {
        // Images of the saved page (favicon), under the addresses its rewritten links resolve to.
        const htmlDir = path.join(s.dir, path.dirname(c.htmlName));
        const assetsDir = readdirSync(htmlDir).find((f) => f.endsWith("_files") && statSync(path.join(htmlDir, f)).isDirectory());
        const esc = (x: string) => x.replace(/%/g, "%25").replace(/\?/g, "%3F").replace(/#/g, "%23");
        for (const f of assetsDir ? readdirSync(path.join(htmlDir, assetsDir)).filter((x) => IMAGE_EXT.test(x)) : []) {
          const k = urlKey(`./${esc(assetsDir!)}/${esc(f)}`, norm.url);
          if (!k || http[k]) continue;
          const data = readAsset(path.join(htmlDir, assetsDir!, f));
          if (!data) continue;
          const rel = `assets/${safeName(itemId)}/${safeName(f)}`;
          write(path.join(fix, rel), data);
          http[k] = { status: 200, headers: {}, bodyFile: rel };
        }
      }
      // Own scripts of the saved page (I25): every script of `_files` (its links are relative), under the
      // address the rewritten src resolves to (download suffix removed like in the page body).
      let scriptCount = 0;
      if (!c.main && c.htmlName) {
        const htmlDir = path.join(s.dir, path.dirname(c.htmlName));
        const assetsDir = readdirSync(htmlDir).find((f) => f.endsWith("_files") && statSync(path.join(htmlDir, f)).isDirectory());
        const esc = (x: string) => x.replace(/%/g, "%25").replace(/\?/g, "%3F").replace(/#/g, "%23");
        for (const f of assetsDir ? readdirSync(path.join(htmlDir, assetsDir)).filter((x) => SAVED_SCRIPT.test(x)).sort() : []) {
          if (scriptCount >= TEXT_CONFIG.kitStrings.maxScriptsPerPage) break;
          const k = urlKey(`./${esc(assetsDir!)}/${esc(f.replace(/\.(?:pobrane|download)$/i, ""))}`, norm.url);
          if (!k || http[k]) continue;
          const data = readAsset(path.join(htmlDir, assetsDir!, f), TEXT_CONFIG.kitStrings.maxScriptBytes);
          if (!data) continue;
          const rel = `assets/${safeName(itemId)}/js-${scriptCount++}`;
          write(path.join(fix, rel), data);
          http[k] = { status: 200, headers: { "content-type": "application/javascript" }, bodyFile: rel };
        }
      }
      // Own scripts recorded in the HAR (same registrable domain as the page), under their address without
      // the query, as the page kit names its script assets. Third-party scripts are never kept.
      const pageDomain = registrableDomain(norm.url);
      for (const e of ownEntries) {
        if (scriptCount >= TEXT_CONFIG.kitStrings.maxScriptsPerPage) break;
        if (e.request.method !== "GET" || e.response.status !== 200) continue;
        const mime = e.response.content?.mimeType ?? "";
        const u = (() => {
          try {
            return new URL(e.request.url);
          } catch {
            return null; // an address the HAR could not record names no script
          }
        })();
        if (!u || !pageDomain || registrableDomain(u.hostname) !== pageDomain) continue;
        if (!(/javascript|ecmascript/i.test(mime) || e._resourceType === "script" || /\.m?js$/i.test(u.pathname))) continue;
        const k = `${u.protocol}//${u.host}${u.pathname}`;
        if (http[k]) continue;
        const data = harBody(e);
        if (!data || data.length > TEXT_CONFIG.kitStrings.maxScriptBytes) continue;
        const rel = `assets/${safeName(itemId)}/js-${scriptCount++}`;
        write(path.join(fix, rel), data);
        http[k] = { status: 200, headers: { "content-type": mime || "application/javascript" }, bodyFile: rel };
      }
      // Third-party scripts on free static hosts and jsDelivr `gh/` (B-333): kept so the stealer check can read the
      // fake libraries a copied kit loads; the other third-party scripts are never kept.
      let foreignCount = 0;
      for (const e of ownEntries) {
        if (foreignCount >= 5) break;
        if (e.request.method !== "GET" || e.response.status !== 200 || !isStealerCandidateUrl(e.request.url)) continue;
        const u = new URL(e.request.url);
        const k = `${u.protocol}//${u.host}${u.pathname}`;
        if (http[k]) continue;
        const data = harBody(e);
        if (!data || data.length > TEXT_CONFIG.kitStrings.maxScriptBytes) continue;
        const rel = `assets/${safeName(itemId)}/fjs-${foreignCount++}`;
        write(path.join(fix, rel), data);
        http[k] = { status: 200, headers: { "content-type": e.response.content?.mimeType || "application/javascript" }, bodyFile: rel };
      }
      // Images recorded in the HAR (favicons), under their original addresses.
      let n = 0;
      for (const e of ownEntries) {
        if (e.request.method !== "GET" || e.response.status !== 200) continue;
        const mime = e.response.content?.mimeType ?? "";
        const k = urlKey(e.request.url);
        if (!k || http[k]) continue;
        if (!(mime.startsWith("image/") || e._resourceType === "image" || IMAGE_EXT.test(new URL(k).pathname))) continue;
        const data = harBody(e);
        if (!data || data.length > MAX_ASSET_BYTES) continue;
        const rel = `assets/${safeName(itemId)}/har-${n++}`;
        write(path.join(fix, rel), data);
        http[k] = { status: 200, headers: mime ? { "content-type": mime } : {}, bodyFile: rel };
      }

      const harFromCase = c.har && c.har.caseId !== id ? c.har.caseId : null;
      push({
        id: itemId,
        caseId: id,
        capture: c.name,
        landingUrl,
        landingInferred: c.inferred,
        pageKey,
        bodySource,
        har: c.har ? path.relative(c.har.caseId === id ? s.dir : o.casesDir, c.har.file) : null,
        harFromCase,
        savedHtml: c.htmlName,
        ...media,
        files: filesOfCapture(c),
        importedAt,
        firstSeen: c.archivedAt ?? earliestHar(c) ?? mediaTime ?? s.infoTime,
      });
      log(
        `[${itemId}] ${norm.host} | treść: ${c.requestsOnly ? `tylko żądania z HAR (${requests.length})` : bodySource === "har" ? "HAR" : bodySource === "wayback" ? `kopia z archiwum (${c.archivedAt})` : "zapisana strona"} | obrazy z HAR: ${n} | skrypty własne: ${scriptCount} | zrzuty: ${s.screenshots.length}${media.video ? " | wideo" : ""}${c.inferred ? " | adres wywnioskowany" : ""}${pageKey.includes("#capture=") ? " | ten sam adres, inna treść" : ""}`,
      );
    }
  };

  for (const s of scans) {
    // files the scan could not read: each one a `skipped` entry, so a case left with nothing else keeps its reason
    for (const u of s.unreadable) skipCase(u.rel ? `${s.id}/${u.rel}` : s.id, u.reason);
    // state before the case: what it adds is taken back when it fails part-way (records, fixtures, hosts to look up)
    const mark = { cases: cases.length, records: records.length, skipped: skipped.length, http: Object.keys(http).length, bodies: bodyAt.size, hosts: landingHosts.size, ips: hostIps.size };
    try {
      importScan(s);
    } catch (e) {
      if (e instanceof ImportOutputError) throw e;
      cases.length = mark.cases;
      records.length = mark.records;
      skipped.length = mark.skipped;
      for (const k of Object.keys(http).slice(mark.http)) delete http[k];
      for (const k of [...bodyAt.keys()].slice(mark.bodies)) bodyAt.delete(k);
      for (const h of [...landingHosts].slice(mark.hosts)) landingHosts.delete(h);
      for (const h of [...hostIps.keys()].slice(mark.ips)) hostIps.delete(h);
      skipCase(s.id, `nie udało się zaimportować sprawy: ${errorText(e, s.dir)}`);
    }
  }

  // Lookups recorded when a collected folder was made: the state at that time wins over a later lookup.
  const recorded = new Map<string, RecordedLookups>();
  const scanned: ScanMeta[] = [];
  for (const s of scans) {
    const r = s.collected?.lookups;
    if (r) recorded.set(r.domain, r);
    if (s.collected?.scan) scanned.push(s.collected.scan);
  }
  for (const r of recorded.values()) {
    const rec = (dns[r.domain] ??= {});
    if (r.ns.length) rec.NS = r.ns;
    if (r.a.length && !hostIps.get(r.domain)?.size) rec.A = r.a.filter((ip) => !ip.includes(":"));
    if (r.rdap) write(path.join(fix, "rdap", `${safeName(r.domain)}.json`), JSON.stringify(r.rdap, null, 1));
  }
  // The AS a scan service saw for the page IP (the record names no prefix, so none is invented).
  for (const m of scanned) {
    const a = scanCymruAnswers(m);
    const q = a && cymruOriginQuery(m.ip!);
    if (!a || !q || cymru[q]) continue;
    cymru[q] = [a.origin];
    cymru[cymruAsNameQuery(a.asn)] ??= [a.asName];
  }

  // DNS: A/AAAA as captured in the HAR; the rest (and hosts without a HAR) through passive lookups.
  const quiet = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };
  for (const host of landingHosts) {
    const rec = (dns[host] ??= {});
    const captured = [...(hostIps.get(host) ?? [])];
    if (captured.length) {
      rec.A = captured.filter((ip) => !ip.includes(":"));
      rec.AAAA = captured.filter((ip) => ip.includes(":"));
    }
    if (!o.lookups || recorded.has(registrableDomain(host) ?? host)) continue;
    const lookups = o.lookups;
    const live = await quiet(() => lookups.dns(host, ["A", "AAAA", "CNAME"]), {});
    if (!captured.length) {
      rec.A = live.A ?? [];
      rec.AAAA = live.AAAA ?? [];
    }
    rec.CNAME = (live.CNAME ?? []).map(cleanName);
    const domain = registrableDomain(host) ?? host;
    const drec = (dns[domain] ??= {});
    const dlive = await quiet(() => lookups.dns(domain, ["NS", "MX", "TXT"]), {});
    drec.NS = (dlive.NS ?? []).map(cleanName).sort();
    drec.MX = (dlive.MX ?? []).map(cleanName).sort();
    drec.TXT = dlive.TXT ?? [];
    const rdapFile = path.join(fix, "rdap", `${safeName(domain)}.json`);
    if (!existsSync(rdapFile)) {
      const raw = await quiet(() => lookups.rdapRaw(domain), null);
      if (raw) write(rdapFile, JSON.stringify(raw, null, 1));
      else failedLookups.push(`rdap:${domain}`);
    }
    const ctFile = path.join(fix, "crtsh", `${safeName(domain)}.json`);
    if (lookups.ctRaw && !existsSync(ctFile)) {
      const raw = await quiet(() => lookups.ctRaw!(domain), null);
      if (raw) write(ctFile, JSON.stringify(raw));
      else failedLookups.push(`ct:${domain}`);
    }
  }
  if (o.lookups) {
    const lookups = o.lookups;
    const ips = new Set(Object.values(dns).flatMap((r) => [...(r.A ?? []), ...(r.AAAA ?? [])]));
    for (const ip of ips) {
      const q = cymruOriginQuery(ip);
      if (!q || cymru[q]) continue;
      const answers = await quiet(() => lookups.txt(q), []);
      if (!answers.length) continue;
      cymru[q] = answers;
      const origin = pickCymruOrigin(answers);
      for (const asn of origin?.asns ?? []) {
        const q2 = cymruAsNameQuery(asn);
        if (!cymru[q2]) cymru[q2] = await quiet(() => lookups.txt(q2), []);
      }
    }
  }

  write(path.join(fix, "http.json"), JSON.stringify(http, null, 1));
  write(path.join(fix, "dns.json"), JSON.stringify(dns, null, 1));
  write(path.join(fix, "cymru.json"), JSON.stringify(cymru, null, 1));
  write(
    path.join(o.outDir, "input.json"),
    JSON.stringify(records, null, 1),
  );
  const has = (col: string) => records.some((r) => col in r);
  const mapping = {
    id: "id",
    landingUrl: "landing_url",
    imagePath: "screenshot",
    firstSeen: "first_seen",
    ...(has("more_screenshots") ? { extraImagePaths: "more_screenshots" } : {}),
    ...(has("video") ? { videoPath: "video" } : {}),
    ...(has("more_videos") ? { extraVideoPaths: "more_videos" } : {}),
    ...(has("advertiser") ? { advertiser: "advertiser" } : {}),
    ...(has("text") ? { text: "text" } : {}),
    ...(has("platform") ? { platform: "platform" } : {}),
    ...(has("image_url") ? { imageUrl: "image_url" } : {}),
    ...(has("last_seen") ? { lastSeen: "last_seen" } : {}),
  };
  write(path.join(o.outDir, "mapping.json"), JSON.stringify(mapping, null, 1));
  write(path.join(o.outDir, "provenance.json"), JSON.stringify({ generatedAt: importedAt, lookups: !!o.lookups, cases, skipped, failedLookups }, null, 1));
  failedLookups.sort();
  return { cases, skipped, httpEntries: Object.keys(http).length, failedLookups };
}
