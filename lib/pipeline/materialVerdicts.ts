/**
 * Two verdicts of the material analysis that the campaign rules do not give.
 *
 * Duplicate: the same ad collected again. One of: the same picture (dHash within a few bits and
 * confirmed pixel by pixel, so a re-compressed copy matches and a variant with a sticker, a crop or
 * another headline does not), the same video (the same file by SHA-256, or CLIP frames nearly
 * identical together with the same sound over the same length, so a cut with another intro is a
 * variant), the same Meta ad (from fbclid) or ad-library ID, the same page address without tracking
 * parameters together with an identical DOM simhash, or the same page body (SHA-256). Identifiers
 * that contradict each other (two different page addresses, two different ad IDs, two verifiably
 * different pictures or videos on the same page) rule a pair out. A whole case counts too: a later
 * case whose every material file is in an earlier case of the batch (same SHA-256) is its copy.
 *
 * Insufficient: nothing to compare the material by. No address or domain, no identifier (contact,
 * wallet, ad ID, page-platform account) and fewer than MIN_CONTENT_WORDS words once the platform's
 * interface labels are removed. A link that passes the campaign or family threshold wins: then the
 * verdict comes from the link.
 */
import { readFileSync } from "node:fs";
import { fingerprintSimilarity } from "../media/audioFp";
import { cosine } from "../media/imageEmbed";
import { differingPixelShare, grayThumbnail, hammingDistance } from "../media/imageHash";
import { normalizeUrl } from "../osint/urls";
import type { EnrichedDataset } from "./types";

export const DUPLICATE_RULES = {
  /** dHash (64 bits) distance of a candidate pair; re-compression moves a few bits. */
  dhashMax: 4,
  /** Pixel check on 64x64 grayscale thumbnails: a pixel "differs" above this gray-level change ... */
  pixelLevel: 40,
  /** ... and a copy has at most this share of differing pixels (variants on the sample: >= 0.7%). */
  pixelShareMax: 0.0025,
  thumbnailSize: 64,
  /**
   * The same video without the same file: mean CLIP vector of the frames at least this close (as
   * campaignRules.sameCreative) ...
   */
  videoClipMinCosine: 0.97,
  /**
   * ... and the same sound: Chromaprint similarity at least this high over at most `audioMaxOffset`
   * values of shift (fpcalc start jitter), with durations within `audioDurationTolerance` seconds.
   * Stricter than the similar_audio edge (0.85): a new 3-second intro in a 30-second clip still scores
   * about 0.95, and a copy is a copy only when the whole recording matches.
   */
  audioMinSimilarity: 0.98,
  audioMaxOffset: 2,
  audioDurationTolerance: 1,
} as const;

/** Fewer content words than this (after removing interface labels) cannot be compared by text. */
export const MIN_CONTENT_WORDS = 5;

/**
 * Labels of a lead form of the platform (Lead Ads, "Instant Form"): the ad collects the data itself and
 * has no landing page. "Wyślij" / "Send" alone counts too (the button of the form), but not followed by
 * "wiadomość" / "message", which is the Messenger button of an ordinary ad.
 */
export const LEAD_AD_PATTERNS: readonly RegExp[] = [
  /(?<!\p{L})formularz/iu,
  /\binstant form\b/i,
  /\blead (?:form|ad)s?\b/i,
  /(?<!\p{L})wyślij(?!\p{L})(?!\s+wiadomo)/iu,
  /\bsend\b(?!\s+message)/i,
];

/** Whether the ad text or OCR shows a lead form of the platform (see LEAD_AD_PATTERNS); null text is false. */
export function isLeadAd(text: string | null | undefined): boolean {
  return !!text && LEAD_AD_PATTERNS.some((re) => re.test(text));
}

