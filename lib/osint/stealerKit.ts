/**
 * Static detection of a trojan in a copied lander kit (B-333): a fake library (e.g. a "lazysizes" copy on a
 * free static host or a jsDelivr `gh/<user>` path) that on admin-style paths replaces the page with a fake
 * tracker-panel login and sends `document.cookie` or typed credentials to a C2 host, often in a request
 * header. Both parts are required (a path check AND an exfiltration to a foreign host), so a genuine
 * library gives nothing. The code is only read, never run. Pure functions.
 */
import { registrableDomain } from "./urls";

export interface StealerKit {
  /** Signals that matched: path_check, exfil_cookie, exfil_credentials, request_header, fake_login. */
  signals: string[];
  /** C2 hosts (lower case, sorted, unique) the script sends the cookie or credentials to. */
  c2Hosts: string[];
}

/** A script is read up to this many characters. */
const MAX_CHARS = 2_000_000;
/** Characters before and after a request call that are searched for the stolen data (the header is often built just before the call). */
const BEFORE_WINDOW = 700;
const AFTER_WINDOW = 500;
/** A condition on `location` (before or after) next to a literal path of an admin or tracker panel. */
const PATH_CHECK = /(?:location\s*\.\s*(?:pathname|href)|pathname)[^;{}\n]{0,160}?["'`][^"'`]{0,40}\/(?:admin|panel|login|keitaro|binom|cp)\b|["'`][^"'`]{0,40}\/(?:admin|panel|login|keitaro|binom|cp)\b[^"'`]{0,40}["'`][^;{}\n]{0,160}?(?:location\s*\.\s*(?:pathname|href)|pathname)/i;
/** Requests with an absolute address: fetch, XHR open, sendBeacon, jQuery/axios calls. */
const REQUEST = /(?:fetch|sendBeacon|axios(?:\s*\.\s*(?:get|post))?|\$\s*\.\s*(?:ajax|get|post)|\.open\s*)\s*\(\s*(?:["'`]\s*[A-Za-z]+\s*["'`]\s*,\s*)?["'`](?:https?:)?\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?[^"'`]*["'`]/gi;
const COOKIE = /document\s*\.\s*cookie/i;
const CREDENTIALS = /(?:\bpass(?:word|wd)?\b|\blogin\b|\busername\b)[^;]{0,80}\.value|\.value[^;]{0,80}\b(?:pass(?:word|wd)?)\b|type\s*=\s*["']?password/i;
const HEADER = /headers\s*(?:\[\s*["'][^"']+["']\s*\]|\.[\w-]+)?\s*\[\s*["']x-[a-z-]+["']\s*\]\s*=\s*[^;]*?(?:document\s*\.\s*cookie|\.value)|headers\s*:\s*\{[^}]*?["']?x-[a-z-]+["']?\s*:[^}]*?(?:document\s*\.\s*cookie|\.value)|setRequestHeader\s*\(\s*["']x-[a-z-]+["']\s*,[^)]*?(?:document\s*\.\s*cookie|\.value)/i;
const FAKE_LOGIN = /document\s*\.\s*(?:write|body\s*\.\s*innerHTML|documentElement\s*\.\s*innerHTML)[^;]{0,400}?(?:binom|keitaro|tracker|<form|type=\\?["']password)/i;

/**
 * The stealer signals of one script and the C2 hosts it sends data to, or null unless both a path check
 * for an admin-style path and an exfiltration (cookie or credentials in a request to a host outside
 * `pageUrl`'s registrable domain) are present.
 */
export function detectStealerKit(code: string, pageUrl: string): StealerKit | null {
  const src = (code ?? "").slice(0, MAX_CHARS);
  if (!src || !PATH_CHECK.test(src)) return null;
  const own = registrableDomain(pageUrl);
  const signals = new Set<string>(["path_check"]);
  const hosts = new Set<string>();
  for (const m of src.matchAll(REQUEST)) {
    const host = m[1].toLowerCase();
    if (own && registrableDomain(`https://${host}/`) === own) continue;
    const at = m.index ?? 0;
    const win = src.slice(Math.max(0, at - BEFORE_WINDOW), at + AFTER_WINDOW);
    const cookie = COOKIE.test(win);
    const creds = CREDENTIALS.test(win);
    if (!cookie && !creds) continue;
    hosts.add(host);
    if (cookie) signals.add("exfil_cookie");
    if (creds) signals.add("exfil_credentials");
    if (HEADER.test(win)) signals.add("request_header");
  }
  if (!hosts.size) return null;
  if (FAKE_LOGIN.test(src)) signals.add("fake_login");
  return { signals: [...signals].sort(), c2Hosts: [...hosts].sort() };
}

/** Merges the results of several scripts of one page (signals and hosts united), or null when none matched. */
export function mergeStealerKits(kits: Array<StealerKit | null>): StealerKit | null {
  const found = kits.filter((k): k is StealerKit => !!k);
  if (!found.length) return null;
  return {
    signals: [...new Set(found.flatMap((k) => k.signals))].sort(),
    c2Hosts: [...new Set(found.flatMap((k) => k.c2Hosts))].sort(),
  };
}

/** Hosts of free static hosting and code hosting whose scripts are read for a stealer (third-party libraries are otherwise never fetched). */
const FOREIGN_HOSTS = /^(?:cdn\.jsdelivr\.net$|raw\.githack\.com$|cdn\.statically\.io$|[a-z0-9-]+\.(?:github\.io|pages\.dev|netlify\.app|vercel\.app|surge\.sh|web\.app|firebaseapp\.com|glitch\.me|onrender\.com)$)/i;

/**
 * Addresses of third-party script assets worth fetching for the stealer check: only free static hosts and
 * code hosting (jsDelivr only under `/gh/`, a user's repository), at most `max`. Scripts of ordinary CDNs
 * (`/npm/`, google, cloudflare) are skipped.
 */
export function foreignScriptCandidates(assets: Array<{ kind: string; url: string; host: string }>, pageUrl: string, max = 5): string[] {
  const own = registrableDomain(pageUrl);
  return assets
    .filter((a) => a.kind === "js" && registrableDomain(a.host) !== own && isStealerCandidateUrl(a.url))
    .map((a) => a.url)
    .slice(0, max);
}

/** True for a script address on free static hosting or on jsDelivr's `/gh/` (a user's repository). */
export function isStealerCandidateUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return FOREIGN_HOSTS.test(u.hostname) && (u.hostname !== "cdn.jsdelivr.net" || /^\/gh\//.test(u.pathname));
  } catch {
    return false;
  }
}
