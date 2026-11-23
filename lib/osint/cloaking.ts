/**
 * Verdict of the opt-in cloaking check (two fetches with a crawler and a mobile User-Agent). An anti-bot
 * challenge page of a CDN (403/503 "Just a moment…", cf-chl) is a blocked fetch: comparing it with the real
 * page would read protection as cloaking (B-117), so such a check is reported as `bot_challenge` instead.
 */
import type { CloakingCheck, CloakingVariant } from "../pipeline/types";
import { simhashDistance } from "./pagekit";
import { normalizeUrl } from "./urls";

/** Markers of anti-bot challenge pages (Cloudflare, generic "checking your browser"). */
const CHALLENGE_MARKERS = /cf-chl|challenge-platform|just a moment\.\.\.|checking your browser|attention required!? \| cloudflare|cf_chl_opt/i;
/** Statuses a challenge page is served with. */
const CHALLENGE_STATUSES = new Set([403, 429, 503]);

/** Whether a response (status and body, first 20 kB read) is an anti-bot challenge page rather than the site. */
export function isBotChallenge(status: number | null, body: string | null | undefined): boolean {
  return status !== null && CHALLENGE_STATUSES.has(status) && CHALLENGE_MARKERS.test((body ?? "").slice(0, 20_000));
}

/**
 * Compares the crawler and mobile variants of one page: a different final address, a DOM simhash distance
 * above `domThreshold` (bits of 64) or one variant served and the other not make cloaking suspected, with
 * the reasons in plain words. A challenge page on either side makes the check `bot_challenge`, never suspected.
 */
export function cloakingVerdict(crawler: CloakingVariant, mobile: CloakingVariant, domThreshold: number): CloakingCheck {
  const norm = (u: string | null) => (u ? (normalizeUrl(u)?.url ?? u) : null);
  const finalUrlDiffers = !!crawler.finalUrl && !!mobile.finalUrl && norm(crawler.finalUrl) !== norm(mobile.finalUrl);
  const domDistance = crawler.domSimhash && mobile.domSimhash ? simhashDistance(crawler.domSimhash, mobile.domSimhash) : null;
  if (crawler.botChallenge || mobile.botChallenge) {
    return { crawler, mobile, finalUrlDiffers, domDistance, suspected: false, reasons: [`fetch blocked by bot protection (${crawler.botChallenge ? "crawler" : "mobile browser"}): cloaking cannot be assessed`], state: "bot_challenge" };
  }
  const ok = (v: CloakingVariant) => !v.error && v.status !== null && v.status >= 200 && v.status < 300;
  const reasons: string[] = [];
  if (finalUrlDiffers) reasons.push(`different final URL: crawler → ${crawler.finalUrl}, mobile browser → ${mobile.finalUrl}`);
  if (domDistance !== null && domDistance > domThreshold) reasons.push(`different page structure (DOM simhash, distance ${domDistance}/64)`);
  if (ok(crawler) !== ok(mobile)) reasons.push(`different fetch result: crawler ${crawler.status ?? crawler.error}, mobile ${mobile.status ?? mobile.error}`);
  return { crawler, mobile, finalUrlDiffers, domDistance, suspected: reasons.length > 0, reasons, state: "checked" };
}