export interface DuplicateTraits {
  id: string;
  dhash: string | null;
  /** Screenshot of an ad-library view: mostly interface, two different ads can hash alike. */
  libraryView: boolean;
  /** Page address without tracking parameters (normalised). */
  pageUrl: string | null;
  /** Host and path of the page address (query left out). */
  pagePath: string | null;
  domSimhash: string | null;
  metaAdIds: string[];
  adLibraryIds: string[];
  /** Picture file for the pixel check (null = not readable: only an identical dHash counts). */
  imageFile: string | null;
  /** SHA-256 of the captured page body (decoded HTML), null without a page. */
  pageSha256: string | null;
  videoSha256: string | null;
  /** Mean CLIP vector of the video frames (opt-in CLIP), null without one. */
  videoEmbedding: number[] | null;
  /** Raw Chromaprint values of the video sound (opt-in fpcalc), null without one. */
  audioFingerprint: number[] | null;
  /** Length of the fingerprinted sound in seconds. */
  audioDuration: number | null;
}

/** Traits of the media of a record that do not live in the graph node: page body, video file, frames and sound. */
export type DuplicateMedia = Partial<Pick<DuplicateTraits, "pageSha256" | "videoSha256" | "videoEmbedding" | "audioFingerprint" | "audioDuration">>;

export interface DuplicateOf {
  id: string;
  /** Polish sentence, e.g. "identyczny obraz i ten sam adres strony". */
  reason: string;
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : typeof v === "string" && v ? [v] : []);

/**
 * Traits of an ad from its graph node data, its page address, its picture file and the media traits
 * of its enrichment (see duplicateMedia; missing ones are null).
 */
export function duplicateTraits(id: string, data: Record<string, unknown>, pageAddress: string | null, imageFile: string | null, media: DuplicateMedia = {}): DuplicateTraits {
  const nu = pageAddress ? normalizeUrl(pageAddress) : null;
  return {
    id,
    dhash: typeof data.dhash === "string" ? data.dhash : null,
    libraryView: data.uiView === "ad_library",
    pageUrl: nu?.url ?? null,
    pagePath: nu ? `${nu.host}${nu.path}` : null,
    domSimhash: typeof data.domSimhash === "string" ? data.domSimhash : null,
    metaAdIds: strs(data.metaAdId),
    adLibraryIds: strs(data.adLibraryIds),
    imageFile,
    pageSha256: media.pageSha256 ?? null,
    videoSha256: media.videoSha256 ?? null,
    videoEmbedding: media.videoEmbedding?.length ? media.videoEmbedding : null,
    audioFingerprint: media.audioFingerprint?.length ? media.audioFingerprint : null,
    audioDuration: media.audioDuration ?? null,
  };
}

/**
 * Media traits of one record of an enriched dataset: the SHA-256 of its page body (the page it was
 * captured with), the SHA-256 of its video file, the mean CLIP vector of the video frames and the
 * audio fingerprint. Fields the enrichment did not produce stay out.
 */
export function duplicateMedia(ds: Pick<EnrichedDataset, "perItem" | "pages">, id: string): DuplicateMedia {
  const enr = ds.perItem[id];
  if (!enr) return {};
  const page = enr.pageKey ? ds.pages[enr.pageKey] : undefined;
  return {
    pageSha256: page?.fetch.bodySha256 ?? null,
    videoSha256: enr.videoSha256 ?? null,
    videoEmbedding: enr.videoEmbedding ?? null,
    audioFingerprint: enr.audioFp?.fingerprint ?? null,
    audioDuration: enr.audioFp?.duration ?? null,
  };
}

/** A picture without structure (blank, one colour) hashes to (nearly) all zeros or ones. */
function trivialHash(h: string): boolean {
  const ones = [...h].reduce((s, c) => s + (parseInt(c, 16).toString(2).match(/1/g)?.length ?? 0), 0);
  return ones <= 2 || ones >= h.length * 4 - 2;
}

const disjoint = (a: string[], b: string[]) => a.length > 0 && b.length > 0 && !a.some((x) => b.includes(x));

