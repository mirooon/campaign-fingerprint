/**
 * Folders collected from public sources (a scan service, a web archive, a press article), as
 * opposed to captures an analyst made in a browser. Such a folder has a `zrodlo.json` with the
 * target address and the public sources it came from, and files whose role follows from the name:
 *
 * - scan service: `urlscan_wynik.html` is the service's own result page (never the landing page),
 *   `zadania_urlscan.har` is a HAR rebuilt from the service's request list (no response bodies),
 *   `urlscan_rekord.json` is the search record (page metadata), `zrzut_urlscan.png` is the service's
 *   screenshot of the page (a page screenshot, not a screenshot of the ad);
 * - web archive: `wayback_<YYYYMMDDhhmmss>.html` is the archived page body at that time;
 * - press: `reklama_*` images show the ad, `lander_*` / `formularz_*` images show the page, the
 *   article itself is not the landing page, `rdap_dns.json` holds RDAP and DNS from the collection date.
 *
 * Label fields a collector may add to `zrodlo.json` (`rodzina`, `odcisk`, `pewnosc`, `uwagi`) are
 * never read: only `cel` and `zrodla` are taken, so labels cannot leak into the features of a material.
 * Pure functions on parsed JSON and file names; reading files stays in `caseImport.ts`.
 */
import { normalizeUrl } from "../osint/urls";

/** Name of the source file that marks a collected folder. */
export const COLLECTED_SOURCE_FILE = "zrodlo.json";

/** One public source of a collected material (kept in provenance.json, never in the features). */
export interface CollectedSource {
  url: string;
  typ: string | null;
  data_wpisu: string | null;
  data_dostepu: string | null;
}

/** Page metadata from a scan service's search record. */
export interface ScanMeta {
  ip: string | null;
  asn: string | null;
  asnName: string | null;
  server: string | null;
  tlsIssuer: string | null;
  domainAgeDays: number | null;
  title: string | null;
}

