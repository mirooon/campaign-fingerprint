/**
 * Campaign metadata leaking into landing URLs and redirect chains: UTM values,
 * affiliate sub-IDs, click/offer IDs, campaign/ad set/ad IDs and names, pixel IDs.
 * Media buyers reuse their naming templates, so these values link campaigns
 * (Bitdefender 2026 linked 310 campaigns by UTM and pixel signatures).
 *
 * The same identifiers travel with the lead: hidden fields of the form and config objects of the page
 * scripts carry the affiliate, offer and flow of the network that buys the leads (I23).
 *
 * Extraction only: deciding which values are generic (facebook, cpc, …) is the
 * graph layer's job. Pure functions, no network access.
 */
import { scanTags, splitHtml } from "./extract";

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
  | "pixel_id"
  | "tracker_campaign"
  // account of the media buyer in a tracker or TDS link (acc=, _buyer=): one buyer, a strong trace (B-140)
  | "buyer_account"
  // ad placement (utm_placement=Facebook_Mobile_Feed): a platform value, weak (B-140)
  | "placement"
  // campaign of the advertiser in Google Ads (gad_campaignid=), appended by Google to the ad's link (B-159)
  | "google_campaign"
  // affiliate-network names (I23): the flow (stream) of one affiliate to one offer, the traffic source
  // of the affiliate and the landing page of the offer
  | "flow_id"
  | "source_id"
  | "landing_id";

/** Where a campaign parameter was found: the address, a hidden field of the lead form or a page script. */
export type ParamOrigin = "url" | "form" | "script";

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
  /** Where the value was found; missing means "url" (all parameters extracted before I23). */
  origin?: ParamOrigin;
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
  // tracker and TDS aliases (B-140)
  acc: "buyer_account",
  _buyer: "buyer_account",
  buyer: "buyer_account",
  _subid: "sub1",
  sub_1: "sub1",
  land_id: "campaign_id",
  _camp_id: "campaign_id",
  creo: "ad_name",
  utm_code: "utm_campaign",
  placement: "placement",
  utm_placement: "placement",
  gad_campaignid: "google_campaign",
  // campaign key of a tracker product (Binom: "/click?key=<32 hex>", also under the renamed "f7nx2")
  key: "tracker_campaign",
  f7nx2: "tracker_campaign",
  // affiliate networks and their trackers (I23): partner, webmaster (wm) and pid name the affiliate
  pid: "aff_id",
  partner: "aff_id",
  partner_id: "aff_id",
  wm: "aff_id",
  wm_id: "aff_id",
  webmaster: "aff_id",
  webmaster_id: "aff_id",
  source_id: "source_id",
  aff_click_id: "click_id",
  stream: "flow_id",
  stream_id: "flow_id",
  flow: "flow_id",
  flow_id: "flow_id",
  buyer_id: "buyer_account",
  landing_id: "landing_id",
  lp_id: "landing_id",
  s1: "sub1",
  s2: "sub2",
  s3: "sub3",
  s4: "sub4",
  s5: "sub5",
};

/**
 * Names that mean a campaign parameter only in a lead form or a page script: "source" and "landing" of
 * an address are too common (referrers, page names), in the hidden fields of the form they are the
 * network's source and landing IDs.
 */
const FORM_ALIASES: Record<string, CampaignParamName> = {
  source: "source_id",
  landing: "landing_id",
};

/** Keys of page-script config objects (`{ affiliateId: "…" }`), lower-cased, with their canonical name. */
const SCRIPT_KEYS: Record<string, CampaignParamName> = {
  affiliateid: "aff_id",
  affid: "aff_id",
  partnerid: "aff_id",
  webmasterid: "aff_id",
  offerid: "offer_id",
  flowid: "flow_id",
  streamid: "flow_id",
  landingid: "landing_id",
  source: "source_id",
};
const SCRIPT_KEY_RE = /(?<![\w$])["']?(affiliateId|affId|partnerId|webmasterId|offerId|flowId|streamId|landingId|source)["']?\s*[:=]\s*(["'`])([^"'`\n]{1,120})\2/gi;

