/**
 * Campaign metadata leaking into landing URLs and redirect chains: UTM values,
 * affiliate sub-IDs, click/offer IDs, campaign/ad set/ad IDs and names, pixel IDs.
 * Media buyers reuse their naming templates, so these values link campaigns
 * (Bitdefender 2026 linked 310 campaigns by UTM and pixel signatures).
 *
 * Extraction only: deciding which values are generic (facebook, cpc, …) is the
 * graph layer's job. Pure functions, no network access.
 */

export type CampaignParamName =
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "utm_content"
  | "utm_term"
  | "utm_id"
  | "sub1"
  | "sub2"
  | "sub3"
  | "sub4"
  | "sub5"
  | "aff_id"
  | "click_id"
  | "offer_id"
  | "campaign_id"
  | "campaign_name"
  | "adset_id"
  | "adset_name"
  | "ad_id"
  | "ad_name"
  | "pixel_id";

export interface CampaignParam {
  /** Parameter name as it appeared in the URL. */
  name: string;
  canonicalName: CampaignParamName;
  /** Decoded, trimmed value (max 120 characters). */
  value: string;
  /** First URL the value was seen in. */
  sourceUrl: string;
  /** Value contains Cyrillic letters (often Russian campaign names). */
  cyrillic: boolean;
  /** Value is an unresolved template macro such as {{campaign.name}}. */
  macro: boolean;
}

const MAX_VALUE = 120;

const ALIASES: Record<string, CampaignParamName> = {
  utm_source: "utm_source",
  utm_medium: "utm_medium",
  utm_campaign: "utm_campaign",
  utm_content: "utm_content",
  utm_term: "utm_term",
  utm_id: "utm_id",
  sub1: "sub1",
  sub2: "sub2",
  sub3: "sub3",
  sub4: "sub4",
  sub5: "sub5",
  subid: "sub1",
  sub_id: "sub1",
  sub_id1: "sub1",
  sub_id2: "sub2",
  sub_id3: "sub3",
  sub_id4: "sub4",
  sub_id5: "sub5",
  aff_sub: "sub1",
  aff_sub1: "sub1",
  aff_sub2: "sub2",
  aff_sub3: "sub3",
  aff_sub4: "sub4",
  aff_sub5: "sub5",
  aff_id: "aff_id",
  affid: "aff_id",
  affiliate_id: "aff_id",
  aff: "aff_id",
  affiliate: "aff_id",
  clickid: "click_id",
  click_id: "click_id",
  offer_id: "offer_id",
  offerid: "offer_id",
  offer: "offer_id",
  campaign: "campaign_id",
  campaign_id: "campaign_id",
  campaignid: "campaign_id",
  cmp: "campaign_id",
  cmpid: "campaign_id",
  campaign_name: "campaign_name",
  cmp_name: "campaign_name",
  adset: "adset_id",
  adset_id: "adset_id",
  adsetid: "adset_id",
  ad_set: "adset_id",
  adset_name: "adset_name",
  ad: "ad_id",
  ad_id: "ad_id",
  adid: "ad_id",
  creative: "ad_id",
  creative_id: "ad_id",
  crid: "ad_id",
  ad_name: "ad_name",
  creative_name: "ad_name",
  pixel: "pixel_id",
  pixel_id: "pixel_id",
  pixelid: "pixel_id",
  fbpixel: "pixel_id",
  fb_pixel: "pixel_id",
  px: "pixel_id",
};

const CYRILLIC = /[Ѐ-ӿ]/;
const MACRO_PATTERNS = [/\{\{[^{}]*\}\}/, /\{[A-Za-z0-9_.]+\}/, /\[\[[^[\]]*\]\]/, /%%[^%]+%%/];

/** Canonical parameter name for a raw query parameter name, or null when not a campaign parameter. */
export function canonicalParamName(raw: string): CampaignParamName | null {
  const key = raw.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ALIASES, key) ? ALIASES[key] : null;
}

function isMacro(value: string): boolean {
  return MACRO_PATTERNS.some((re) => re.test(value));
}

