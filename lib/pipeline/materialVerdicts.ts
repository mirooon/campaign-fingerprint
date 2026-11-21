/**
 * Two verdicts of the material analysis that the campaign rules do not give.
 *
 * Duplicate: the same ad collected again. One of: the same picture (dHash within a few bits and
 * confirmed pixel by pixel, so a re-compressed copy matches and a variant with a sticker, a crop or
 * another headline does not), the same Meta ad (from fbclid) or ad-library ID, or the same page
 * address without tracking parameters together with an identical DOM simhash. Identifiers that
 * contradict each other (two different page addresses, two different ad IDs, two verifiably
 * different pictures on the same page) rule a pair out.
 *
 * Insufficient: nothing to compare the material by. No address or domain, no identifier (contact,
 * wallet, ad ID, page-platform account) and fewer than MIN_CONTENT_WORDS words once the platform's
 * interface labels are removed. A link that passes the campaign or family threshold wins: then the
 * verdict comes from the link.
 */
import { readFileSync } from "node:fs";
import { differingPixelShare, grayThumbnail, hammingDistance } from "../media/imageHash";
import { normalizeUrl } from "../osint/urls";

export const DUPLICATE_RULES = {
  /** dHash (64 bits) distance of a candidate pair; re-compression moves a few bits. */
  dhashMax: 4,
  /** Pixel check on 64x64 grayscale thumbnails: a pixel "differs" above this gray-level change ... */
  pixelLevel: 40,
  /** ... and a copy has at most this share of differing pixels (variants on the sample: >= 0.7%). */
  pixelShareMax: 0.0025,
  thumbnailSize: 64,
} as const;

/** Fewer content words than this (after removing interface labels) cannot be compared by text. */
export const MIN_CONTENT_WORDS = 5;

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
}

export interface DuplicateOf {
  id: string;
  /** Polish sentence, e.g. "identyczny obraz i ten sam adres strony". */
  reason: string;
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : typeof v === "string" && v ? [v] : []);

/** Traits of an ad from its graph node data and its page address. */
export function duplicateTraits(id: string, data: Record<string, unknown>, pageAddress: string | null, imageFile: string | null): DuplicateTraits {
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

  /** Cheap synchronous filter: could `a` and `b` be copies at all (shared ad ID, same page, near dHash)? */
  candidate(a: DuplicateTraits, b: DuplicateTraits): boolean {
    if (a.metaAdIds.some((x) => b.metaAdIds.includes(x)) || a.adLibraryIds.some((x) => b.adLibraryIds.includes(x))) return true;
    if (a.pageUrl && a.pageUrl === b.pageUrl && a.domSimhash && a.domSimhash === b.domSimhash) return true;
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
    if (a.metaAdIds.some((x) => b.metaAdIds.includes(x))) reasons.push("ta sama reklama w Mecie (identyfikator z fbclid)");
    if (a.adLibraryIds.some((x) => b.adLibraryIds.includes(x))) reasons.push("ten sam identyfikator w bibliotece reklam");
    const samePage = !!a.pageUrl && a.pageUrl === b.pageUrl;
    // two different creatives on one page are two ads of a campaign, not one ad collected twice
    const picturesDiffer = !img.same && img.known;
    if (samePage && !adIdsConflict && !picturesDiffer && a.domSimhash && a.domSimhash === b.domSimhash) reasons.push("ten sam adres strony z identyczną strukturą (simhash DOM)");
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
  /** Captured landing page (HAR or saved page). */
  hasPage: boolean;
  /** A link passed the campaign or family threshold (campaign with other members, or a group of similar campaigns). */
  linked: boolean;
}

export function isInsufficient(s: Sufficiency): boolean {
  return !s.linked && !s.hasAddress && !s.hasIdentifier && s.contentWords < MIN_CONTENT_WORDS;
}

/** What to add to the material so that it can be compared (Polish, most useful first). */
export function missingData(s: Sufficiency): string[] {
  const out: string[] = [];
  if (!s.hasAddress) out.push("link do reklamy albo strony docelowej", "zrzut z widocznym paskiem adresu");
  if (!s.hasPage) out.push("plik HAR z wizyty na stronie");
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