/**
 * Value format a parameter must have to count, by canonical name. "key" is a common name (API keys,
 * search keys): only the 32-hex value the tracker generates for one campaign names a tracker campaign.
 */
const VALUE_FORMAT: Partial<Record<CampaignParamName, RegExp>> = {
  tracker_campaign: /^[0-9a-f]{32}$/i,
};

/**
 * Value format by raw (lower-cased) name for short, common names (pid, flow, s1, partner, source …):
 * many sites use them for their own page or product numbers and test values, so only an identifier with
 * a digit and at least 3 characters counts ("1", "test", "default" and macros do not).
 */
const IDENTIFIER_VALUE = /^(?=.*\d)[A-Za-z0-9_.-]{3,64}$/;
const NAME_VALUE_FORMAT: Record<string, RegExp> = Object.fromEntries(
  ["pid", "partner", "wm", "webmaster", "flow", "stream", "s1", "s2", "s3", "s4", "s5", "source", "landing"].map((n) => [n, IDENTIFIER_VALUE]),
);

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

/**
 * Builds a campaign parameter from a raw name and value, or returns null when the value is empty or
 * outside the format of its parameter (VALUE_FORMAT by canonical name, NAME_VALUE_FORMAT by raw name).
 * The value is whitespace-collapsed and cut to MAX_VALUE characters.
 */
function makeParam(name: string, canonicalName: CampaignParamName, rawValue: string, sourceUrl: string, origin?: ParamOrigin): CampaignParam | null {
  const value = rawValue.replace(/\s+/g, " ").trim().slice(0, MAX_VALUE);
  if (!value) return null;
  if (VALUE_FORMAT[canonicalName] && !VALUE_FORMAT[canonicalName].test(value)) return null;
  const nameFormat = NAME_VALUE_FORMAT[name.trim().toLowerCase()];
  if (nameFormat && !nameFormat.test(value)) return null;
  return { name, canonicalName, value, sourceUrl, cyrillic: CYRILLIC.test(value), macro: isMacro(value), ...(origin ? { origin } : {}) };
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
 * final URL). Invalid URLs are skipped, and so are values outside the format of
 * their parameter (VALUE_FORMAT). Deduplicated by canonical name and
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
        const param = makeParam(name, canonicalName, rawValue, raw.trim());
        if (!param) continue;
        const key = `${canonicalName}\u0000${param.value.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(param);
      }
    }
  }
  return out;
}

/**
 * Campaign parameters written into the page itself: hidden fields of its forms (`<input type=hidden
 * name="aff_id" value="…">`, also "offer", "flow", "source", "landing") and keys of config objects in
 * its inline scripts (`affiliateId`, `offerId`, `flowId`, `partnerId`, `landingId`, `source`). The lead
 * goes to the CRM with these IDs, so they name the affiliate and offer as reliably as the link does.
 * `pageUrl` becomes the source URL. Deduplicated by canonical name and case-insensitive value, form
 * fields first; values outside the parameter's format are skipped like in addresses.
 */
export function extractPageCampaignParams(html: string, pageUrl: string): CampaignParam[] {
  if (!html) return [];
  const out: CampaignParam[] = [];
  const seen = new Set<string>();
  const push = (p: CampaignParam | null) => {
    if (!p) return;
    const key = `${p.canonicalName}\u0000${p.value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(p);
  };
  for (const tag of scanTags(html)) {
    if (tag.name !== "input" || (tag.attrs.type ?? "").toLowerCase() !== "hidden") continue;
    const name = (tag.attrs.name ?? "").trim();
    const canonical = canonicalParamName(name) ?? FORM_ALIASES[name.toLowerCase()] ?? null;
    if (canonical) push(makeParam(name, canonical, tag.attrs.value ?? "", pageUrl, "form"));
  }
  for (const script of splitHtml(html).scripts) {
    for (const m of script.matchAll(SCRIPT_KEY_RE)) {
      const canonical = SCRIPT_KEYS[m[1].toLowerCase()];
      if (canonical) push(makeParam(m[1], canonical, m[3], pageUrl, "script"));
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
