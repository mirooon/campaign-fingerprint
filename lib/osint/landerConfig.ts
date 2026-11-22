/**
 * Configuration that a landing-page platform embeds in the page.
 *
 * Some page builders that serve many scam domains write their own records into every page, e.g.
 * `window.aio = JSON.parse('{"campaign":{"owner_uuid":…,"uuid":…,"name":…},"landing":{…},"source":{…}}')`.
 * That is the platform's account (owner), the campaign inside the account, the landing page and its
 * template, and the traffic source the buyer set up (e.g. "FB CAPI via TestCloaker"). The account and
 * the campaign identify the operator; a template shared by different accounts identifies a kit.
 * Pure functions, no network access.
 */

export interface LanderConfig {
  /** Platform marker, e.g. "aio" for `window.aio`. */
  platform: string;
  /** Account that owns the campaign (lower-case UUID). */
  ownerId: string | null;
  campaignId: string | null;
  campaignName: string | null;
  /** Sequential campaign number shown in the platform's panel. */
  campaignNumber: string | null;
  landingId: string | null;
  landingName: string | null;
  /** Template of the landing page (shared across accounts that use the same kit). */
  templateId: string | null;
  landerTypeId: string | null;
  sourceId: string | null;
  /** Traffic source configured by the buyer ("FB CAPI", "Google", "… via <cloaker>"). */
  sourceName: string | null;
  /**
   * Cloaker account written by the platform into `visit.fields` (B-331): `cl_sid` (the cloaker customer's
   * stream/site), `cl_domain` (the cloaker host serving that customer) and `cl_did` (an id of one visit or
   * device, an attribute only). Absent when the record has no cloaker fields.
   */
  cloaker?: LanderCloaker;
  /**
   * `visit.fields.launcher` (or `visit.launcher`, B-345): UUID of the account the ads were launched from.
   * On most pages it is the same value as `ownerId`; absent when empty or not a UUID.
   */
  launcherId?: string;
  /** 16-digit numeric id inside `visit.fields.fb_campaign_name` ("PL - Name - 1234567890123456 - 2"), B-345. */
  fbCampaignNameId?: string;
}

/** Cloaker fields of the platform record (`visit.fields.cl_*`). */
export interface LanderCloaker {
  /** `cl_sid`: id of the cloaker customer's stream (digits or a short token). */
  sid: string | null;
  /** `cl_domain`: host of the cloaker, lower-case. */
  domain: string | null;
  /** `cl_did`: per-visit / device id, never a link. */
  did: string | null;
}

/** `window.aio = JSON.parse('…')`: the platform record as a single-quoted string literal (group 1 is its body). */
export const AIO = /window\.aio\s*=\s*JSON\.parse\(\s*'((?:[^'\\]|\\[\s\S])*)'\s*\)/;
const AIO_OBJECT = /window\.aio\s*=\s*(\{[\s\S]{0,200000}?\})\s*;?\s*(?:<\/script>|window\.)/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME = 160;

/** Decodes the body of a single-quoted JavaScript string literal. */
export function unescapeJsString(s: string): string {
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, e: string) => {
    if (e.startsWith("u{")) return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
    if (e.length > 1 && (e[0] === "u" || e[0] === "x")) return String.fromCharCode(parseInt(e.slice(1), 16));
    const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" };
    return map[e] ?? e;
  });
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function text(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, MAX_NAME) : null;
}

function uuid(v: unknown): string | null {
  const s = text(v);
  return s && UUID.test(s) ? s.toLowerCase() : null;
}

const CLOAKER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;
/** A 16-digit number standing alone in a campaign name (Meta campaign and ad account ids are 15-17 digits; 16 is the form seen). */
const CAMPAIGN_NAME_ID = /(?<!\d)(\d{16})(?!\d)/;

/** A short cloaker id (`cl_sid`, `cl_did`) as text, or null when empty or not a plain token. */
function cloakerId(v: unknown): string | null {
  const s = text(v);
  return s && CLOAKER_ID.test(s) ? s : null;
}

/** A host name (`cl_domain`), lower-case without scheme, path or port; null when it is not a host name. */
function hostName(v: unknown): string | null {
  const s = text(v)?.toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/:?#]/)[0] ?? null;
  return s && HOST.test(s) ? s : null;
}

/**
 * Cloaker, launcher and campaign-name id of the platform's visitor record (`visit` and `visit.fields`).
 * Only the operator's values are read: the cloaker customer (`cl_sid`, `cl_domain`), the per-visit
 * `cl_did` as an attribute, the launcher UUID and the 16-digit id in `fb_campaign_name`.
 */
