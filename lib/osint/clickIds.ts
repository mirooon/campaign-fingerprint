/**
 * Identifiers in landing URLs that carry more than a random token.
 *
 * - Click IDs in the xid format (20 characters of base32hex): 4 bytes of time, 3 bytes of a machine
 *   ID, 2 bytes of a process ID and a counter. The same machine and process mean the same tracker
 *   server, so two landing pages reached through it share the click-routing infrastructure; the
 *   counter shows how many IDs that process has issued.
 * - The newer Meta `fbclid` ("PA…"): a base64 record whose `adid` field is the ID of the clicked ad
 *   and `app_id` the app it was shown in.
 * Pure functions, no network access.
 */

export interface XidInfo {
  /** Time the ID was issued (ISO 8601, seconds). */
  time: string;
  /** 3-byte machine ID, hex. */
  machine: string;
  pid: number;
  counter: number;
}

const XID = /^[0-9a-v]{20}$/;
const B32HEX = "0123456789abcdefghijklmnopqrstuv";
const XID_MIN_TIME = Date.UTC(2016, 0, 1) / 1000;
const XID_MAX_TIME = Date.UTC(2040, 0, 1) / 1000;
/** Parameter names that hold click or visit IDs in tracker links. */
const CLICK_PARAM = /(?:click|cid|sub|visit|track|tid|uid)/i;

/** Decodes an xid; null when the value is not one (format or an implausible time). */
export function decodeXid(value: string): XidInfo | null {
  const v = value.trim().toLowerCase();
  if (!XID.test(v)) return null;
  const bytes: number[] = [];
  let bits = 0;
  let n = 0;
  for (const ch of v) {
    bits = ((bits << 5) | B32HEX.indexOf(ch)) & 0xffff;
    n += 5;
    if (n >= 8) {
      n -= 8;
      bytes.push((bits >> n) & 0xff);
    }
  }
  if (bytes.length < 12) return null;
  const ts = ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
  if (ts < XID_MIN_TIME || ts > XID_MAX_TIME) return null;
  return {
    time: new Date(ts * 1000).toISOString().replace(/\.000Z$/, "Z"),
    machine: bytes.slice(4, 7).map((b) => b.toString(16).padStart(2, "0")).join(""),
    pid: (bytes[7] << 8) + bytes[8],
    counter: (bytes[9] << 16) + (bytes[10] << 8) + bytes[11],
  };
}

export interface FbclidInfo {
  /** ID of the clicked ad (Meta Marketing API ad ID, not the Ad Library ID). */
  adId: string | null;
  /** ID of the app the ad was shown in. */
  appId: string | null;
}

/** Decodes the newer `fbclid` format; null for the older opaque one. */
export function decodeFbclid(value: string): FbclidInfo | null {
  const v = value.trim();
  if (!/^PA[A-Za-z0-9_-]{20,}/.test(v)) return null;
  let raw: Buffer;
  try {
    raw = Buffer.from(v.slice(2).split("_aem_")[0].replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } catch {
    return null;
  }
  const at = raw.indexOf("adid");
  let adId: string | null = null;
  if (at >= 0 && raw.length >= at + 12) {
    const id = raw.readBigUInt64BE(at + 4).toString();
    if (/^\d{15,19}$/.test(id)) adId = id;
  }
  let appId: string | null = null;
  const ap = raw.indexOf("app_id");
  if (ap >= 0 && raw.length > ap + 7) {
    const len = raw[ap + 6];
    const digits = raw.subarray(ap + 7, ap + 7 + len).toString("latin1");
    if (len > 0 && len <= 20 && /^\d+$/.test(digits)) appId = digits;
  }
  return adId || appId ? { adId, appId } : null;
}

export interface UrlClickIds {
  xids: Array<XidInfo & { param: string; value: string }>;
  fbclids: Array<FbclidInfo & { value: string }>;
}

/** Click IDs found in the query strings of the given URLs (landing URL, redirect hops). */
export function clickIdsFromUrls(urls: Array<string | null | undefined>): UrlClickIds {
  const out: UrlClickIds = { xids: [], fbclids: [] };
  const seen = new Set<string>();
  for (const raw of urls) {
    let u: URL;
    try {
      u = new URL(String(raw ?? "").trim());
    } catch {
      continue;
    }
    for (const [name, value] of u.searchParams) {
      if (seen.has(value)) continue;
      if (name.toLowerCase() === "fbclid") {
        const f = decodeFbclid(value);
        if (f) {
          seen.add(value);
          out.fbclids.push({ ...f, value });
        }
        continue;
      }
      if (!CLICK_PARAM.test(name)) continue;
      const x = decodeXid(value);
      if (x) {
        seen.add(value);
        out.xids.push({ ...x, param: name, value });
      }
    }
  }
  return out;
}
