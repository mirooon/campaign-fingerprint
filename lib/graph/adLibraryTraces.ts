/**
 * Traces of a public ad-library record (`lib/adlib`) read from the columns that its case folder
 * leaves in `Item.extra`. Pure functions: keys of the graph nodes and the parsed fields, so that
 * `link.ts` only builds nodes. Every key carries the platform, because the identifiers of different
 * libraries are different namespaces (the same string may name two unrelated ads or accounts).
 */

/** What an ad-library record says about an item (empty fields are `null` / empty lists). */
export interface AdRecordTraces {
  platform: string;
  adId: string | null;
  libraryUrl: string | null;
  advertiserId: string | null;
  legalName: string | null;
  location: string | null;
  /** `null` when the library does not state the verification status. */
  verified: boolean | null;
  payers: string[];
  regions: string[];
  /** First and last delivery of the ad according to the library (ISO), or null. */
  firstShown: string | null;
  lastShown: string | null;
}

/** Values of a list column written with " | " between them. */
const list = (v: string | undefined): string[] => (v ? v.split(" | ").map((s) => s.trim()).filter(Boolean) : []);

/** Reads the library columns of an item; `null` when the item does not come from a library record. */
export function readAdRecordTraces(extra: Record<string, string>): AdRecordTraces | null {
  const platform = extra.ad_platform?.trim();
  if (!platform) return null;
  return {
    platform,
    adId: extra.ad_id?.trim() || null,
    libraryUrl: extra.ad_library_url?.trim() || null,
    advertiserId: extra.advertiser_id?.trim() || null,
    legalName: extra.advertiser_legal_name?.trim() || null,
    location: extra.advertiser_location?.trim() || null,
    verified: extra.advertiser_verified === "true" ? true : extra.advertiser_verified === "false" ? false : null,
    payers: list(extra.ad_payers),
    regions: list(extra.ad_regions),
    firstShown: extra.ad_first_shown?.trim() || null,
    lastShown: extra.ad_last_shown?.trim() || null,
  };
}

/** Key of a library ad ID in the `campaign_param` namespace (`ad_library_id=google:CR123`). */
export function adLibraryIdKey(platform: string, adId: string): string {
  return `ad_library_id=${platform}:${adId}`;
}

/** Key of an advertiser node by the library's stable account ID; it survives a change of the display name. */
export function advertiserIdKey(platform: string, advertiserId: string): string {
  return `${platform}:${advertiserId}`;
}

/**
 * Key of a payer node. Meta keeps the bare normalised name (the payers read by `--ad-library` use the
 * same key); other platforms get a platform prefix so that a payer name does not link records of
 * different libraries on its own.
 */
export function adPayerKey(platform: string, normalizedName: string): string {
  return platform === "meta" ? normalizedName : `${platform}:${normalizedName}`;
}
