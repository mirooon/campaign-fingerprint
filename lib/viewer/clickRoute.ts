/**
 * Click route of a material (B-021): the chain ad → tracking link → redirects → lure page → form or shop,
 * one link per address with its role in plain words, the HTTP/network status, the age of its domain against
 * the ad and the cloaking warning. Pure functions over the enriched data of one material; reading
 * `enriched.json` stays in the API route.
 */
import { registrableDomain } from "@/lib/osint/urls";
import type { EnrichedDataset } from "@/lib/pipeline/types";
import { domainAgeNote } from "./fields";

/** A registration at most this many days before the ad counts as "fresh" (the domain was bought for the campaign). */
export const RECENT_DOMAIN_DAYS = 30;

export type RouteRole = "ad" | "tracking" | "redirect" | "lure" | "form" | "shop";
export type RouteStatus = "start" | "redirected" | "ok" | "no_response" | "blocked" | "error" | "not_checked";

export const ROUTE_ROLE_LABEL: Record<RouteRole, string> = {
  ad: "reklama",
  tracking: "link śledzący",
  redirect: "przekierowanie",
  lure: "strona-przynęta",
  form: "formularz zbierający dane",
  shop: "sklep",
};

export interface RouteLink {
  step: number;
  role: RouteRole;
  roleLabel: string;
  /** Address of the link (the GUI shows it defanged); null for the ad itself. */
  url: string | null;
  status: RouteStatus;
  /** "przekierował (HTTP 302)", "odpowiada (HTTP 200)", "nie odpowiada (przekroczony czas)", "zablokowany" … */
  statusLabel: string;
  /** "domena zarejestrowana 2 dni przed emisją"; null without an RDAP date. */
  domainNote: string | null;
  /** The domain was registered 0–`RECENT_DOMAIN_DAYS` days before the ad. */
  fresh: boolean;
  /** Cloaking or anti-bot warning (final link only); null otherwise. */
  warning: string | null;
}

/** What the route needs to know about one material, independent of the enriched file's layout. */
export interface RouteSource {
  /** First appearance of the ad (ISO): the moment domain ages are measured against. */
  firstSeen: string | null;
  /** Address the ad leads to, as given with the material; null when there is none. */
  landingUrl: string | null;
  /** The fetch of that address: chain of hops, final address and outcome; null when the page was not fetched. */
  page: {
    requestedUrl: string;
    finalUrl: string;
    status: number | null;
    errorCode: string | null;
    redirectChain: Array<{ url: string; status: number; kind: "http" | "meta-refresh" }>;
  } | null;
  cloaking: { suspected: boolean; state?: "checked" | "bot_challenge" } | null;
  /** Registration date (ISO) of a registrable domain, null when RDAP gave none. */
  domainCreated: (domain: string) => string | null;
  /** What the final page is: it sends form data to a backend ("form"), runs on a shop platform ("shop"), or neither. */
  finalKind: "form" | "shop" | null;
}

const ERROR_LABEL: Record<string, string> = {
  timeout: "nie odpowiada (przekroczony czas)",
  network: "nie odpowiada (błąd sieci)",
  "invalid-url": "nie odpowiada (adres niepoprawny)",
  "too-many-redirects": "za dużo przekierowań",
  tls: "błąd certyfikatu TLS",
  blocked: "zablokowany",
};

/** Status of the last link: the outcome of the fetch in words. */
function finalStatus(page: RouteSource["page"]): { status: RouteStatus; label: string } {
  if (!page) return { status: "not_checked", label: "nie sprawdzono (strona nie została pobrana)" };
  if (page.errorCode) return { status: page.errorCode === "blocked" ? "blocked" : page.errorCode === "tls" || page.errorCode === "too-many-redirects" ? "error" : "no_response", label: ERROR_LABEL[page.errorCode] ?? `błąd (${page.errorCode})` };
  if (page.status !== null && page.status >= 400) return { status: "error", label: `odpowiada błędem HTTP ${page.status}` };
  return { status: "ok", label: `odpowiada (HTTP ${page.status ?? "?"})` };
}

/** Warning for the final link: suspected cloaking, or anti-bot protection that made the check impossible. */
function cloakingWarning(c: RouteSource["cloaking"]): string | null {
  if (!c) return null;
  if (c.state === "bot_challenge") return "Ochrona przed botami zablokowała pobranie, więc nie da się ocenić, czy strona wygląda inaczej dla robota (cloaking).";
  return c.suspected ? "Ostrzeżenie: strona wygląda inaczej dla robota i dla przeglądarki mobilnej (cloaking), więc zapis może nie pokazywać tego, co widzi ofiara." : null;
}

/**
 * The route of one material as a list of links: the ad first, then every address of the chain. The first
 * address that redirects is the tracking link, further hops are redirects, and the last one is the lure
 * page (or a form or a shop when the page is one). Age of each link's domain is measured against the ad.
 */
export function clickRoute(src: RouteSource): RouteLink[] {
  const hops = src.page?.redirectChain ?? [];
  const end = src.page?.finalUrl ?? src.landingUrl;
  const age = (url: string | null) => {
    const domain = url ? registrableDomain(url) : null;
    const created = domain ? src.domainCreated(domain) : null;
    const days = created && src.firstSeen ? Math.floor((Date.parse(src.firstSeen) - Date.parse(created)) / 86_400_000) : null;
    return { note: domainAgeNote(days, "domain"), fresh: days !== null && days >= 0 && days <= RECENT_DOMAIN_DAYS };
  };
  const link = (role: RouteRole, url: string | null, status: RouteStatus, statusLabel: string, warning: string | null = null): RouteLink => {
    const a = age(url);
    return { step: 0, role, roleLabel: ROUTE_ROLE_LABEL[role], url, status, statusLabel, domainNote: a.note, fresh: a.fresh, warning };
  };
  const links: RouteLink[] = [link("ad", null, "start", "kliknięcie w reklamę")];
  hops.forEach((h, i) => links.push(link(i === 0 ? "tracking" : "redirect", h.url, "redirected", `przekierował (${h.kind === "meta-refresh" ? "meta refresh" : `HTTP ${h.status}`})`)));
  if (end) {
    const s = finalStatus(src.page);
    links.push(link(src.finalKind ?? "lure", end, s.status, s.label, cloakingWarning(src.cloaking)));
  }
  return links.map((l, i) => ({ ...l, step: i }));
}

/** Route data of one material from the enriched dataset; null when the material is unknown. A form is a page whose kit names a backend it sends to; a shop is a page on a shop platform. */
export function routeSourceOf(ds: Pick<EnrichedDataset, "items" | "perItem" | "pages" | "domains">, itemId: string): RouteSource | null {
  const item = ds.items.find((i) => i.id === itemId);
  const enr = ds.perItem[itemId];
  if (!item || !enr) return null;
  const page = enr.pageKey ? ds.pages[enr.pageKey] : undefined;
  const finalKind = page?.kit?.endpoints?.length ? "form" : page?.extract?.cms?.length ? "shop" : null;
  return {
    firstSeen: item.firstSeen,
    landingUrl: enr.landing?.url ?? null,
    page: page ? { requestedUrl: page.fetch.requestedUrl, finalUrl: page.fetch.finalUrl, status: page.fetch.status, errorCode: page.fetch.errorCode, redirectChain: page.fetch.redirectChain } : null,
    cloaking: page?.cloaking ? { suspected: page.cloaking.suspected, state: page.cloaking.state } : null,
    domainCreated: (domain) => ds.domains[domain]?.rdap?.created ?? null,
    finalKind,
  };
}
