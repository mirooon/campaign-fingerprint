/**
 * Reading an `AdRecord` back from JSON (the `adlib.json` file of a case folder, the output of a
 * helper script). Pure: takes parsed JSON, returns a record or the reason it is not one.
 */
import { AD_PLATFORMS, type AdPlatform, type AdRecord } from "./types";

/** Trimmed text, or undefined for a missing or blank value. */
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
/** The non-blank strings of an array, or undefined when the value is not an array. */
const strs = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(str).filter((s): s is string => !!s) : undefined);

/**
 * Parses and validates a record. Returns `null` with a reason when the platform, the ID or the
 * library address is missing (such a record cannot be a trace); unknown fields are dropped.
 */
export function parseAdRecord(json: unknown): { record: AdRecord; error: null } | { record: null; error: string } {
  if (!json || typeof json !== "object") return { record: null, error: "not an object" };
  const j = json as Record<string, unknown>;
  const platform = str(j.platform) as AdPlatform | undefined;
  if (!platform || !AD_PLATFORMS.includes(platform)) return { record: null, error: `unknown platform “${String(j.platform)}”` };
  const adId = str(j.adId);
  if (!adId) return { record: null, error: "no adId" };
  const libraryUrl = str(j.libraryUrl);
  if (!libraryUrl) return { record: null, error: "no libraryUrl" };
  const a = j.advertiser && typeof j.advertiser === "object" ? (j.advertiser as Record<string, unknown>) : null;
  const name = a ? str(a.name) : undefined;
  const creatives = (Array.isArray(j.creatives) ? j.creatives : []).flatMap((c): AdRecord["creatives"] => {
    const o = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
    const kind = o.kind === "image" || o.kind === "video" || o.kind === "text" ? o.kind : null;
    return kind ? [{ kind, url: str(o.url), text: str(o.text), localPath: str(o.localPath) }] : [];
  });
  return {
    error: null,
    record: {
      platform,
      adId,
      libraryUrl,
      fetchedAt: str(j.fetchedAt) ?? new Date(0).toISOString(),
      ...(a && name
        ? { advertiser: { name, id: str(a.id), legalName: str(a.legalName), location: str(a.location), verified: typeof a.verified === "boolean" ? a.verified : a.verified === null ? null : undefined } }
        : {}),
      payers: strs(j.payers),
      firstSeen: str(j.firstSeen),
      lastSeen: str(j.lastSeen),
      regions: strs(j.regions),
      creatives,
      landingUrl: str(j.landingUrl),
    },
  };
}