/** Query-like parameters carried in the fragment ("#utm_campaign=x&sub1=y" or "#?…"). */
function fragmentParams(hash: string): URLSearchParams | null {
  const h = hash.replace(/^#\??/, "");
  if (!h.includes("=")) return null;
  try {
    return new URLSearchParams(h);
  } catch {
    return null;
  }
}

/**
 * Extracts campaign parameters from a list of URLs (landing URL, redirect hops,
 * final URL). Invalid URLs are skipped. Deduplicated by canonical name and
 * case-insensitive value, keeping the first URL a value was seen in.
 */
export function extractCampaignParams(urls: Array<string | null | undefined>): CampaignParam[] {
  const out: CampaignParam[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    if (!raw || !raw.trim()) continue;
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      continue;
    }
    const sources: URLSearchParams[] = [url.searchParams];
    const frag = fragmentParams(url.hash);
    if (frag) sources.push(frag);
    for (const params of sources) {
      for (const [name, rawValue] of params) {
        const canonicalName = canonicalParamName(name);
        if (!canonicalName) continue;
        const value = rawValue.replace(/\s+/g, " ").trim().slice(0, MAX_VALUE);
        if (!value) continue;
        const key = `${canonicalName}\u0000${value.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          name,
          canonicalName,
          value,
          sourceUrl: raw.trim(),
          cyrillic: CYRILLIC.test(value),
          macro: isMacro(value),
        });
      }
    }
  }
  return out;
}

export interface ParamSchema {
  /** Sorted `name:shape` pairs joined with "|", e.g. "utm_id:tok|utm_visit:uuid". */
  key: string;
  /** Lower-cased parameter names, sorted. */
  names: string[];
}

/** Click IDs appended by ad platforms: they say nothing about the advertiser's own link template. */
const PLATFORM_CLICK_PARAMS = new Set([
  "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "gad_source", "gad_campaignid", "msclkid", "ttclid", "twclid",
  "yclid", "ysclid", "igshid", "li_fat_id", "srsltid", "mc_cid", "mc_eid", "_ga", "_gl",
]);
const MIN_SCHEMA_PARAMS = 3;
const MIN_SCHEMA_OPAQUE = 2;
const MAX_SCHEMA_PARAMS = 12;
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ValueShape = "uuid" | "hex" | "tok" | "num" | "word";

/** Random-looking token: letters with digits, or mixed case beyond a leading capital. */
function isOpaqueToken(v: string): boolean {
  if (!/^[A-Za-z0-9]{8,}$/.test(v)) return false;
  if (/\d/.test(v) && /[A-Za-z]/.test(v)) return true;
  return (v.slice(1).match(/[A-Z]/g)?.length ?? 0) >= 2 && (v.match(/[a-z]/g)?.length ?? 0) >= 2;
}

function valueShape(v: string): ValueShape {
  if (UUID_VALUE.test(v)) return "uuid";
  if (/^\d+$/.test(v)) return "num";
  if (/^[0-9a-f]{16,}$/i.test(v)) return "hex";
  return isOpaqueToken(v) ? "tok" : "word";
}

/**
 * Template of a machine-generated tracking link: which parameters it carries and what kind of
 * value each holds. Two clicks through one traffic-distribution system share the template even
 * though every value differs. Returns null for links without at least three parameters, two of
 * them random-looking (UUID, hex, token): hand-written UTM sets are common to everyone.
 */
export function paramSchema(rawUrl: string | null | undefined): ParamSchema | null {
  if (!rawUrl || !rawUrl.trim()) return null;
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  const shapes = new Map<string, ValueShape>();
  for (const [rawName, rawValue] of url.searchParams) {
    const name = rawName.trim().toLowerCase();
    if (!name || PLATFORM_CLICK_PARAMS.has(name) || shapes.has(name)) continue;
    shapes.set(name, valueShape(rawValue.trim()));
  }
  if (shapes.size < MIN_SCHEMA_PARAMS || shapes.size > MAX_SCHEMA_PARAMS) return null;
  const opaque = [...shapes.values()].filter((s) => s === "uuid" || s === "hex" || s === "tok").length;
  if (opaque < MIN_SCHEMA_OPAQUE) return null;
  const names = [...shapes.keys()].sort();
  return { key: names.map((n) => `${n}:${shapes.get(n)}`).join("|"), names };
}