function joinPl(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} i ${parts[parts.length - 1]}`;
}

export class DuplicateFinder {
  private thumbs = new Map<string, Promise<number[] | null>>();

  constructor(private readonly rules = DUPLICATE_RULES) {}

  private thumb(file: string): Promise<number[] | null> {
    let p = this.thumbs.get(file);
    if (!p) {
      p = (async () => {
        try {
          return await grayThumbnail(readFileSync(file), this.rules.thumbnailSize);
        } catch {
          return null;
        }
      })();
      this.thumbs.set(file, p);
    }
    return p;
  }

  /**
   * Same picture: dHash candidate, then the pixel check (or an identical dHash when a file is missing).
   * `known: true` with `same: false` means the pictures are verifiably different.
   */
  async imageRelation(a: DuplicateTraits, b: DuplicateTraits): Promise<{ same: true; distance: number } | { same: false; known: boolean }> {
    if (!a.dhash || !b.dhash || a.libraryView || b.libraryView || a.dhash.length !== b.dhash.length) return { same: false, known: false };
    if (trivialHash(a.dhash) || trivialHash(b.dhash)) return { same: false, known: false };
    const distance = hammingDistance(a.dhash, b.dhash);
    if (distance > this.rules.dhashMax) return { same: false, known: true };
    const [ta, tb] = await Promise.all([a.imageFile ? this.thumb(a.imageFile) : null, b.imageFile ? this.thumb(b.imageFile) : null]);
    if (!ta || !tb) return distance === 0 ? { same: true, distance } : { same: false, known: false };
    return differingPixelShare(ta, tb, this.rules.pixelLevel) <= this.rules.pixelShareMax ? { same: true, distance } : { same: false, known: true };
  }

  /**
   * Same video: the same file, or near frames (CLIP) with the same sound over the same length. The
   * sound is compared almost without shift, so a recording with another intro (shifted, longer, or
   * with other sound at the start) stays a variant. `known: true` with `same: false` means both videos
   * are there and verifiably different (two files, nothing proving the same recording).
   */
  videoRelation(a: DuplicateTraits, b: DuplicateTraits): { same: true; reason: string } | { same: false; known: boolean } {
    if (a.videoSha256 && a.videoSha256 === b.videoSha256) return { same: true, reason: "ten sam plik wideo (SHA-256)" };
    const r = this.rules;
    if (a.videoEmbedding && b.videoEmbedding && a.audioFingerprint && b.audioFingerprint && a.audioDuration !== null && b.audioDuration !== null) {
      const frames = cosine(a.videoEmbedding, b.videoEmbedding);
      const sameLength = Math.abs(a.audioDuration - b.audioDuration) <= r.audioDurationTolerance;
      if (frames >= r.videoClipMinCosine && sameLength && fingerprintSimilarity(a.audioFingerprint, b.audioFingerprint, { maxOffset: r.audioMaxOffset }) >= r.audioMinSimilarity) {
        return { same: true, reason: `to samo wideo (klatki CLIP ${frames.toFixed(3).replace(".", ",")}, ten sam odcisk audio)` };
      }
    }
    return { same: false, known: !!a.videoSha256 && !!b.videoSha256 };
  }

  /** Cheap synchronous filter: could `a` and `b` be copies at all (shared ad ID, same page or page body, same or near video, near dHash)? */
  candidate(a: DuplicateTraits, b: DuplicateTraits): boolean {
    if (a.metaAdIds.some((x) => b.metaAdIds.includes(x)) || a.adLibraryIds.some((x) => b.adLibraryIds.includes(x))) return true;
    if (a.pageUrl && a.pageUrl === b.pageUrl && a.domSimhash && a.domSimhash === b.domSimhash) return true;
    if (a.pageSha256 && a.pageSha256 === b.pageSha256) return true;
    if (a.videoSha256 && a.videoSha256 === b.videoSha256) return true;
    if (a.videoEmbedding && b.videoEmbedding && cosine(a.videoEmbedding, b.videoEmbedding) >= this.rules.videoClipMinCosine) return true;
    return !!a.dhash && !!b.dhash && a.dhash.length === b.dhash.length && hammingDistance(a.dhash, b.dhash) <= this.rules.dhashMax;
  }

  /** Why `a` is a copy of `b`, or null. */
  async compare(a: DuplicateTraits, b: DuplicateTraits): Promise<{ reasons: string[]; distance: number } | null> {
    const adIdsConflict = disjoint(a.metaAdIds, b.metaAdIds) || disjoint(a.adLibraryIds, b.adLibraryIds);
    const pathConflict = !!a.pagePath && !!b.pagePath && a.pagePath !== b.pagePath;
    const img = await this.imageRelation(a, b);
    const reasons: string[] = [];
    let distance = 99;
    if (img.same && !adIdsConflict && !pathConflict) {
      distance = img.distance;
      reasons.push(img.distance === 0 ? "identyczny obraz" : `identyczny obraz (dHash różni się o ${img.distance} b., np. po ponownej kompresji)`);
    }
    const video = this.videoRelation(a, b);
    if (video.same && !adIdsConflict && !pathConflict) reasons.push(video.reason);
    if (a.metaAdIds.some((x) => b.metaAdIds.includes(x))) reasons.push("ta sama reklama w Mecie (identyfikator z fbclid)");
    if (a.adLibraryIds.some((x) => b.adLibraryIds.includes(x))) reasons.push("ten sam identyfikator w bibliotece reklam");
    const samePage = !!a.pageUrl && a.pageUrl === b.pageUrl;
    // two different creatives on one page are two ads of a campaign, not one ad collected twice
    const creativesDiffer = (!img.same && img.known) || (!video.same && video.known);
    if (samePage && !adIdsConflict && !creativesDiffer && a.domSimhash && a.domSimhash === b.domSimhash) reasons.push("ten sam adres strony z identyczną strukturą (simhash DOM)");
    // the same body under two different addresses is a mirror of the lander (a campaign trait), not a re-collection
    if (a.pageSha256 && a.pageSha256 === b.pageSha256 && !adIdsConflict && !creativesDiffer && !pathConflict) reasons.push("identyczna treść strony (SHA-256)");
    if (!reasons.length) return null;
    if (samePage && !reasons.some((r) => r.startsWith("ten sam adres strony"))) reasons.push("ten sam adres strony");
    return { reasons, distance };
  }

  /**
   * Originals of the new records: compared with the existing run and with the earlier records of
   * the same batch. A copy of a copy points at the first original. Existing records win ties.
   */
  async find(newOnes: DuplicateTraits[], existing: DuplicateTraits[]): Promise<Map<string, DuplicateOf>> {
    const out = new Map<string, DuplicateOf>();
    const seen: DuplicateTraits[] = [];
    for (const a of newOnes) {
      let best: { id: string; reasons: string[]; distance: number; existing: boolean } | null = null;
      for (const [pool, isExisting] of [[existing, true], [seen, false]] as const) {
        for (const b of pool) {
          if (b.id === a.id || !this.candidate(a, b)) continue;
          const m = await this.compare(a, b);
          if (!m) continue;
          const better =
            !best ||
            m.reasons.length > best.reasons.length ||
            (m.reasons.length === best.reasons.length && ((isExisting && !best.existing) || (isExisting === best.existing && (m.distance < best.distance || (m.distance === best.distance && b.id < best.id)))));
          if (better) best = { id: b.id, reasons: m.reasons, distance: m.distance, existing: isExisting };
        }
      }
      if (best) {
        const root = out.get(best.id)?.id ?? best.id;
        out.set(a.id, { id: root, reason: joinPl(best.reasons) });
      }
      seen.push(a);
    }
    return out;
  }
}

export interface Sufficiency {
  /** Any page address or domain: input link, address bar, URL in the text, captured page. */
  hasAddress: boolean;
  /** Contact, wallet, ad ID or page-platform account. */
  hasIdentifier: boolean;
  contentWords: number;
  hasImage: boolean;
  hasVideo: boolean;
  /** Landing page actually captured (HAR or saved page), not just an address of it. */
  hasPage: boolean;
  /**
   * A HAR (the request log of the visit) came with the case. Only for cases read from a folder:
   * undefined for a bare link, a text or a dataset row, where nobody was asked for a file.
   */
  hasHar?: boolean;
  /** A link passed the campaign or family threshold (campaign with other members, or a group of similar campaigns). */
  linked: boolean;
  /** The ad is a lead form of the platform (isLeadAd): it has no landing page to capture. */
  leadAd?: boolean;
  /** The archive step ran for the dead landing page and found no usable copy (none, or only rejected ones). */
  archiveNone?: boolean;
}

/**
 * Not enough to compare the material with anything: no linked campaign, no identifier, under
 * MIN_CONTENT_WORDS words, and no page to read: either no address, or an address whose page is
 * dead and has no copy in the archives (`archiveNone`; an address that merely was not fetched
 * still counts as an address, so a run without the archive step is unchanged).
 */
export function isInsufficient(s: Sufficiency): boolean {
  const noPage = !s.hasAddress || (!!s.archiveNone && !s.hasPage);
  return !s.linked && noPage && !s.hasIdentifier && s.contentWords < MIN_CONTENT_WORDS;
}

/** Material files of one case with the SHA-256 of their bytes (read by the caller). */
export interface CaseFiles {
  caseId: string;
  files: Array<{ name: string; sha256: string }>;
}

/**
 * Cases that bring nothing new: every material file of the case (HAR, HTML, screenshot, video) is
 * in an earlier case of the list with the same SHA-256, even when that case has more files. Cases in
 * submission order; only an earlier case can be the original, so two cases never point at each
 * other. Among several originals the one with the most files wins, then the earliest. Returns case
 * id -> original case and the number of shared files; cases without files are left out.
 */
export function caseFileDuplicates(cases: CaseFiles[]): Map<string, { caseId: string; files: number }> {
  const out = new Map<string, { caseId: string; files: number }>();
  const sets = cases.map((c) => new Set(c.files.map((f) => f.sha256)));
  for (let i = 0; i < cases.length; i++) {
    if (!sets[i].size) continue;
    let best = -1;
    for (let j = 0; j < i; j++) {
      if (![...sets[i]].every((h) => sets[j].has(h))) continue;
      if (best < 0 || sets[j].size > sets[best].size) best = j;
    }
    if (best >= 0) out.set(cases[i].caseId, { caseId: out.get(cases[best].caseId)?.caseId ?? cases[best].caseId, files: sets[i].size });
  }
  return out;
}

/**
 * What to add to the material so that it can be compared (Polish, most useful first). A lead-form ad
 * without an address has no landing page to link or record, so it is asked for the ad-library ID (it
 * names the ad and its advertiser) or the advertiser's page, and a screenshot of the form. The HAR is
 * asked for when no page was captured, and also when the page came without one (`hasHar` false): a
 * saved page does not show the servers, scripts and trackers the visit contacted, and those often
 * are the only link to a campaign. Not asked when it is unknown whether a HAR came (`hasHar` undefined).
 */
export function missingData(s: Sufficiency): string[] {
  const out: string[] = [];
  const leadForm = !!s.leadAd && !s.hasAddress;
  if (leadForm) out.push("identyfikator biblioteki reklam (ID z Biblioteki Reklam) albo link do strony reklamodawcy", "zrzut formularza reklamy");
  else if (!s.hasAddress) out.push("link do reklamy albo strony docelowej", "zrzut z widocznym paskiem adresu");
  if (s.archiveNone && !s.hasPage) out.push("zapisana strona (plik HTML albo HAR): adres nie odpowiada na żywo i nie ma kopii w archiwach");
  if ((!s.hasPage || s.hasHar === false) && !leadForm) out.push("plik HAR z wizyty na stronie");
  if (!s.hasImage && !s.hasVideo) out.push("zrzut ekranu reklamy");
  if (s.contentWords < MIN_CONTENT_WORDS) out.push("pełna treść reklamy (tekst posta albo czytelny zrzut)");
  return out;
}

/**
 * Copies inside one dataset (batch run): records in order of first appearance (date, then id), each
 * compared with the earlier ones. Returns record id -> original.
 */
export async function datasetDuplicates(traits: Array<DuplicateTraits & { firstSeen?: string | null }>): Promise<Map<string, DuplicateOf>> {
  const ordered = [...traits].sort((a, b) => (a.firstSeen ?? "\uffff").localeCompare(b.firstSeen ?? "\uffff") || a.id.localeCompare(b.id));
  return new DuplicateFinder().find(ordered, []);
}