/** DNS and RDAP of a domain recorded when the material was collected. */
export interface RecordedLookups {
  domain: string;
  /** Collection time (ISO), or null. */
  at: string | null;
  ns: string[];
  a: string[];
  /** Minimal RDAP JSON (RFC 9083 shape) rebuilt from the recorded fields, so the usual parser reads it. */
  rdap: Record<string, unknown> | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Target address and public sources of a parsed `zrodlo.json`. A bare domain ("lander.example") becomes
 * "https://lander.example/"; a full address is returned as given, with its path and query (click ids,
 * `key=`, `fbclid`, `utm_*`), because many scam pages answer only on the full address. Returns a null
 * target when `cel` is missing or not an http(s) address.
 */
export function readCollectedSource(json: unknown): { target: string | null; sources: CollectedSource[] } {
  const o = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const cel = str(o.cel);
  let target: string | null = null;
  if (cel) target = /^https?:\/\//i.test(cel) ? (normalizeUrl(cel) ? cel : null) : (normalizeUrl(cel)?.url ?? null);
  const sources = (Array.isArray(o.zrodla) ? o.zrodla : [])
    .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
    .filter((s) => str(s.url))
    .map((s) => ({ url: str(s.url)!, typ: str(s.typ), data_wpisu: str(s.data_wpisu), data_dostepu: str(s.data_dostepu) }));
  return { target, sources };
}

/** Page metadata from a scan service's search record (`page.*` fields); null when the record has no page. */
export function scanMeta(json: unknown): ScanMeta | null {
  const page = (json as { page?: Record<string, unknown> } | null)?.page;
  if (!page || typeof page !== "object") return null;
  const age = page.domainAgeDays;
  return {
    ip: str(page.ip),
    asn: str(page.asn),
    asnName: str(page.asnname),
    server: str(page.server),
    tlsIssuer: str(page.tlsIssuer),
    domainAgeDays: typeof age === "number" && Number.isFinite(age) ? age : null,
    title: str(page.title),
  };
}

/**
 * Team Cymru style TXT answers for the IP of a scan record, so the offline ASN lookup gives the
 * AS the scan service saw. The prefix is left empty: the record does not give it. Null without IP or ASN.
 */
export function scanCymruAnswers(meta: ScanMeta): { origin: string; asName: string; asn: number } | null {
  const asn = Number(/^AS?(\d+)$/i.exec(meta.asn ?? "")?.[1]);
  if (!meta.ip || !Number.isInteger(asn) || asn <= 0) return null;
  return { asn, origin: `${asn} |  |  | scan |`, asName: `${asn} |  |  |  | ${meta.asnName ?? ""}`.trimEnd() };
}

/** Archive time from a web-archive file name ("wayback_20260115093000.html" -> ISO, UTC); null for other names. */
export function waybackTime(name: string): string | null {
  const m = /^wayback_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.html?$/i.exec(name);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Archived body with the archive's address rewriting undone ("/web/<time>js_/https://x/a.js" ->
 * "https://x/a.js") and its toolbar removed, so the page kit sees the original assets and two archived
 * pages do not share the archive's own scripts.
 */
export function unwrapWayback(html: string): string {
  return html
    .replace(/<!-- BEGIN WAYBACK TOOLBAR INSERT -->[\s\S]*?<!-- END WAYBACK TOOLBAR INSERT -->/g, "")
    .replace(/(?:https?:)?(?:\/\/web\.archive\.org)?\/web\/\d{14}(?:[a-z]{2}_)?\/(?=https?:)/gi, "");
}

/**
 * Role of an image in a collected folder: the ad (`reklama_*`) or the page (everything else: the scan
 * service's screenshot, `lander_*`, `formularz_*`). Only ad images get OCR of the post and the creative hash.
 */
export function collectedImageRole(name: string): "ad" | "page" {
  return /^reklama[_-]/i.test(name) ? "ad" : "page";
}

/** An HTML file of a collected folder that is the landing page itself (only web-archive copies are). */
export function isCollectedPage(name: string): boolean {
  return waybackTime(name) !== null;
}

/**
 * DNS and RDAP recorded at collection time (`rdap_dns.json`: `domena`, `dostep`, `utworzona`, `wygasa`,
 * `zmiana`, `rejestrator`, `status`, `ns`/`ns_rdap`, `a`). These take precedence over a lookup made
 * later, when the domain may already be suspended or moved. Null without a domain.
 */
export function recordedLookups(json: unknown): RecordedLookups | null {
  const o = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const domain = str(o.domena)?.toLowerCase();
  if (!domain) return null;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter((x): x is string => !!x) : []);
  const host = (h: string) => h.toLowerCase().replace(/\.$/, "");
  const ns = [...new Set([...list(o.ns), ...list(o.ns_rdap)].map(host))].sort();
  const events = [
    ["registration", str(o.utworzona)],
    ["expiration", str(o.wygasa)],
    ["last changed", str(o.zmiana)],
  ]
    .filter(([, d]) => d)
    .map(([eventAction, eventDate]) => ({ eventAction, eventDate }));
  const registrar = list(o.rejestrator)[0] ?? null;
  const iana = registrar ? /IANA:?\s*(\d+)/i.exec(registrar)?.[1] : undefined;
  const rdap =
    events.length || registrar || ns.length
      ? {
          objectClassName: "domain",
          ldhName: domain,
          events,
          status: list(o.status),
          nameservers: ns.map((ldhName) => ({ objectClassName: "nameserver", ldhName })),
          entities: registrar
            ? [
                {
                  objectClassName: "entity",
                  roles: ["registrar"],
                  vcardArray: ["vcard", [["fn", {}, "text", registrar.replace(/\s*IANA:?\s*\d+\s*$/i, "")]]],
                  ...(iana ? { publicIds: [{ type: "IANA Registrar ID", identifier: iana }] } : {}),
                },
              ]
            : [],
        }
      : null;
  return { domain, at: str(o.dostep), ns, a: list(o.a), rdap };
}
