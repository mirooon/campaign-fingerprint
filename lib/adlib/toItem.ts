/**
 * Library record -> material for the analysis. Pure functions: the record becomes flat columns
 * (the format of `input.json` of a case import) and the same ingest step as for any other dataset
 * reads them into an `Item`. The columns beyond the item fields (`ad_platform`, `advertiser_id`, ...)
 * land in `Item.extra`, where `lib/graph/adLibraryTraces.ts` reads them as graph traces.
 */
import { AD_LIBRARY_ID_RE } from "../osint/adLibrary";
import { normalizeRecords, type ColumnMapping } from "../pipeline/ingest";
import type { Item } from "../pipeline/types";
import type { AdRecord } from "./types";

/** Column names of the flat record that `adRecordColumns` produces, mapped to `Item` fields. */
export const AD_COLUMN_MAPPING: ColumnMapping = {
  id: "id",
  platform: "platform",
  advertiser: "advertiser",
  text: "text",
  imageUrl: "image_url",
  landingUrl: "landing_url",
  firstSeen: "first_seen",
  lastSeen: "last_seen",
};

/** Material id of a record: platform and library ID, safe as a folder name. */
export function adRecordItemId(rec: Pick<AdRecord, "platform" | "adId">): string {
  return `${rec.platform}_${rec.adId.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
}

/**
 * Flat columns of a record, only the filled ones. Text creatives are joined into `text`; the first
 * image creative gives `image_url`. `ad_library_id` is set only for Meta (a numeric ID), the one
 * platform whose library ID the graph already reads by that name; other platforms use `ad_platform`
 * with `ad_id`, which the graph keys with the platform so IDs of different libraries never collide.
 */
export function adRecordColumns(rec: AdRecord): Record<string, string> {
  const cols: Record<string, string> = { id: adRecordItemId(rec), platform: rec.platform, ad_platform: rec.platform, ad_id: rec.adId, ad_library_url: rec.libraryUrl };
  const set = (k: string, v: string | undefined | null) => {
    if (v) cols[k] = v;
  };
  const texts = rec.creatives.filter((c) => c.kind === "text" && c.text).map((c) => c.text as string);
  set("text", texts.join("\n"));
  set("image_url", rec.creatives.find((c) => c.kind === "image" && c.url)?.url);
  set("landing_url", rec.landingUrl);
  set("first_seen", rec.firstSeen);
  set("last_seen", rec.lastSeen);
  // the library's own delivery dates, kept apart: first_seen of an item may be replaced by the capture date
  set("ad_first_shown", rec.firstSeen);
  set("ad_last_shown", rec.lastSeen);
  set("advertiser", rec.advertiser?.name);
  set("advertiser_id", rec.advertiser?.id);
  set("advertiser_legal_name", rec.advertiser?.legalName);
  set("advertiser_location", rec.advertiser?.location);
  if (typeof rec.advertiser?.verified === "boolean") cols.advertiser_verified = String(rec.advertiser.verified);
  set("ad_payers", rec.payers?.join(" | "));
  set("ad_regions", rec.regions?.join(" | "));
  if (rec.platform === "meta" && AD_LIBRARY_ID_RE.test(rec.adId)) cols.ad_library_id = rec.adId;
  return cols;
}

/** The material (`Item`) of a library record, the same one `analyze-material` reads from its case folder. */
export function adRecordToItem(rec: AdRecord): Item {
  return normalizeRecords([adRecordColumns(rec)], AD_COLUMN_MAPPING).items[0];
}
