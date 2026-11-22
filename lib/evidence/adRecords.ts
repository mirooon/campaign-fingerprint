/**
 * What the evidence pack says about an ad's place on the platform: ad-library IDs (from the input,
 * from OCR of the screenshots and from the fetched records), the link to the library record, and the
 * payer, beneficiary and removal status from the Meta Ad Library record fetched with `--ad-library`.
 * Pure functions over data the pipeline already holds; nothing is fetched here.
 */
import { AD_LIBRARY_ID_RE, adLibraryUrl, type AdLibraryInfo } from "../osint/adLibrary";
import type { Item, ItemEnrichment } from "../pipeline/types";
import { stripUiChrome } from "../text/uiChrome";

/** A library record as written to the pack: the platform's declaration, when it was fetched and the hash of the raw answer. */
export interface RepositoryRecord {
  id: string;
  taken_down: boolean | null;
  violations: string[];
  eu_reach: number | null;
  page_id: string | null;
  page_name: string | null;
  page_deleted: boolean | null;
  targeting: { age_min: number | null; age_max: number | null; gender: string | null; locations: string[] };
  fetched_utc: string | null;
  response_sha256: string | null;
  source: string;
}

export interface AdLibraryFacts {
  /** Library IDs: input column, OCR of the screenshots, fetched records; unique, in that order. */
  ids: string[];
  /** Link to the library record of every ID, with filters that also show removed ads. */
  urls: string[];
  /** Declared payer(s) joined with "; ", null without a record. */
  payer: string | null;
  beneficiary: string | null;
  /** Records without an error; null when none was fetched. */
  records: RepositoryRecord[] | null;
}

const SOURCE = "Meta Ad Library (MetaAdsCollector, publiczny endpoint biblioteki reklam)";

/** Record as written to the pack. */
function toRecord(r: AdLibraryInfo): RepositoryRecord {
  return {
    id: r.id,
    taken_down: r.takenDown,
    violations: r.violations,
    eu_reach: r.euReach,
    page_id: r.pageId,
    page_name: r.pageName,
    page_deleted: r.pageDeleted,
    targeting: { age_min: r.ageMin, age_max: r.ageMax, gender: r.gender, locations: r.locations },
    fetched_utc: r.fetchedAt ?? null,
    response_sha256: r.rawSha256 ?? null,
    source: SOURCE,
  };
}

/** Values joined with "; " without repeats; null for none. */
const joined = (values: string[]): string | null => {
  const unique = [...new Set(values)];
  return unique.length ? unique.join("; ") : null;
};

/** Library facts of one ad; `enr` may be missing (the ad was not enriched). */
export function adLibraryFacts(item: Item, enr: ItemEnrichment | undefined): AdLibraryFacts {
  const good = (enr?.adLibrary ?? []).filter((r) => !r.error);
  const ids = [
    ...new Set([
      ...(AD_LIBRARY_ID_RE.test(item.extra.ad_library_id ?? "") ? [item.extra.ad_library_id] : []),
      ...(enr?.ocrText ? stripUiChrome(enr.ocrText).adLibraryIds : []),
      ...(enr?.extraOcrText ? stripUiChrome(enr.extraOcrText).adLibraryIds : []),
      ...good.map((r) => r.id),
    ]),
  ];
  return {
    ids,
    urls: ids.map(adLibraryUrl),
    payer: joined(good.flatMap((r) => r.payers)),
    beneficiary: joined(good.flatMap((r) => r.beneficiaries)),
    records: good.length ? good.map(toRecord) : null,
  };
}

/** Address of a Facebook page from its numeric ID (the page opens whatever its name). */
export function pageUrl(pageId: string): string {
  return `https://www.facebook.com/${pageId}`;
}