function visitFields(visit: Record<string, unknown> | null): Pick<LanderConfig, "cloaker" | "launcherId" | "fbCampaignNameId"> {
  const fields = obj(visit?.fields);
  const out: Pick<LanderConfig, "cloaker" | "launcherId" | "fbCampaignNameId"> = {};
  const cloaker: LanderCloaker = { sid: cloakerId(fields?.cl_sid), domain: hostName(fields?.cl_domain), did: cloakerId(fields?.cl_did) };
  if (cloaker.sid || cloaker.domain || cloaker.did) out.cloaker = cloaker;
  const launcher = uuid(fields?.launcher) ?? uuid(visit?.launcher);
  if (launcher) out.launcherId = launcher;
  const name = text(fields?.fb_campaign_name);
  const id = name ? CAMPAIGN_NAME_ID.exec(name)?.[1] : undefined;
  if (id) out.fbCampaignNameId = id;
  return out;
}

/** Reads the `window.aio` record of a landing page; null when the page has none or it does not parse. */
export function extractLanderConfig(html: string): LanderConfig | null {
  let data: unknown = null;
  const m = AIO.exec(html);
  if (m) {
    try {
      data = JSON.parse(unescapeJsString(m[1]));
    } catch {
      data = null;
    }
  }
  if (!data) {
    const o = AIO_OBJECT.exec(html);
    if (o) {
      try {
        data = JSON.parse(o[1]);
      } catch {
        data = null;
      }
    }
  }
  const root = obj(data);
  if (!root) return null;
  const campaign = obj(root.campaign);
  const landing = obj(root.landing);
  const source = obj(root.source);
  const visit = obj(root.visit);
  const cfg: LanderConfig = {
    platform: "aio",
    ownerId: uuid(campaign?.owner_uuid),
    campaignId: uuid(campaign?.uuid),
    campaignName: text(campaign?.name),
    campaignNumber: text(visit?.campaign_human_id),
    landingId: uuid(landing?.uuid),
    landingName: text(landing?.name),
    templateId: uuid(landing?.lander_template_uuid),
    landerTypeId: uuid(landing?.lander_type_uuid),
    sourceId: uuid(source?.uuid),
    sourceName: text(source?.name),
    ...visitFields(visit),
  };
  return cfg.ownerId || cfg.campaignId || cfg.templateId ? cfg : null;
}

const LANDING_CDN = /\/landing-cdn\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

/**
 * Tenants of the landing-page platform in resource addresses: `…/landing-cdn/<uuid>/…` names the
 * account space the page's files are stored under. It is visible without the page code (a HAR, the
 * request list of a public scan) and stands in for `owner_uuid` of `window.aio`. Only UUIDs count: a
 * shared library of the platform (a short name such as "666") is used by many accounts.
 */
export function landingCdnTenants(urls: Iterable<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const raw of urls) {
    if (!raw) continue;
    let p: string;
    try {
      p = new URL(raw).pathname;
    } catch {
      p = String(raw).split(/[?#]/)[0];
    }
    const m = LANDING_CDN.exec(p);
    if (m) out.add(m[1].toLowerCase());
  }
  return [...out].sort();
}

/** Identifiers of the landing-page platform carried by its own links (`?cuuid=…&suuid=…&launcher=…`). */
export interface PlatformLinkIds {
  /** `cuuid`: the campaign inside the account (the `campaign.uuid` of `window.aio`). */
  campaignIds: string[];
  /** `suuid`: the traffic source the buyer set up (the `source.uuid` of `window.aio`). */
  sourceIds: string[];
  /** `launcher`: the account, the same value as `owner_uuid` (not a landing-cdn tenant). */
  ownerIds: string[];
}

const LINK_ID = /(?:[?&]|&amp;)(cuuid|suuid|launcher)=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f])/gi;

/**
 * Platform identifiers in query strings found anywhere in the given texts: link addresses (the ad's own
 * link, an address read by OCR, HAR requests) or whole page code, where scripts build such links. They
 * name the account and the campaign without the `window.aio` record. Lower-case UUIDs, sorted, unique;
 * null when there are none.
 */
export function platformLinkIds(texts: Iterable<string | null | undefined>): PlatformLinkIds | null {
  const found = { cuuid: new Set<string>(), suuid: new Set<string>(), launcher: new Set<string>() };
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(LINK_ID)) found[m[1].toLowerCase() as keyof typeof found].add(m[2].toLowerCase());
  }
  if (!found.cuuid.size && !found.suuid.size && !found.launcher.size) return null;
  return { campaignIds: [...found.cuuid].sort(), sourceIds: [...found.suuid].sort(), ownerIds: [...found.launcher].sort() };
}

/** Union of several sets of platform link identifiers (null entries skipped); null when all are empty. */
export function mergePlatformLinkIds(...sets: Array<PlatformLinkIds | null | undefined>): PlatformLinkIds | null {
  const list = sets.filter((x): x is PlatformLinkIds => !!x);
  if (!list.length) return null;
  const union = (pick: (x: PlatformLinkIds) => string[]) => [...new Set(list.flatMap(pick))].sort();
  return { campaignIds: union((x) => x.campaignIds), sourceIds: union((x) => x.sourceIds), ownerIds: union((x) => x.ownerIds) };
}
