/**
 * Domain shown in the creative against the page the ad leads to (I28, B-354). A sponsored post under a
 * picture prints a link caption ("ONET.PL"), a search ad prints "www.<brand>.pl", an ad text may name a
 * domain; the click goes elsewhere. The caption borrows the trust of the shown site. An attribute of the
 * material for the reviewer, never a link between materials. Pure function: the OCR text, the ad text,
 * the domains read from the address bar and the domains of the redirect chain come from the caller.
 */
import { TEXT_CONFIG } from "../osint/textConfig";
import { registrableDomain } from "../osint/urls";
import { PLATFORM_DOMAINS, parseAddressBar } from "./addressBar";

export interface DisplayedDomainMismatch {
  /** Registrable domain shown in the creative. */
  displayed: string;
  /** Registrable domain of the page the ad leads to (the end of the redirect chain). */
  landing: string;
  /** Where the shown domain was read: the OCR of the screenshot or the ad's own text. */
  source: "ocr" | "text";
  /** high: the domain is a known brand or stands alone on its line (a link caption); medium: it sits in running text. */
  confidence: "high" | "medium";
  /** The shown domain belongs to a known brand (bank, portal, marketplace): set only when true. */
  displayedBrandDomain?: true;
}

export interface DisplayedDomainInput {
  /** OCR text of the creative (interface chrome may be left in; platforms' own domains are ignored). */
  ocr: string | null;
  /** The text of the ad and its other text fields. */
  text: string | null;
  /** Registrable domains read from the browser address bar of a screenshot: that is the landing page, not a caption. */
  barDomains: string[];
  /** Registrable domains of the redirect chain in order, the final page last; empty when the landing page is unknown. */
  landing: string[];
}

/** A domain of the text that may be a link caption: its registrable domain, whether it is alone on its line, in order of appearance. */
function captions(text: string | null): Array<{ domain: string; alone: boolean }> {
  const out: Array<{ domain: string; alone: boolean }> = [];
  for (const hit of parseAddressBar(text)) {
    const domain = registrableDomain(hit.host);
    if (!domain || out.some((o) => o.domain === domain)) continue;
    // a caption is the bare host, possibly with "www." and a path: nothing else on its line
    const alone = hit.line.replace(/^\W+/, "").toLowerCase().replace(/^www\./, "").startsWith(hit.host.replace(/^www\./, ""));
    out.push({ domain, alone: alone && hit.line.length <= hit.host.length + TEXT_CONFIG.displayedDomain.captionSlackChars });
  }
  return out;
}

/**
 * The first domain shown in the creative that is neither the landing page nor on the chain to it, or null.
 * Brand domains win over other captions, the OCR over the text. Platforms' own domains and short-link hosts
 * are not captions. Null as well when the landing page is unknown (nothing to compare with).
 */
export function displayedDomainMismatch(input: DisplayedDomainInput): DisplayedDomainMismatch | null {
  const final = input.landing[input.landing.length - 1];
  if (!final) return null;
  const cfg = TEXT_CONFIG.displayedDomain;
  const brands = new Set<string>(cfg.brandDomains);
  const skip = new Set<string>([...cfg.ignoredDomains, ...PLATFORM_DOMAINS, ...input.landing, ...input.barDomains]);
  const found = (["ocr", "text"] as const).flatMap((source) =>
    captions(input[source])
      .filter((c) => !skip.has(c.domain))
      .map((c) => ({ ...c, source, brand: brands.has(c.domain) })),
  );
  const pick = found.find((f) => f.brand) ?? found[0];
  if (!pick) return null;
  return {
    displayed: pick.domain,
    landing: final,
    source: pick.source,
    confidence: pick.brand || pick.alone ? "high" : "medium",
    ...(pick.brand ? { displayedBrandDomain: true as const } : {}),
  };
}
