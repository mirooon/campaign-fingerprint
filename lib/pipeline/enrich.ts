/**
 * Enrichment: items -> pages (redirect chain, extraction, page kit, favicon, archive),
 * hosts (A/AAAA + CNAME chain), domains (NS/MX/TXT, RDAP, CT), IPs (ASN), image hashes,
 * campaign parameters and personas (from text, input columns, optional NER).
 * Opt-in: cloaking check (two extra GETs), OCR, ASR, audio fingerprints, speaker embeddings
 * (SpeechBrain), faces of public figures (OpenCV) and Meta Ad Library details (MetaAdsCollector) (skipped
 * quietly when the tools are missing). Concurrency-limited, cached (live mode) and
 * failure-tolerant: errors are recorded, never thrown.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pLimit from "p-limit";
import { CACHE_TTL, createCache, type FileCache } from "../cache";
import type { LlmProvider } from "../llm/types";
import { detectAsr, transcribe } from "../media/asr";
import { detectFpcalc, fingerprintAudio, type AudioFingerprint } from "../media/audioFp";
import { hashFavicon, hashImage } from "../media/imageHash";
import { brandVectors, matchBrand, type BrandHit } from "../media/brand";
import { cloakingVerdict, isBotChallenge } from "../osint/cloaking";
import { compactEmbedding, detectClip, embedImage, embeddingKey, embedVideo, extractFrames } from "../media/imageEmbed";
import { detectOcr, ocrImage } from "../media/ocr";
import { nonEmptyFile } from "../media/tools";
import { detectFaces, type FaceHit } from "../media/face";
import { detectSpeaker, embedSpeakers, embedSpeakerWindows, loadVoiceIndex, matchVoiceWindows, speakerVadDir, type VoiceIndex } from "../media/speaker";
import { fetchAdCreative } from "../adlib/ytdlp";
import { AD_LIBRARY_ID_RE, detectAdLibrary, lookupAdLibrary, type AdLibraryInfo } from "../osint/adLibrary";
import { copyProvenance, findArchivedCopy, type ArchiveConfig, type ArchivedCopy, type ArchiveSource } from "../osint/archive";
import { sponsoredPost, stripUiChrome } from "../text/uiChrome";
import { readAddressBar, readAddressBarVideo, type ObservedAddress } from "../media/addressBar";
import { extractCampaignParams } from "../osint/campaignParams";
import { extractFromHtml, extractFromText, type PageExtract } from "../osint/extract";
import type { FetchPageResult } from "../osint/fetchPage";
import { canonicalIp, isIpAddress, isPublicIp } from "../osint/ip";
import { domSimhash, extractPageKit, withRequestUrls } from "../osint/pagekit";
import type { RdapInfo } from "../osint/rdap";
import { normalizeUrl, registrableDomain } from "../osint/urls";
import {
  extractPersonsNer,
  loadWatchlist,
  matchPersonas,
  personasFromIngest,
  personaSlug,
  PUBLIC_PERSONS_FILE,
  type CompiledWatchlist,
  type PersonaMatch,
} from "../text/persona";
import type { EnrichmentSources } from "./sources";
import type {
  CloakingCheck,
  CloakingVariant,
  DomainInfo,
  EnrichedDataset,
  HostInfo,
  ImageInfo,
  Item,
  ItemEnrichment,
  PageInfo,
} from "./types";

/** User-Agents of the opt-in cloaking check: an ad-platform link crawler and a mobile browser. */
export const CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
export const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

