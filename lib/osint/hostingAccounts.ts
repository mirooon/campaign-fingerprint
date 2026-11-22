/**
 * Accounts on video and file hosting read from the addresses of a page's resources (B-342, narrow case of
 * B-148). A Bunny Stream library has its own host `vz-<8 hex>-<3 hex>.b-cdn.net`: the 8 hex digits name the
 * library, i.e. one customer's account. Two pages playing videos from one library are the same account's
 * work, unlike the CDN domain `b-cdn.net`, which thousands of unrelated sites share. Pure functions.
 */

/** Host of a Bunny Stream library: `vz-<library>-<zone>.b-cdn.net`; group 1 is the library id. */
const BUNNY_STREAM_HOST = /\bvz-([0-9a-f]{8})-[0-9a-f]{3}\.b-cdn\.net\b/gi;

/**
 * A file served by jsDelivr straight from a GitHub repository: `cdn.jsdelivr.net/gh/<user>/<repo>…`
 * (B-148); group 1 is the GitHub account. The CDN domain itself is shared by everyone, the account is not.
 */
const JSDELIVR_GH = /\bcdn\.jsdelivr\.net\/gh\/([a-z0-9](?:[a-z0-9-]{0,38}))\/[^\s"'<>]/gi;

/** Most accounts kept per page. */
const MAX_ACCOUNTS = 10;

/**
 * Keys `service:account` of the hosting accounts named in a text (page source or a list of request
 * addresses), unique and sorted: `bunny_stream:<library>` and `gh:<GitHub user>` (jsDelivr `/gh/`).
 */
export function hostingAccounts(text: string): string[] {
  const found = new Set<string>();
  for (const m of (text ?? "").slice(0, 3_000_000).matchAll(BUNNY_STREAM_HOST)) found.add(`bunny_stream:${m[1].toLowerCase()}`);
  for (const m of (text ?? "").slice(0, 3_000_000).matchAll(JSDELIVR_GH)) found.add(`gh:${m[1].toLowerCase()}`);
  return [...found].sort().slice(0, MAX_ACCOUNTS);
}
