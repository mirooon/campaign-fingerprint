/**
 * Meta access tokens as a pivot (B-144). A token (`EAA…`, 60+ characters) found in a URL (`token=`), in the
 * platform record (`fb_capi_token` of `window.aio`) or anywhere in page code is a secret of the operator's
 * ad account: two pages that carry the same token belong to one account. Only a SHA-256 digest ever leaves
 * this module; the token itself is never stored, shown, exported or sent anywhere (never to Meta either,
 * e.g. `debug_token`). The key of the pivot is the first 12 hex characters of the digest, the very form
 * `maskMetaToken` (redact.ts) writes into redacted material, so a page saved raw and the same page
 * redacted give the same pivot. Pure functions.
 */
import { createHash } from "node:crypto";
import { maskMetaToken } from "./redact";

/** Length of the digest prefix used as the pivot key (the form written by `maskMetaToken`). */
export const META_TOKEN_KEY_LENGTH = 12;

/** A Meta token standing in code or in a URL value: "EA" + 4 letters/digits at least, 60+ in all (real tokens have 150+). */
const RAW_TOKEN = /(?<![A-Za-z0-9])EA[A-Za-z0-9]{58,}(?![A-Za-z0-9])/g;
/** The masked form written by redaction: `EA…[sha256:<12 hex>]`. */
const MASKED_TOKEN = /EA…\[sha256:([0-9a-f]{12})\]/g;

/** Pivot key of one token: the first 12 hex characters of its SHA-256. */
export function metaTokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, META_TOKEN_KEY_LENGTH);
}

/**
 * Keys of the Meta tokens found in the given texts (page code, URLs), raw or already masked, sorted and
 * without repeats. The text is searched whole, so `token=`, `fb_capi_token` and bare occurrences all count.
 */
export function metaTokenKeysIn(texts: ReadonlyArray<string | null | undefined>): string[] {
  const keys = new Set<string>();
  for (const t of texts) {
    if (!t) continue;
    for (const m of t.matchAll(RAW_TOKEN)) keys.add(metaTokenKey(m[0]));
    for (const m of t.matchAll(MASKED_TOKEN)) keys.add(m[1]);
  }
  return [...keys].sort();
}

/** A Meta token anywhere in text, also shorter than a real one (20+ characters), for masking only. */
const ANY_TOKEN = /(?<![A-Za-z0-9])EA[A-Za-z0-9]{20,}(?![A-Za-z0-9])/g;

/** A string with every Meta token replaced by its mask (`EA…[sha256:<12 hex>]`). */
export function maskTokens(text: string): string {
  return text.replace(ANY_TOKEN, (t) => maskMetaToken(t));
}

/** A copy of `value` (any JSON-like structure) with Meta tokens masked in every string and every object key (the last line of defence before a file is written). */
export function maskTokensDeep<T>(value: T): T {
  if (typeof value === "string") return maskTokens(value) as T;
  if (Array.isArray(value)) return value.map((v) => maskTokensDeep(v)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [maskTokens(k), maskTokensDeep(v)])) as T;
  return value;
}
