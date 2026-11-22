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
import { cymruAsNameQuery, cymruOriginQuery, pickCymruOrigin } from "../osint/asn";
import type { DnsRecordType } from "../osint/dns";
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
  advertiser: string | null;
  adLibraryId: string | null;
  /** Page ID of the advertiser from the library ad's description (`uploader_id`), or null. */
  adPageId: string | null;
  /** Record of a public ad library (`adlib.json`, written by `adRecordToCaseDir`), or null. */
  adRecord: AdRecord | null;
  firstSeen: string | null;
  /** Public sources of a collected folder (address, type, entry and access dates). */
  sources: CollectedSource[];
  /** Page metadata from a scan service's search record. */
  scan: ScanMeta | null;
}

export interface CaseImportResult {
  cases: ImportedCase[];
  skipped: Array<{ id: string; reason: string }>;
  httpEntries: number;
  /** Lookups that gave nothing, as "rdap:<domain>" / "ct:<domain>" (rate limits and timeouts are common). */
  failedLookups: string[];
}

interface HarEntry {
  _resourceType?: string;
  serverIPAddress?: string;
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
}

const MAX_REQUESTS = 1000;

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

function write(file: string, data: Buffer | string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
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

/** Files of a case, the case folder first. Asset folders of saved pages and of capture bundles are not entered. */
export function walkCase(root: string): CaseFile[] {
  const out: CaseFile[] = [];
  const visit = (dir: string, depth: number) => {
    const subdirs: string[] = [];
    for (const name of readdirSync(path.join(root, dir)).sort()) {
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
  advertiser: string | null;
  adLibraryId: string | null;
  adPageId: string | null;
  adRecord: AdRecord | null;
  infoTime: string | null;
  notes: string[];
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

function scanCase(casesDir: string, id: string, log: (m: string) => void): CaseScan {
  const dir = path.resolve(casesDir, id); // absolute: media paths in input.json must not depend on the working directory
  const files = walkCase(dir);
  const abs = (f: CaseFile) => path.join(dir, ...f.rel.split("/"));
  const notes: string[] = [];
  const collected = readCollected(files, abs, notes);

  const hars: Array<Har & { dir: string }> = [];
  for (const f of files.filter((x) => /\.har$/i.test(x.name))) {
    try {
      const j = JSON.parse(readFileSync(abs(f), "utf8")) as { log?: { entries?: HarEntry[]; pages?: Array<{ title?: string }> } };
      hars.push({ file: abs(f), caseId: id, dir: f.dir, entries: j.log?.entries ?? [], pageUrl: j.log?.pages?.[0]?.title ?? null });
    } catch (e) {
      log(`[${id}] nie udało się wczytać HAR ${f.rel}: ${(e as Error).message}`);
    }
  }
  const used = new Set<Har>();
  const captures: Capture[] = [];
  const dirs = [...new Set(files.map((f) => f.dir))];
  for (const d of dirs) {
    const here = files.filter((f) => f.dir === d);
    // in a collected folder only web-archive copies are pages (not a scan service's result page, not a press article)
    const htmls = here.filter((f) => HTML_EXT.test(f.name) && !SAVED_FRAME.test(f.name) && (!collected || isCollectedPage(f.name)));
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
    for (const f of htmls) {
      const archivedAt = collected ? waybackTime(f.name) : null;
      if (archivedAt) {
        const saved = unwrapWayback(readFileSync(abs(f), "utf8"));
        captures.push({ name, dir: d, htmlName: f.rel, saved, savedFrom: bundleUrl, har: null, main: null, landingUrl: bundleUrl, archivedAt, inferred: false });
        continue;
      }
      const saved = readFileSync(abs(f), "utf8");
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
  const info = rootMedia.find((f) => /\.info\.json$/i.test(f.name));
  if (info) {
    try {
      const j = JSON.parse(readFileSync(abs(info), "utf8")) as { webpage_url?: string; playlist_uploader?: string; uploader?: string; epoch?: number; uploader_id?: string };
      adLibraryId = /\/ads\/library\/?\?(?:.*&)?id=(\d{6,})/.exec(j.webpage_url ?? "")?.[1] ?? null;
      advertiser = j.playlist_uploader ?? j.uploader ?? null;
      // the uploader of a library ad is its advertiser page: a stable ID, unlike the name
      adPageId = adLibraryId && /^\d+$/.test(j.uploader_id ?? "") ? (j.uploader_id ?? null) : null;
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
    advertiser,
    adLibraryId,
    adPageId,
    adRecord,
    infoTime,
    notes,
    collected,
  };
}

export async function importCases(o: CaseImportOptions): Promise<CaseImportResult> {
  const log = o.log ?? (() => {});
  const fix = path.join(o.outDir, "fixtures");
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

  const scans = readdirSync(o.casesDir)
    .filter((d) => statSync(path.join(o.casesDir, d)).isDirectory())
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((id) => scanCase(o.casesDir, id, log));

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

  for (const s of scans) {
    const id = s.id;
    for (const n of s.notes) log(`[${id}] ${n}`);
    for (const h of s.spareHars) {
      if (!scans.some((x) => x.captures.some((c) => c.har === h))) log(`[${id}] HAR ${path.basename(h.file)} nie pasuje do żadnej strony tej sprawy, pominięty`);
    }
    const media = {
      screenshot: s.screenshots[0] ?? null,
      moreScreenshots: s.screenshots.slice(1),
      pageScreenshots: s.pageScreenshots,
      video: s.video,
      advertiser: s.advertiser,
      adLibraryId: s.adLibraryId,
      adPageId: s.adPageId,
      adRecord: s.adRecord,
      sources: s.collected?.sources ?? [],
      scan: s.collected?.scan ?? null,
    };
    const hasMedia = !!(media.screenshot || media.video || media.adLibraryId || media.adRecord);
    if (!s.captures.length && !hasMedia) continue; // not a case folder

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
    if (!pages.length && !hasMedia) continue;

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
        ...(rec.advertiser ? { advertiser: rec.advertiser } : {}),
        ...(rec.adLibraryId ? { ad_library_id: rec.adLibraryId } : {}),
        ...(rec.adPageId ? { advertiser_id: rec.adPageId, ad_platform: "meta" } : {}),
      });
    };

    if (!pages.length) {
      // a collected folder names its target even when no copy of the page survived (press images only)
      const target = s.collected?.target ?? s.adRecord?.landingUrl ?? null;
      const targetHost = target ? normalizeUrl(target)?.host : null;
      if (targetHost) landingHosts.add(targetHost);
      push({ id, caseId: id, capture: "", landingUrl: target, landingInferred: false, pageKey: null, bodySource: "none", har: null, harFromCase: null, savedHtml: null, ...media, firstSeen: mediaTime ?? s.infoTime });
      log(`[${id}] bez strony docelowej | zrzuty: ${s.screenshots.length} | wideo: ${media.video ? "tak" : "nie"}${media.adLibraryId ? ` | biblioteka reklam: ${media.adLibraryId}` : ""}`);
      continue;
    }

    for (const { c, norm, body } of pages) {
      let itemId = pages.length > 1 && c.name ? `${id}_${c.name}` : id;
      for (let k = 2; ids.has(itemId); k++) itemId = `${id}_${c.name || "strona"}_${k}`;
      ids.add(itemId);
      for (const e of c.har?.entries ?? []) {
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
      const requests = c.har ? requestUrls(c.har.entries) : [];
      http[pageKey] = {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", ...(c.main ? harHeaders(c.main) : {}) },
        bodyFile,
        ...(requests.length ? { requests } : {}),
      };
      if (!c.main && c.htmlName) {
        // Images of the saved page (favicon), under the addresses its rewritten links resolve to.
        const htmlDir = path.join(s.dir, path.dirname(c.htmlName));
        const assetsDir = readdirSync(htmlDir).find((f) => f.endsWith("_files") && statSync(path.join(htmlDir, f)).isDirectory());
        const esc = (x: string) => x.replace(/%/g, "%25").replace(/\?/g, "%3F").replace(/#/g, "%23");
        for (const f of assetsDir ? readdirSync(path.join(htmlDir, assetsDir)).filter((x) => IMAGE_EXT.test(x)) : []) {
          const k = urlKey(`./${esc(assetsDir!)}/${esc(f)}`, norm.url);
          if (!k || http[k]) continue;
          const rel = `assets/${safeName(itemId)}/${safeName(f)}`;
          write(path.join(fix, rel), readFileSync(path.join(htmlDir, assetsDir!, f)));
          http[k] = { status: 200, headers: {}, bodyFile: rel };
        }
      }
      // Images recorded in the HAR (favicons), under their original addresses.
      let n = 0;
      for (const e of c.har?.entries ?? []) {
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
        firstSeen: c.archivedAt ?? earliestHar(c) ?? mediaTime ?? s.infoTime,
      });
      log(
        `[${itemId}] ${norm.host} | treść: ${c.requestsOnly ? `tylko żądania z HAR (${requests.length})` : bodySource === "har" ? "HAR" : bodySource === "wayback" ? `kopia z archiwum (${c.archivedAt})` : "zapisana strona"} | obrazy z HAR: ${n} | zrzuty: ${s.screenshots.length}${media.video ? " | wideo" : ""}${c.inferred ? " | adres wywnioskowany" : ""}${pageKey.includes("#capture=") ? " | ten sam adres, inna treść" : ""}`,
      );
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
    ...(has("advertiser") ? { advertiser: "advertiser" } : {}),
    ...(has("text") ? { text: "text" } : {}),
    ...(has("platform") ? { platform: "platform" } : {}),
    ...(has("image_url") ? { imageUrl: "image_url" } : {}),
    ...(has("last_seen") ? { lastSeen: "last_seen" } : {}),
  };
  write(path.join(o.outDir, "mapping.json"), JSON.stringify(mapping, null, 1));
  write(path.join(o.outDir, "provenance.json"), JSON.stringify({ generatedAt: new Date().toISOString(), lookups: !!o.lookups, cases, skipped, failedLookups }, null, 1));
  failedLookups.sort();
  return { cases, skipped, httpEntries: Object.keys(http).length, failedLookups };
}
