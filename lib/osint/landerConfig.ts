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
}

const AIO = /window\.aio\s*=\s*JSON\.parse\(\s*'((?:[^'\\]|\\[\s\S])*)'\s*\)/;
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
