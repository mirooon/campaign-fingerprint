/**
 * Keys of the CRM or lead API written into a landing page (I23). The form sends the lead straight to the
 * CRM of the operator or of its affiliate network, and the request carries the account's key or token:
 * in a config object of a script, in a header of fetch / XMLHttpRequest / $.ajax, or in a hidden field.
 * One secret key belongs to one account, so two sites with the same key send leads to one buyer.
 *
 * The key itself is never kept: only its SHA-256 (the pivot) and a preview of the first and last
 * characters for the reader. Static analysis of the saved page only, no request is ever sent.
 * Pure functions, no network access.
 */
import { createHash } from "node:crypto";
import { scanTags, splitHtml } from "./extract";
import { LEAD_CONFIG } from "./leadConfig";

export interface CrmKey {
  /** SHA-256 (hex) of the key: the identity used as the pivot. */
  sha256: string;
  /** First and last characters of the key around "…" (LEAD_CONFIG.crmKey.previewChars each). */
  preview: string;
  /** Name of the field or header the key was found under, as written. */
  name: string;
  /** Where: a script config object, a request header, or a hidden form field. */
  via: "script" | "header" | "form";
}

const VALUE = "([A-Za-z0-9_.+/=-]{8,400})";
const ASSIGN_RE = new RegExp(`(?<![\\w$])["']?([A-Za-z_][\\w-]{1,40})["']?\\s*[:=]\\s*(["'\`])${VALUE}\\2`, "g");
const SET_HEADER_RE = new RegExp(`setRequestHeader\\(\\s*(["'\`])([\\w-]{2,40})\\1\\s*,\\s*(["'\`])(?:Bearer\\s+|Token\\s+)?${VALUE}\\3`, "gi");
const AUTH_HEADER_RE = new RegExp(`["']?(Authorization)["']?\\s*:\\s*(["'\`])(?:Bearer|Token)\\s+${VALUE}\\2`, "gi");

/** Field name in the form compared with LEAD_CONFIG.crmKey.names: lower case, "-" and "_" removed. */
function squash(name: string): string {
  return name.toLowerCase().replace(/[-_]/g, "");
}

/** Shannon entropy of a string in bits per character (0 for an empty string). */
function entropyBits(s: string): number {
  if (!s) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * True when `value` found under `name` looks like the secret key of one account: a key name from the
 * config, not a CSRF or public-widget name, long enough, random enough, and not a known public key.
 * Macros ({{API_KEY}}, ${…}) never match VALUE's character set, so they fail here too.
 */
function isAccountKey(name: string, value: string): boolean {
  const cfg = LEAD_CONFIG.crmKey;
  if ((cfg.excludedNames as readonly string[]).includes(name.toLowerCase())) return false;
  if (!(cfg.names as readonly string[]).includes(squash(name))) return false;
  if (value.length < cfg.minLength || value.length > cfg.maxLength) return false;
  if (cfg.excludedValues.some((re) => re.test(value))) return false;
  return entropyBits(value) >= cfg.minEntropyBits;
}

/** The stored form of a key: hash and preview, never the key. */
function toCrmKey(value: string, name: string, via: CrmKey["via"]): CrmKey {
  const n = LEAD_CONFIG.crmKey.previewChars;
  return { sha256: createHash("sha256").update(value).digest("hex"), preview: `${value.slice(0, n)}…${value.slice(-n)}`, name, via };
}

/**
 * Finds the CRM / lead API keys of a page: `{ apiKey: "…" }`-style assignments and request headers in its
 * inline scripts (x-api-key, Authorization: Bearer …, setRequestHeader) and hidden form fields named like
 * a key. Returns them deduplicated by hash, in document order (hidden fields first). An empty array when
 * the page holds none.
 */
export function findCrmKeys(html: string): CrmKey[] {
  if (!html) return [];
  const out: CrmKey[] = [];
  const seen = new Set<string>();
  // a Bearer token is the key of whoever calls the API, so "Authorization" is checked as "token"
  const push = (value: string, name: string, via: CrmKey["via"]) => {
    if (!isAccountKey(/^authorization$/i.test(name) ? "token" : name, value)) return;
    const key = toCrmKey(value, name, via);
    if (seen.has(key.sha256)) return;
    seen.add(key.sha256);
    out.push(key);
  };
  for (const tag of scanTags(html)) {
    if (tag.name === "input" && (tag.attrs.type ?? "").toLowerCase() === "hidden" && tag.attrs.name && tag.attrs.value) {
      push(tag.attrs.value.trim(), tag.attrs.name.trim(), "form");
    }
  }
  for (const script of splitHtml(html).scripts) {
    for (const m of script.matchAll(SET_HEADER_RE)) push(m[4], m[2], "header");
    for (const m of script.matchAll(AUTH_HEADER_RE)) push(m[3], m[1], "header");
    for (const m of script.matchAll(ASSIGN_RE)) push(m[3], m[1], /^x-/i.test(m[1]) ? "header" : "script");
  }
  return out;
}
