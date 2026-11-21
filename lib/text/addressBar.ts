/**
 * Address bar of a browser in a screenshot or a screen recording.
 *
 * A phone screenshot taken after clicking an ad shows the landing domain at the top, often inside
 * an in-app browser ("owalsolid-test.example" over "Instagram"). That domain is the way from a picture
 * to the page: it becomes the landing URL when the material gives none. The address bar shows a
 * bare host without a scheme, so the generic URL extractor (which wants http(s)://) misses it.
 * Input: OCR text of the top strip of the image, line breaks kept. Pure functions.
 */
import { parse as parseHost } from "tldts";
import { normalizeUrl, registrableDomain } from "../osint/urls";

export interface AddressBarHit {
  /** https://<host>[/<path>] as read. */
  url: string;
  host: string;
  /** OCR line the host was read from. */
  line: string;
  /** In-app browser named under the address ("Instagram", "Facebook" ...). */
  inAppBrowser: string | null;
  /** A platform's own page (ad library, feed): not a landing page. */
  platform: boolean;
  /** high: an address-bar marker (lock glyph, in-app browser line); medium: a bare domain in the strip. */
  confidence: "high" | "medium";
}

const HOST = /(?:^|[\s|(«"'])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(\/[^\s|"'»)]*)?(?=$|[\s|"'»).,:;])/gi;
const IN_APP = /^(?:[^\p{L}]{0,4}|[XA×x]\s+)(Instagram|Facebook|Messenger|Threads|TikTok|LinkedIn|Wczytywanie|Loading)\b/iu;
/** OCR of a padlock: "8", "a", "@", "A" or the glyph itself before the host. */
const LOCK_BEFORE = /(?:^|\s)(?:[8a@🔒]|A|AA|NEA A)\s*$/u;
const PLATFORM_DOMAINS = new Set([
  "facebook.com", "fb.com", "fb.me", "instagram.com", "messenger.com", "threads.net", "google.com", "youtube.com",
  "tiktok.com", "x.com", "twitter.com", "linkedin.com", "apple.com", "whatsapp.com", "telegram.org", "t.me",
]);

/** Hosts read from the OCR text of the top strip of a screenshot or a video frame. */
export function parseAddressBar(text: string | null | undefined): AddressBarHit[] {
  const lines = (text ?? "").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const out: AddressBarHit[] = [];
  const seen = new Set<string>();
  lines.forEach((line, i) => {
    for (const m of line.matchAll(HOST)) {
      const host = m[1].toLowerCase().replace(/\.$/, "");
      // a real public suffix only: OCR debris like "plik.qwertyzz" or "5.5.3" is not a host
      const parsed = parseHost(host, { allowPrivateDomains: true });
      if (!parsed.domain || !(parsed.isIcann || parsed.isPrivate)) continue;
      const rd = registrableDomain(host);
      if (!rd) continue;
      const norm = normalizeUrl(`https://${host}${m[2] ?? ""}`);
      if (!norm || seen.has(norm.url)) continue;
      seen.add(norm.url);
      const below = lines[i + 1] ?? "";
      const inApp = IN_APP.exec(below)?.[1] ?? null;
      const before = line.slice(0, m.index ?? 0) + (m[0].startsWith(m[1]) ? "" : m[0].slice(0, m[0].indexOf(m[1])));
      const lock = LOCK_BEFORE.test(before);
      out.push({
        url: norm.url,
        host,
        line,
        inAppBrowser: inApp && !/^(wczytywanie|loading)$/i.test(inApp) ? inApp : null,
        platform: PLATFORM_DOMAINS.has(rd),
        confidence: inApp || lock ? "high" : "medium",
      });
    }
  });
  return out;
}