export interface EnrichOptions {
  sources: EnrichmentSources;
  /** Directory against which relative imagePath/videoPath values are resolved. */
  baseDir: string;
  concurrency?: number;
  skip?: Partial<Record<"page" | "favicon" | "image" | "dns" | "rdap" | "ct" | "asn", boolean>>;
  onProgress?: (stage: string, done: number, total: number) => void;
  log?: (message: string) => void;
  imageCache?: FileCache | false;
  /** Persona watchlist (public figures) matched in ad text, page text and OCR/ASR text. */
  personas?: CompiledWatchlist | null;
  /** Opt-in person-name NER through the configured LLM (PLLuM/Bielik/Claude). */
  ner?: { provider: LlmProvider; cache?: FileCache | false } | null;
  /** Opt-in cloaking check: two extra GETs (crawler UA, mobile UA) per landing page. */
  cloaking?: boolean;
  /** DOM simhash distance above which the two variants count as different pages. */
  cloakingDomThreshold?: number;
  /** Opt-in media adapters; each is skipped quietly when its tool is unavailable. */
  ocr?: boolean;
  asr?: boolean;
  audio?: boolean;
  /** Opt-in CLIP embedding of creative images (semantic similarity: same template, different variant). */
  clip?: boolean;
  /** Opt-in SpeechBrain speaker embedding of video/audio creatives (same voice across ads) and, with the gallery data/voices, the persona of a voice similar to a public figure of the closed list. */
  speaker?: boolean;
  /** Replaces the Python adapter of the voice gallery match (tests inject a recorded result). */
  voicesAdapter?: typeof embedSpeakerWindows;
  /** Replaces data/voices/index.json (tests); null means "no gallery". */
  voiceIndex?: VoiceIndex | null;
  /** Opt-in faces: boxes in the creative images, screenshots and video frames, and the persona when a face is similar to a public figure on the closed list (OpenCV YuNet + SFace). */
  faces?: boolean;
  /** Replaces the Python adapter of `faces` (tests inject a recorded result). */
  facesAdapter?: typeof detectFaces;
  /** With `faces`: compare only with this person id from the list (1:1 verification at that person's request). */
  facesOnly?: string;
  /** Opt-in Meta Ad Library lookup of ad-library IDs via MetaAdsCollector (live mode only). */
  adLibrary?: boolean;
  /** Archive decoded HTML of fetched pages here (content-addressed by raw-body SHA-256). */
  archiveDir?: string | null;
  /**
   * Opt-in archive step: for a landing page that could not be fetched (or shows a block page), look for a
   * public copy (urlscan, Wayback) and feed the page features from it, with its provenance. Passive.
   */
  archive?: {
    sources: ArchiveSource[];
    config?: ArchiveConfig;
    /** Whether page texts (title, description, visible text) show a parking or suspension notice instead of the page. */
    isBlockPage?: (texts: Array<string | null | undefined>) => boolean;
    /** When set, the step is skipped with this reason (an offline run) and no source is asked. */
    skipReason?: string;
    /**
     * RDAP lookup for the era check when `sources` has no record of the domain (a run on saved files has no
     * live lookups, yet the copy of a re-registered domain must still be told from the current one).
     */
    rdap?: (domain: string) => Promise<RdapInfo | null>;
  } | null;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function dedupePersonas(list: PersonaMatch[]): PersonaMatch[] {
  const seen = new Set<string>();
  const out: PersonaMatch[] = [];
  for (const p of list) {
    const key = `${p.id}|${p.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * Names of the closed list of public figures (data/osoby-publiczne.json) by person id, to give a
 * persona found by a face or a voice its name and role. An unreadable list is logged and gives an
 * empty map (the persona then carries the id as its name).
 * @param trait what the persona comes from ("twarzy", "głosu"), for the log line
 */
function loadPublicPeople(trait: string, log: (message: string) => void): Map<string, { name: string; role: string | null; category: string | null }> {
  try {
    return new Map(loadWatchlist(path.join(process.cwd(), PUBLIC_PERSONS_FILE)).map((e) => [e.id ?? personaSlug(e.name), { name: e.name, role: e.role ?? null, category: e.category ?? null }]));
  } catch (e) {
    log(`lista osób publicznych nieczytelna (${errMsg(e)}): persona z ${trait} pod identyfikatorem`);
    return new Map();
  }
}

/**
 * Face step of the enrichment: finds faces in each item's creative image, further screenshots and
 * video frames (the same frames CLIP takes) and sets `faces` on its enrichment. A face similar to
 * a person on the closed list (data/osoby-publiczne.json) also adds a persona with source "face"
 * (similarity kept, the vector never): a trait of a group of similar campaigns, to be reviewed by a
 * person. One adapter call for the whole batch; when the adapter is missing the reason is logged
 * ("twarze pominięte: ...") and nothing is set.
 * @param perItem enrichments by item id, changed in place
 */
async function enrichFaces(items: Item[], perItem: Record<string, ItemEnrichment>, opts: EnrichOptions, log: (message: string) => void): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "starter-faces-"));
  try {
    // file given to the adapter -> the items that show it (two records can share one file) and the label stored in the result
    const jobs = new Map<string, Array<{ itemId: string; label: string }>>();
    let n = 0;
    const abs = (p: string) => (path.isAbsolute(p) ? p : path.join(opts.baseDir, p));
    /** Registers a picture for the adapter: `file` is what it reads, `label` what the result will show (the path or `video#frameN`). */
    const addJob = (file: string, itemId: string, label: string) => jobs.set(file, [...(jobs.get(file) ?? []), { itemId, label }]);
    /** Writes in-memory bytes (a downloaded image, a video frame) to a temporary file and registers it. */
    const addBytes = async (itemId: string, label: string, bytes: Buffer) => {
      const file = path.join(dir, `${n++}.img`);
      await writeFile(file, bytes);
      addJob(file, itemId, label);
    };
    for (const it of items) {
      const enr = perItem[it.id];
      if (!enr) continue;
      try {
        for (const rel of [it.imagePath, ...(it.extraImagePaths ?? [])]) if (rel) addJob(abs(rel), it.id, rel);
        if (!it.imagePath && it.imageUrl) {
          const bytes = await opts.sources.fetchBinary(it.imageUrl);
          if (bytes) await addBytes(it.id, it.imageUrl, bytes);
        }
        if (it.videoPath) {
          const frames = await extractFrames(abs(it.videoPath));
          for (const [i, frame] of frames.entries()) await addBytes(it.id, `${it.videoPath}#kadr${i + 1}`, frame);
        }
      } catch (e) {
        enr.errors.push(`faces: ${errMsg(e)}`);
      }
    }
    if (!jobs.size) return;
    const found = await (opts.facesAdapter ?? detectFaces)([...jobs.keys()], { only: opts.facesOnly });
    if (!Array.isArray(found)) {
      log(`twarze pominięte: ${found.skipped}`);
      return;
    }
    const people = loadPublicPeople("twarzy", log);
    const byItem = new Map<string, FaceHit[]>();
    for (const owners of jobs.values()) for (const { itemId } of owners) byItem.set(itemId, []);
    for (const hit of found) for (const job of jobs.get(hit.image) ?? []) byItem.get(job.itemId)?.push({ ...hit, image: job.label });
    let similar = 0;
    for (const [itemId, hits] of byItem) {
      perItem[itemId].faces = hits;
      const best = new Map<string, number>();
      for (const h of hits) if (h.persona && h.similarity !== undefined) best.set(h.persona, Math.max(best.get(h.persona) ?? 0, h.similarity));
      for (const [id, similarity] of best) {
        const who = people.get(id);
        perItem[itemId].personas.push({ id, name: who?.name ?? id, matched: "twarz", source: "face", role: who?.role ?? null, category: who?.category ?? null, similarity });
        similar++;
      }
    }
    log(`twarze: ${found.length} wykrytych, ${similar} podobnych do osób z listy`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Voice step of the enrichment: cuts the audio of each video creative into windows and matches them
 * with the gallery of voices (data/voices/index.json, the closed list of public figures). Sets
 * `voices` (spans of speech; a span with a voice similar to a person carries the persona id and the
 * cosine) and adds a persona with source "voice" (cosine kept, never a vector): a trait of a group
 * of similar campaigns, to be reviewed by a person. One adapter call for the whole batch; when the
 * gallery, the venv or the model is missing the reason is logged ("głos mówcy pominięty: ...") and
 * nothing is set.
 * @param perItem enrichments by item id, changed in place
 */
async function enrichVoices(items: Item[], perItem: Record<string, ItemEnrichment>, opts: EnrichOptions, log: (message: string) => void): Promise<void> {
  const adapter = opts.voicesAdapter ?? embedSpeakerWindows;
  let python: string | undefined;
  let modelDir: string | undefined;
  if (!opts.voicesAdapter) {
    const st = await detectSpeaker();
    // the reason (no venv, model or ffmpeg) was already logged by the speaker-embedding step just before
    if (!st.available) return;
    python = st.python ?? undefined;
    modelDir = st.modelDir;
    if (!(await nonEmptyFile(path.join(speakerVadDir(), "hyperparams.yaml")))) return log(`głos mówcy pominięty: brak modelu detekcji mowy w ${speakerVadDir()} (scripts/py/setup-speaker.sh)`);
  }
  const index = opts.voiceIndex === undefined ? loadVoiceIndex() : opts.voiceIndex;
  if (!index) return log("głos mówcy pominięty: brak galerii głosów (data/voices/index.json)");
  const abs = (p: string) => (path.isAbsolute(p) ? p : path.join(opts.baseDir, p));
  const withVideo = items.filter((it) => it.videoPath && perItem[it.id]);
  if (!withVideo.length) return;
  const windows = await adapter([...new Set(withVideo.map((it) => abs(it.videoPath!)))], { python, modelDir });
  const people = loadPublicPeople("głosu", log);
  let similar = 0;
  for (const it of withVideo) {
    const w = windows[abs(it.videoPath!)];
    if (!w) {
      perItem[it.id].errors.push("speaker: nie odczytano ścieżki dźwiękowej albo jest krótsza niż jedno okno");
      continue;
    }
    const spans = matchVoiceWindows(w, index);
    perItem[it.id].voices = spans;
    const best = new Map<string, number>();
    for (const sp of spans) if (sp.persona && sp.similarity !== undefined) best.set(sp.persona, Math.max(best.get(sp.persona) ?? 0, sp.similarity));
    for (const [id, similarity] of best) {
      const who = people.get(id);
      perItem[it.id].personas.push({ id, name: who?.name ?? id, matched: "głos", source: "voice", role: who?.role ?? null, category: who?.category ?? null, similarity });
      similar++;
    }
  }
  log(`głos z galerii: ${withVideo.length} nagrań, ${similar} podobnych do osób z listy`);
}

export async function enrichItems(items: Item[], opts: EnrichOptions): Promise<EnrichedDataset> {
  const { sources } = opts;
  const skip = opts.skip ?? {};
  const log = opts.log ?? (() => {});
  const limit = pLimit(opts.concurrency ?? 4);
  const dnsLimit = pLimit(8);
  const rdapLimit = pLimit(2);
  const ctLimit = pLimit(1);
  const llmLimit = pLimit(1);
  const mediaLimit = pLimit(2);
  const progress = opts.onProgress ?? (() => {});
  const imageCache =
    opts.imageCache === false || sources.mode === "offline"
      ? null
      : (opts.imageCache ?? createCache({ namespace: "imagehash", defaultTtlMs: CACHE_TTL.imagehash }));
  const nerCache = opts.ner && opts.ner.cache !== false ? (opts.ner.cache ?? createCache({ namespace: "ner", defaultTtlMs: CACHE_TTL.ner })) : null;
  const cloakThreshold = opts.cloakingDomThreshold ?? 12;
  if (opts.archiveDir) mkdirSync(opts.archiveDir, { recursive: true });

  // Opt-in media adapters: detect once, skip quietly when unavailable.
  let ocrOn = false;
  let asrOn = false;
  let audioOn = false;
  if (opts.ocr) {
    const st = await detectOcr();
    ocrOn = st.available;
    log(ocrOn ? `OCR: tesseract ${st.version ?? ""} (pol)` : `OCR pominięty: ${st.reason ?? "tesseract niedostępny"}`);
  }
  if (opts.asr) {
    const st = await detectAsr();
    asrOn = st.available;
    log(asrOn ? `ASR: ${st.tool} (${st.model ?? "model domyślny"})${st.vadModel ? `, VAD ${st.vadModel}` : st.vadReason ? `, ${st.vadReason}` : ""}` : `ASR pominięty: ${st.reason ?? "brak narzędzia"}`);
  }
  let clipOn = false;
  const clipCache = opts.clip ? createCache({ namespace: "clip", defaultTtlMs: CACHE_TTL.clip }) : null;
  if (opts.clip) {
    const st = await detectClip();
    clipOn = st.available;
    log(clipOn ? `CLIP: ${st.model}` : `CLIP pominięty: ${st.reason ?? "model niedostępny"}`);
  }
  if (opts.audio) {
    const st = await detectFpcalc();
    audioOn = st.available;
    log(audioOn ? `odcisk audio: fpcalc ${st.version ?? ""}` : "odcisk audio pominięty: fpcalc niedostępny");
  }

  const pages: Record<string, PageInfo> = {};
  const pagePromises = new Map<string, Promise<PageInfo>>();
  const perItem: Record<string, ItemEnrichment> = {};

  /** One fetch of the cloaking check with a given User-Agent: final address, status, DOM simhash, and whether it hit an anti-bot challenge. */
  const cloakingVariant = async (url: string, userAgent: string): Promise<CloakingVariant> => {
    try {
      const r = await sources.fetchPage(url, { userAgent });
      const isHtml = !!r.body && /html|xml|^$/i.test(r.contentType ?? "");
      return {
        userAgent,
        finalUrl: r.finalUrl,
        status: r.status,
        domSimhash: isHtml ? domSimhash(r.body!).simhash : null,
        bodySha256: r.bodySha256,
        error: r.error,
        ...(isBotChallenge(r.status, r.body) ? { botChallenge: true } : {}),
      };
    } catch (e) {
      return { userAgent, finalUrl: null, status: null, domSimhash: null, bodySha256: null, error: errMsg(e) };
    }
  };

  /** Opt-in cloaking check of a landing page: crawler and mobile fetches compared by `cloakingVerdict`. */
  const checkCloaking = async (url: string): Promise<CloakingCheck> => {
    const [crawler, mobile] = await Promise.all([cloakingVariant(url, CRAWLER_UA), cloakingVariant(url, MOBILE_UA)]);
    return cloakingVerdict(crawler, mobile, cloakThreshold);
  };

  /** Outcome of the archive step per page key, and the registrable domains whose archived copy predates their registration. */
  const archiveStatus = new Map<string, NonNullable<ItemEnrichment["archive"]>>();
  const reRegistered = new Set<string>();

  /**
   * Archive step for a page that was not fetched (error, 4xx/5xx) or shows a block page: looks for a public
   * copy, after checking the era of the domain (RDAP `created`, else the oldest certificate) so that a copy
   * of an earlier owner is rejected. Returns null when the step is off or not needed; otherwise the outcome
   * for the step report, the copy to use (null when none) and the copy that was found but rejected.
   */
  const archiveStep = async (
    url: string,
    res: FetchPageResult,
    extract: PageExtract | null,
    firstSeen: string | null,
  ): Promise<{ status: NonNullable<ItemEnrichment["archive"]>; copy: ArchivedCopy | null; rejected: ArchivedCopy | null } | null> => {
    const a = opts.archive;
    if (!a) return null;
    const blockPage = !!extract && !!a.isBlockPage?.([extract.title, extract.description, extract.visibleText]);
    if (res.ok && !blockPage) return null;
    const skipped = (detail: string) => ({ status: { status: "skipped" as const, detail }, copy: null, rejected: null });
    if (a.skipReason) return skipped(a.skipReason);
    // an address the fetcher refused (local, not http) has no public copy to look for
    if (res.errorCode === "blocked" || res.errorCode === "invalid-url") return skipped(`adres nie do sprawdzenia w archiwum: ${res.error ?? res.errorCode}`);
    const domain = registrableDomain(url);
    const notes: string[] = [];
    let domainCreated: string | null = null;
    let oldestCert: string | null = null;
    if (domain && !skip.rdap) {
      try {
        domainCreated = ((await sources.rdap(domain)) ?? (await a.rdap?.(domain)))?.created ?? null;
      } catch (e) {
        notes.push(`epoka domeny: RDAP niedostępny (${errMsg(e)})`);
      }
    }
    if (domain && !domainCreated && !skip.ct) {
      try {
        const certs = (await sources.ct(domain))?.certs ?? [];
        oldestCert = certs.map((c) => c.notBefore).filter((t): t is string => !!t).sort()[0] ?? null;
      } catch (e) {
        notes.push(`epoka domeny: CT niedostępny (${errMsg(e)})`);
      }
    }
    if (!domainCreated && !oldestCert) notes.push("epoka domeny nie sprawdzona: brak daty rejestracji i certyfikatów");
    const found = await findArchivedCopy(url, { sources: a.sources, config: a.config, firstSeen, domainCreated, oldestCert });
    if (found.reRegistered && domain) reRegistered.add(domain);
    const copy = found.copy ? { ...found.copy, notes: [...(found.copy.notes ?? []), ...notes] } : null;
    const status: NonNullable<ItemEnrichment["archive"]>["status"] = copy
      ? "used"
      : found.rejected.length
        ? "rejected"
        : found.tried.every((t) => t.status === "none")
          ? "none"
          : "skipped";
    return { status: { status, detail: found.summary }, copy, rejected: found.rejected[0] ?? null };
  };

  /**
   * Page under its key (normalised address), fetched once per key. `fetchUrl` is the address actually
   * requested (default: the key); live mode passes the full input address, because the normalised key
   * drops `fbclid`/`utm_*` and many scam pages show the offer only to the full address. `firstSeen` is when the
   * material was first seen: the archive step wants the copy nearest to it.
   */
  const loadPage = (url: string, fetchUrl: string = url, firstSeen: string | null = null): Promise<PageInfo> => {
    const existing = pagePromises.get(url);
    if (existing) return existing;
    const p = (async (): Promise<PageInfo> => {
      const res = await sources.fetchPage(fetchUrl);
      const { body, ...fetchMeta } = res;
      let extract = null;
      let kit = null;
      let archiveFile: string | null = null;
      if (body && /html|xml|^$/i.test(res.contentType ?? "")) {
        try {
          extract = extractFromHtml(body, res.finalUrl);
          kit = extractPageKit(body, res.finalUrl);
        } catch (e) {
          fetchMeta.error = `extract failed: ${errMsg(e)}`;
        }
        if (opts.archiveDir && res.bodySha256) {
          const file = path.join(opts.archiveDir, `${res.bodySha256}.html`);
          try {
            writeFileSync(file, body, "utf8");
            archiveFile = path.relative(process.cwd(), file);
          } catch (e) {
            fetchMeta.error = `archive failed: ${errMsg(e)}`;
          }
        }
      }
      // requests recorded with the page (HAR): traces visible without the page code (platform tenant, and
      // the page's files when only the request list survived)
      const requests = sources.requestsFor?.(url) ?? (res.finalUrl !== url ? sources.requestsFor?.(res.finalUrl) : null) ?? null;
      if (requests?.length) kit = withRequestUrls(kit, requests, res.finalUrl || url);
      // a dead page (or a block page): a public copy stands in for it, marked with where it came from
      const step = await archiveStep(url, res, extract, firstSeen);
      let bodySource: PageInfo["bodySource"];
      let archive: PageInfo["archive"];
      if (step) {
        archiveStatus.set(url, step.status);
        const shown = step.copy ?? step.rejected;
        if (shown) {
          archive = { ...copyProvenance(shown), used: !!step.copy };
        }
        if (step.copy) {
          bodySource = step.copy.source;
          extract = null;
          kit = null;
          if (step.copy.html) {
            try {
              extract = extractFromHtml(step.copy.html, step.copy.url);
              kit = extractPageKit(step.copy.html, step.copy.url);
            } catch (e) {
              fetchMeta.error = `extract failed (archive copy): ${errMsg(e)}`;
            }
          }
          if (step.copy.requests?.length) kit = withRequestUrls(kit, step.copy.requests.map((r) => r.url), step.copy.url);
        }
      }
      let favicon: PageInfo["favicon"] = null;
      // the favicon of an archived page would be asked of the dead host: left out
      if (!skip.favicon && extract?.faviconUrl && !bodySource) {
        try {
          const data = await sources.fetchBinary(extract.faviconUrl);
          favicon = data
            ? { url: extract.faviconUrl, hashes: await hashFavicon(data), error: null }
            : { url: extract.faviconUrl, hashes: null, error: "favicon not available" };
        } catch (e) {
          favicon = { url: extract.faviconUrl, hashes: null, error: errMsg(e) };
        }
      }
      const cloaking = opts.cloaking ? await checkCloaking(url) : null;
      const info: PageInfo = { requestedUrl: url, fetch: fetchMeta, extract, favicon, kit, archiveFile, cloaking, ...(bodySource ? { bodySource } : {}), ...(archive ? { archive } : {}) };
      pages[url] = info;
      return info;
    })();
    pagePromises.set(url, p);
    return p;
  };

  /** Image hashes (+ the bytes when OCR needs them). */
  const loadImage = async (item: Item): Promise<{ info: ImageInfo | null; file: string | null; bytes: Buffer | null }> => {
    if (item.imagePath) {
      const file = path.isAbsolute(item.imagePath) ? item.imagePath : path.join(opts.baseDir, item.imagePath);
      const data = await readFile(file);
      return { info: { ...(await hashImage(data)), source: item.imagePath }, file, bytes: data };
    }
    if (item.imageUrl) {
      const url = item.imageUrl;
      if (ocrOn || clipOn) {
        const data = await sources.fetchBinary(url);
        return data ? { info: { ...(await hashImage(data)), source: url }, file: null, bytes: data } : { info: null, file: null, bytes: null };
      }
      const compute = async () => {
        const data = await sources.fetchBinary(url);
        return data ? hashImage(data) : null;
      };
      const hashes = imageCache ? await imageCache.wrap(`img:${url}`, compute) : await compute();
      return { info: hashes ? { ...hashes, source: url } : null, file: null, bytes: null };
    }
    return { info: null, file: null, bytes: null };
  };

  const runClip = async (bytes: Buffer): Promise<number[]> => {
    const key = embeddingKey(bytes);
    const compute = async () => compactEmbedding(await embedImage(bytes));
    return clipCache ? clipCache.wrap(key, compute) : compute();
  };

  const runClipVideo = async (file: string): Promise<number[] | null> => {
    const key = `video:${embeddingKey(await readFile(file))}`;
    const compute = async () => {
      const v = await mediaLimit(() => embedVideo(file));
      return v ? compactEmbedding(v) : null;
    };
    return clipCache ? clipCache.wrap(key, compute) : compute();
  };

  const runOcr = async (file: string | null, bytes: Buffer | null): Promise<string | null> => {
    if (file) return mediaLimit(() => ocrImage(file, { lines: true }));
    if (!bytes) return null;
    const dir = await mkdtemp(path.join(os.tmpdir(), "starter-ocr-"));
    try {
      const tmp = path.join(dir, "creative.img");
      await writeFile(tmp, bytes);
      return await mediaLimit(() => ocrImage(tmp, { lines: true }));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  const runNer = async (text: string): Promise<PersonaMatch[]> => {
    if (!opts.ner || text.trim().length < 20) return [];
    const { provider } = opts.ner;
    const compute = () => llmLimit(() => extractPersonsNer(text, provider));
    const key = `${provider.name}:${provider.model}:${sha256(text)}`;
    const persons = nerCache ? await nerCache.wrap(key, compute) : await compute();
    return persons.map((p) => ({ id: personaSlug(p.name), name: p.name, matched: p.name, source: "ner" as const, role: p.role }));
  };

  // 1. Items: image (+OCR), video (+ASR, audio fingerprint), text, landing page, personas, campaign params
  let done = 0;
  await Promise.all(
    items.map((item) =>
      limit(async () => {
        const errors: string[] = [];
        let image: ImageInfo | null = null;
        let ocrText: string | null = null;
        let imageEmbedding: number[] | null = null;
        let creativeBrand: BrandHit | null = null;
        let advertiserOcr: string | null = null;
        let extraOcrText: string | null = null;
        // the address bar is read from the top strip of every screenshot, before the OCR text is cut down to the post
        const observed: ObservedAddress[] = [];
        if (ocrOn && !skip.image && item.extraImagePaths?.length) {
          // further screenshots of the case (ad-library details, the page on a phone): text only
          const parts: string[] = [];
          for (const rel of item.extraImagePaths) {
            const file = path.isAbsolute(rel) ? rel : path.join(opts.baseDir, rel);
            const t = await runOcr(file, null);
            if (t) parts.push(t.replace(/\s+/g, " ").trim());
            observed.push(...(await mediaLimit(() => readAddressBar(file))));
          }
          extraOcrText = parts.length ? parts.join("\n") : null;
        }
        if (!skip.image) {
          try {
            const img = await loadImage(item);
            image = img.info;
            if (ocrOn && (img.file || img.bytes)) {
              observed.unshift(...(await mediaLimit(() => readAddressBar(img.file ?? item.imagePath ?? item.imageUrl ?? "creative", { bytes: img.bytes ?? undefined }))));
              // a feed screenshot also shows the neighbouring post: keep the sponsored one, read the page name
              const post = sponsoredPost(await runOcr(img.file, img.bytes));
              ocrText = post.text.replace(/\s+/g, " ").trim() || null;
              advertiserOcr = post.advertiser;
            }
            if (clipOn && img.bytes) {
              try {
                imageEmbedding = await runClip(img.bytes);
              } catch (e) {
                errors.push(`clip: ${errMsg(e)}`);
              }
            }
            if (imageEmbedding) {
              try {
                creativeBrand = matchBrand(imageEmbedding, await brandVectors());
              } catch (e) {
                errors.push(`marka (CLIP zero-shot): ${errMsg(e)}`);
              }
            }
          } catch (e) {
            errors.push(`image: ${errMsg(e)}`);
          }
        }
        let asrText: string | null = null;
        let audioFp: AudioFingerprint | null = null;
        let videoEmbedding: number[] | null = null;
        let videoSha256: string | null = null;
        if (item.videoPath) {
          try {
            const file = path.isAbsolute(item.videoPath) ? item.videoPath : path.join(opts.baseDir, item.videoPath);
            videoSha256 = createHash("sha256").update(await readFile(file)).digest("hex");
          } catch (e) {
            errors.push(`video: ${errMsg(e)}`);
          }
        }
        if (item.videoPath && (asrOn || audioOn || clipOn)) {
          const file = path.isAbsolute(item.videoPath) ? item.videoPath : path.join(opts.baseDir, item.videoPath);
          if (asrOn) asrText = await mediaLimit(() => transcribe(file));
          if (audioOn) audioFp = await mediaLimit(() => fingerprintAudio(file));
          if (clipOn) {
            try {
              videoEmbedding = await runClipVideo(file);
            } catch (e) {
              errors.push(`clip-video: ${errMsg(e)}`);
            }
          }
        }
        if (ocrOn && item.videoPath) {
          // a screen recording shows the address bar change from the ad to the landing page and back
          const file = path.isAbsolute(item.videoPath) ? item.videoPath : path.join(opts.baseDir, item.videoPath);
          observed.push(...(await mediaLimit(() => readAddressBarVideo(file))));
        }
        const combined = [item.text, ocrText, asrText].filter((t): t is string => !!t && t.trim().length > 0).join("\n");
        const text = combined ? extractFromText(combined) : null;
        const fromInput = normalizeUrl(item.landingUrl ?? "");
        const fromText = text?.urls[0] ? normalizeUrl(text.urls[0]) : null;
        const bar = observed.find((o) => o.confidence === "high" && !o.platform);
        const fromBar = bar ? normalizeUrl(bar.url) : null;
        const landing = fromInput ?? fromText ?? fromBar;
        const landingSource = fromInput ? "input" : fromText ? "ad_text" : fromBar ? "address_bar" : null;
        if (item.landingUrl && !normalizeUrl(item.landingUrl)) errors.push(`invalid landing URL: ${item.landingUrl}`);
        let pageKey: string | null = null;
        let page: PageInfo | null = null;
        if (landing && !skip.page) {
          // "#capture=<id>" marks one of several saved copies of the same address (cloaking, a funnel behind one URL)
          pageKey = landing.url + (/#capture=[\w.-]+$/.exec(item.landingUrl ?? "")?.[0] ?? "");
          try {
            // offline fixtures are stored under the normalised key; a live request goes to the full input address
            const full = landingSource === "input" && sources.mode === "live" ? item.landingUrl!.replace(/#.*$/, "") : pageKey;
            page = await loadPage(pageKey, full, item.firstSeen);
            if (page.fetch.error) errors.push(`page: ${page.fetch.error}`);
          } catch (e) {
            errors.push(`page: ${errMsg(e)}`);
            pageKey = null;
          }
        }

        // Personas: watchlist (exact on ad/page text, fuzzy on OCR/ASR), input column, optional NER
        const personas: PersonaMatch[] = [...personasFromIngest(item.persona)];
        if (opts.personas) {
          const pageText = [page?.extract?.title, page?.extract?.description, page?.extract?.visibleText].filter(Boolean).join("\n");
          personas.push(...matchPersonas([item.text ?? "", pageText].join("\n"), opts.personas));
          // not the further screenshots: a feed view also shows the posts around the ad, and their authors are not in it
          const machineText = [ocrText, asrText].filter(Boolean).join("\n");
          if (machineText) personas.push(...matchPersonas(machineText, opts.personas, { fuzzy: true }));
        }
        if (opts.ner) {
          try {
            personas.push(...(await runNer(combined)));
          } catch (e) {
            errors.push(`ner: ${errMsg(e)}`);
          }
        }

        const campaignParams = extractCampaignParams([
          item.landingUrl,
          ...(page?.fetch.redirectChain.map((h) => h.url) ?? []),
          page?.fetch.finalUrl,
          ...(text?.urls ?? []),
        ]);

        // a name or pseudonym from the list inside the advertiser's name: a possible fake profile of that person
        const advertiserName = item.advertiser ?? advertiserOcr;
        const impersonated = opts.personas && advertiserName ? matchPersonas(advertiserName, opts.personas)[0] : undefined;

        perItem[item.id] = {
          itemId: item.id,
          landing,
          pageKey,
          text,
          image,
          personas: dedupePersonas(personas),
          campaignParams,
          ocrText,
          ...(extraOcrText ? { extraOcrText } : {}),
          ...(observed.length ? { observedUrls: observed } : {}),
          landingSource,
          ...(advertiserOcr ? { advertiserOcr } : {}),
          ...(impersonated ? { advertiserImpersonates: { id: impersonated.id, name: impersonated.name } } : {}),
          asrText,
          audioFp,
          ...(imageEmbedding ? { imageEmbedding } : {}),
          ...(creativeBrand ? { creativeBrand } : {}),
          ...(videoEmbedding ? { videoEmbedding } : {}),
          ...(videoSha256 ? { videoSha256 } : {}),
          ...(pageKey && archiveStatus.has(pageKey) ? { archive: archiveStatus.get(pageKey) } : {}),
          errors,
        };
        progress("items", ++done, items.length);
      }),
    ),
  );

  // 1b. Speaker embeddings (SpeechBrain, one batch so the model loads once)
  if (opts.speaker) {
    const st = await detectSpeaker();
    if (!st.available) log(`głos mówcy pominięty: ${st.reason ?? "brak SpeechBrain"}`);
    else {
      const speakerCache = createCache({ namespace: "speaker", defaultTtlMs: CACHE_TTL.speaker });
      const fileOf = (it: Item) => (path.isAbsolute(it.videoPath!) ? it.videoPath! : path.join(opts.baseDir, it.videoPath!));
      const withVideo = items.filter((it) => it.videoPath && perItem[it.id]);
      const keyOf = new Map<string, string>();
      const todo: string[] = [];
      for (const it of withVideo) {
        const file = fileOf(it);
        try {
          const key = `ecapa:${createHash("sha256").update(await readFile(file)).digest("hex")}`;
          keyOf.set(it.id, key);
          const hit = await speakerCache.get<number[] | null>(key);
          if (hit) perItem[it.id].speakerEmbedding = hit;
          else if (!todo.includes(file)) todo.push(file);
        } catch (e) {
          perItem[it.id].errors.push(`speaker: ${errMsg(e)}`);
        }
      }
      if (todo.length) {
        log(`głos mówcy: SpeechBrain ECAPA, ${todo.length} nagrań${todo.length === withVideo.length ? "" : " (reszta z cache)"}`);
        const emb = await embedSpeakers(todo, { python: st.python!, modelDir: st.modelDir });
        for (const it of withVideo) {
          const v = emb[fileOf(it)];
          if (!v) continue;
          perItem[it.id].speakerEmbedding = v;
          const key = keyOf.get(it.id);
          if (key) await speakerCache.set(key, v);
        }
      }
    }
  }

  // 1b2. Voice gallery: persona of a voice similar to a public figure (windows of the same recordings)
  if (opts.speaker) await enrichVoices(items, perItem, opts, log);

  // 1c. Faces: boxes and personas from the closed list (one batch so the models load once)
  if (opts.faces) await enrichFaces(items, perItem, opts, log);

  // 1d. Meta Ad Library details for ad-library IDs (input column, OCR of the screenshots)
  if (opts.adLibrary) {
    const idsOf = (it: Item): string[] => {
      const enr = perItem[it.id];
      return [
        ...new Set([
          ...(AD_LIBRARY_ID_RE.test(it.extra.ad_library_id ?? "") ? [it.extra.ad_library_id] : []),
          ...(enr?.ocrText ? stripUiChrome(enr.ocrText).adLibraryIds : []),
          ...(enr?.extraOcrText ? stripUiChrome(enr.extraOcrText).adLibraryIds : []),
        ]),
      ];
    };
    const allIds = [...new Set(items.flatMap(idsOf))];
    if (sources.mode === "offline") log("biblioteka reklam pominięta: tryb offline");
    else if (!allIds.length) log("biblioteka reklam: brak identyfikatorów biblioteki w materiałach");
    else {
      const st = await detectAdLibrary();
      if (!st.available) log(`biblioteka reklam pominięta: ${st.reason ?? "brak MetaAdsCollector"}`);
      else {
        const libCache = createCache({ namespace: "adlibrary", defaultTtlMs: CACHE_TTL.adlibrary });
        const info: Record<string, AdLibraryInfo> = {};
        const todo: string[] = [];
        for (const id of allIds) {
          const hit = await libCache.get<AdLibraryInfo>(id);
          if (hit) info[id] = hit;
          else todo.push(id);
        }
        if (todo.length) {
          log(`biblioteka reklam: MetaAdsCollector, ${todo.length} identyfikatorów`);
          const fresh = await lookupAdLibrary(todo, { python: st.python! });
          for (const [id, rec] of Object.entries(fresh)) {
            // creative of the ad (text, picture, start time) from the library page; the DSA record stays when yt-dlp is missing
            const got = rec.error ? null : await fetchAdCreative(id);
            if (got) {
              rec.creative = got.creative;
              rec.creativeNote = got.error;
              if (got.error) log(`kreacja z biblioteki reklam pominięta (${id}): ${got.error}`);
            }
            info[id] = rec;
            if (!rec.error) await libCache.set(id, rec);
          }
        }
        for (const it of items) {
          const recs = idsOf(it).map((id) => info[id]).filter((r): r is AdLibraryInfo => !!r);
          if (!recs.length || !perItem[it.id]) continue;
          perItem[it.id].adLibrary = recs;
          for (const r of recs) if (r.error) perItem[it.id].errors.push(`ad-library ${r.id}: ${r.error}`);
        }
      }
    }
  }

  // 2. Hosts from landing URLs, redirect chains, final URLs and URLs in ad copy (+ CNAME chains)
  const hostSet = new Set<string>();
  const addUrlHost = (u: string | null | undefined) => {
    const n = u ? normalizeUrl(u) : null;
    if (n) hostSet.add(n.host);
  };
  for (const enr of Object.values(perItem)) {
    addUrlHost(enr.landing?.url);
    for (const u of enr.text?.urls ?? []) addUrlHost(u);
    for (const o of enr.observedUrls ?? []) if (!o.platform) addUrlHost(o.url);
  }
  for (const page of Object.values(pages)) {
    for (const hop of page.fetch.redirectChain) addUrlHost(hop.url);
    addUrlHost(page.fetch.finalUrl);
  }
  const hosts: Record<string, HostInfo> = {};
  done = 0;
  await Promise.all(
    [...hostSet].map((host) =>
      dnsLimit(async () => {
        const domain = registrableDomain(host);
        if (isIpAddress(host)) {
          hosts[host] = { host, registrableDomain: null, dns: null, ips: [canonicalIp(host)!], cnameChain: [] };
        } else if (skip.dns) {
          hosts[host] = { host, registrableDomain: domain, dns: null, ips: [], cnameChain: [] };
        } else {
          const rec = await sources.dns(host, ["A", "AAAA", "CNAME"]);
          const ips = [...new Set([...rec.a, ...rec.aaaa].map((ip) => canonicalIp(ip)).filter((x): x is string => !!x))].sort();
          // Follow the CNAME chain (max 4 hops). Called without the limiter to avoid nested waits.
          const cnameChain: string[] = [];
          let next = rec.cname[0];
          while (next && cnameChain.length < 4 && !cnameChain.includes(next) && next !== host) {
            cnameChain.push(next);
            const hop = await sources.dns(next, ["CNAME"]);
            next = hop.cname[0];
          }
          hosts[host] = { host, registrableDomain: domain, dns: rec, ips, cnameChain };
        }
        progress("dns", ++done, hostSet.size);
      }),
    ),
  );

  // 3. Registrable domains: NS/MX/TXT, RDAP, CT
  const domainSet = new Set(Object.values(hosts).map((h) => h.registrableDomain).filter((d): d is string => !!d));
  const domains: Record<string, DomainInfo> = {};
  done = 0;
  await Promise.all(
    [...domainSet].map(async (domain) => {
      const info: DomainInfo = { domain, ns: [], mx: [], txt: [], rdap: null, ct: null, ...(reRegistered.has(domain) ? { reRegistered: true } : {}) };
      const tasks: Array<Promise<void>> = [];
      if (!skip.dns) {
        tasks.push(
          dnsLimit(async () => {
            const rec = await sources.dns(domain, ["NS", "MX", "TXT"]);
            info.ns = rec.ns;
            info.mx = rec.mx;
            info.txt = rec.txt;
          }),
        );
      }
      if (!skip.rdap) {
        tasks.push(
          rdapLimit(async () => {
            try {
              info.rdap = await sources.rdap(domain);
            } catch {
              info.rdap = null;
            }
          }),
        );
      }
      if (!skip.ct) {
        tasks.push(
          ctLimit(async () => {
            try {
              info.ct = await sources.ct(domain);
            } catch {
              info.ct = null;
            }
          }),
        );
      }
      await Promise.all(tasks);
      domains[domain] = info;
      progress("domains", ++done, domainSet.size);
    }),
  );

  // 4. IPs -> ASN
  const ipSet = new Set(Object.values(hosts).flatMap((h) => h.ips));
  const ips: EnrichedDataset["ips"] = {};
  done = 0;
  await Promise.all(
    [...ipSet].map((ip) =>
      dnsLimit(async () => {
        try {
          // Never send private/reserved addresses to a third-party lookup.
          ips[ip] = skip.asn || (sources.mode === "live" && !isPublicIp(ip)) ? null : await sources.asn(ip);
        } catch {
          ips[ip] = null;
        }
        progress("asn", ++done, ipSet.size);
      }),
    ),
  );

  const sortRecord = <T>(r: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: sources.mode,
    baseDir: opts.baseDir,
    items,
    perItem: Object.fromEntries(items.map((it) => [it.id, perItem[it.id]])),
    pages: sortRecord(pages),
    hosts: sortRecord(hosts),
    domains: sortRecord(domains),
    ips: sortRecord(ips),
  };
}
