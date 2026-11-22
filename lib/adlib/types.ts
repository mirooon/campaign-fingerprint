/**
 * Common interface of public ad libraries (DSA ad repositories): Meta Ad Library, Google Ads
 * Transparency Center, TikTok Commercial Content Library, X. Every source returns `AdRecord`s, which
 * `toItem.ts` turns into material for the analysis (a case folder for `analyze-material --cases`).
 */
export type AdPlatform = "meta" | "google" | "tiktok" | "x";

export interface AdRecord {
  platform: AdPlatform;
  adId: string;
  libraryUrl: string;
  fetchedAt: string;
  advertiser?: { name: string; id?: string; legalName?: string; location?: string; verified?: boolean | null };
  payers?: string[]; // płatnik: Meta z danych DSA, Google z `ad_funded_by` (gdy inny niż reklamodawca)
  firstSeen?: string;
  lastSeen?: string;
  regions?: string[];
  creatives: Array<{ kind: "image" | "video" | "text"; url?: string; text?: string; localPath?: string }>;
  landingUrl?: string;
  raw?: unknown;
}

export interface AdSearchQuery {
  keyword?: string;
  advertiser?: string;
  from?: string;
  to?: string;
  country?: string;
  limit?: number;
}

export interface AdLibrarySource {
  platform: AdPlatform;
  /** Whether the source can be used now; without access `reason` says why and `howToGetAccess` how to get it. */
  available(): Promise<{ ok: boolean; reason?: string; howToGetAccess?: string }>;
  search(q: AdSearchQuery): Promise<AdRecord[]>;
  getAd(adId: string): Promise<AdRecord | null>;
}

export const AD_PLATFORMS: readonly AdPlatform[] = ["meta", "google", "tiktok", "x"];

/** Name of the file with the library record inside a case folder (`adRecordToCaseDir`, read by `caseImport.ts`). */
export const AD_RECORD_FILE = "adlib.json";
