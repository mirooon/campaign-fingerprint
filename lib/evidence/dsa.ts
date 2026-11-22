/**
 * Notices under Art. 16(2) DSA, one per platform. A notice that mixes Facebook, Instagram, YouTube
 * and TikTok ads cannot be filed anywhere (each platform has its own form and receives only its
 * own content), and Art. 23(2) DSA lets a platform suspend processing of imprecise notices. So each
 * file names, in point (b), first where the ad sits on that platform (library link, ad ID,
 * advertiser page, post address) and only then the landing pages, per ad and without copies that
 * differ by tracking parameters. Pure functions over the ad records of the pack; the human checks and files them.
 */
import { normalizeUrl, registrableDomain } from "../osint/urls";
import { pageUrl } from "./adRecords";
import type { FactDomain } from "./facts";
import { formatRange, formatUtc } from "./format";

/** The part of an ad record of the pack that a notice needs. */
export interface DsaAd {
  item_id: string;
  platform: string | null;
  ad_urls: string[];
  ad_ids: Record<string, string>;
  advertiser_displayed: string | null;
  first_seen_utc: string | null;
  landing_url: string | null;
  landing_chain: Array<{ url: string }>;
  repository_record: Array<{ page_id: string | null }> | null;
}

export interface DsaInput {
  campaignId: string;
  packageId: string;
  createdUtc: string;
  ads: DsaAd[];
  submitter: { name: string | null; email: string | null };
  legalCandidates: string[];
  /** Impersonated persons named in the campaign; empty when none. */
  personas: string[];
  /** The ads offer a financial service (investment, crypto): added to the justification only then. */
  financialOffer: boolean;
  /** A synthetic-media score is present: added to the justification only then. */
  deepfake: boolean;
  /** Domains of the campaign with their age and CERT list status, for the sentences of the justification. */
  domains: Array<Pick<FactDomain, "domain" | "created_utc" | "cert_status" | "cert_insert_date">>;
  goodFaith: string;
}

export interface DsaNotice {
  platform: string;
  file: string;
  content: string;
}

const NO_PLATFORM = "nieznana-platforma";
const LIBRARY_LINK = /\/ads\/library\//i;

/** File-safe, lower-case name of a platform ("YouTube Shorts" → "youtube-shorts"); a fixed name when the platform is unknown. */
export function platformSlug(platform: string | null): string {
  const slug = (platform ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || NO_PLATFORM;
}

/** URLs without copies that differ only by tracking parameters (fbclid, utm_*); the first address as seen is kept. */
export function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const key = normalizeUrl(u)?.url ?? u;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

/** Landing pages of one ad: the redirect chain and the final address, without tracking-only copies. */
function landingOf(ad: DsaAd): string[] {
  return dedupeUrls([...(ad.landing_url ? [ad.landing_url] : []), ...ad.landing_chain.map((h) => h.url)]);
}

/** Location of the ad on the platform (point b, first part): library link and ID, advertiser page, post address. */
function platformLocation(ad: DsaAd): string {
  const libraryLinks = ad.ad_urls.filter((u) => LIBRARY_LINK.test(u));
  const posts = ad.ad_urls.filter((u) => !LIBRARY_LINK.test(u));
  const pages = [...new Set((ad.repository_record ?? []).map((r) => r.page_id).filter((p): p is string => !!p))];
  const parts = [
    ...libraryLinks.map((u) => `biblioteka reklam: ${u}${ad.ad_ids.ad_library_id ? ` (identyfikator biblioteki ${ad.ad_ids.ad_library_id})` : ""}`),
    ...(ad.advertiser_displayed || pages.length ? [`strona reklamodawcy: ${[ad.advertiser_displayed ? `„${ad.advertiser_displayed}”` : null, ...pages.map(pageUrl)].filter(Boolean).join(", ")}`] : []),
    ...posts.map((u) => `adres reklamy lub posta: ${u}`),
  ];
  return `- reklama ${ad.item_id} (identyfikator ${ad.ad_ids.ad_id ?? ad.item_id}, pierwsza obserwacja ${ad.first_seen_utc ?? "?"})${parts.length ? `:\n${parts.map((p) => `  - ${p}`).join("\n")}` : ": brak linku do reklamy na platformie, dołącz zrzut ekranu i datę"}`;
}

/**
 * Draft of point (a) put together from the facts of the pack: what the ads promise, whom they
 * impersonate, how many domains they lead to and how fresh those are, and the CERT list status.
 * Every sentence appears only when the facts back it (an investment offer and a synthetic-media
 * score are named only when flagged), because a moderator rejects claims the notice cannot support.
 * It stays a draft for a human to check; the legal bases come from `legalCandidates`.
 */
function justification(input: DsaInput, platform: string, ads: DsaAd[], landingDomains: string[]): string {
  const dates = ads.map((a) => a.first_seen_utc).filter((d): d is string => !!d).sort();
  const known = input.domains.filter((d) => landingDomains.includes(d.domain));
  const sentences = [
    `W okresie ${formatRange(dates[0] ?? null, dates.at(-1) ?? null)} (UTC) zarejestrowano ${ads.length} ${ads.length === 1 ? "reklamę" : "reklam(y)"} w serwisie ${platform}, kierujących do domen: ${landingDomains.join(", ") || "brak"}.`,
    input.financialOffer ? "Reklamy oferują usługi finansowe (inwestycje lub kryptowaluty) i mają cechy oszustwa: obietnica zysku prowadzi na stronę zbierającą dane lub wpłaty." : "Reklamy mają cechy oszustwa: prowadzą na strony zbierające dane lub wpłaty od osób, które w nie kliknęły.",
    ...(input.personas.length ? [`W reklamach użyto wizerunku lub nazwiska: ${input.personas.join(", ")}; zgody tej osoby nie ustalono, więc podszywanie się służy uwiarygodnieniu oferty.`] : []),
    ...(input.deepfake ? ["Materiał ma wynik modelu wskazujący na treść syntetyczną (wskazówka, nie dowód)."] : []),
    ...known.map((d) => `Domena ${d.domain}: zarejestrowana ${formatUtc(d.created_utc)}; ${d.cert_status === "active" ? `na Liście Ostrzeżeń CERT od ${formatUtc(d.cert_insert_date)}` : d.cert_status === "unchecked" ? "status na Liście Ostrzeżeń CERT niesprawdzony" : "nie ma jej na Liście Ostrzeżeń CERT"}.`),
    "Szkic złożony z faktów paczki dowodów; do weryfikacji przez człowieka przed wysłaniem.",
  ];
  return sentences.join(" ");
}

/** One notice for the ads of a single platform. */
function renderOne(input: DsaInput, platform: string, ads: DsaAd[]): string {
  const domains = [...new Set(ads.flatMap(landingOf).map((u) => registrableDomain(u)).filter((d): d is string => !!d))].sort();
  const category = input.personas.length
    ? `podszywanie się pod osobę (${input.personas.join(", ")}): wizerunek użyty w reklamie bez zgody, w celu oszustwa`
    : "oszustwo: reklama fałszywej oferty";
  return `# Zgłoszenie nielegalnych treści (art. 16 ust. 2 DSA) — ${platform} — SZABLON

Kategoria zgłoszenia: ${category}

> Wygenerowano z paczki dowodów \`${input.packageId}\` (kampania ${input.campaignId}, ${input.createdUtc}).
> Przed wysłaniem człowiek weryfikuje treść i decyduje o zgłoszeniu. Ten plik dotyczy tylko reklam w serwisie ${platform}. Wysyłaj precyzyjne zgłoszenia: masowe i nieprecyzyjne mogą skutkować zawieszeniem ich rozpatrywania (art. 23 ust. 2 DSA).

## (a) Wyjaśnienie, dlaczego treść jest nielegalna

${justification(input, platform, ads, domains)}

Proponowane podstawy prawne (do weryfikacji): ${input.legalCandidates.join("; ")}.

## (b) Dokładna lokalizacja elektroniczna (URL)

### Lokalizacja reklamy na platformie

${ads.map(platformLocation).join("\n")}

### Strony docelowe (per reklama)

${ads.map((a) => `- reklama ${a.item_id}:\n${landingOf(a).map((u) => `  - ${u}`).join("\n") || "  - brak adresu docelowego"}`).join("\n")}

## (c) Zgłaszający

- Imię i nazwisko / nazwa: ${input.submitter.name}
- E-mail: ${input.submitter.email}

## (d) Oświadczenie o dobrej wierze

${input.goodFaith}
`;
}

/** One notice per platform of the ads, in the order platforms first appear; file `dsa-art16-<platform>.md`. */
export function renderDsaNotices(input: DsaInput): DsaNotice[] {
  const byPlatform = new Map<string, { label: string; ads: DsaAd[] }>();
  for (const ad of input.ads) {
    const slug = platformSlug(ad.platform);
    const cur = byPlatform.get(slug) ?? { label: ad.platform ?? "nieznana platforma", ads: [] };
    cur.ads.push(ad);
    byPlatform.set(slug, cur);
  }
  return [...byPlatform.entries()].map(([slug, { label, ads }]) => ({ platform: label, file: `dsa-art16-${slug}.md`, content: renderOne(input, label, ads) }));
}

/** Cover note `dsa-art16-notice.md`: which file goes to which platform and how to file them. */
export function renderDsaIndex(input: DsaInput, notices: DsaNotice[]): string {
  return `# Zgłoszenia art. 16 DSA — kampania ${input.campaignId}

Paczka \`${input.packageId}\`, ${input.createdUtc}. Każda platforma dostaje osobne zgłoszenie, tylko o swoich reklamach (nie mieszaj serwisów w jednym zgłoszeniu):

${notices.map((n) => `- \`${n.file}\` — ${n.platform}`).join("\n") || "- brak reklam"}

W punkcie (b) każdego zgłoszenia najpierw stoi lokalizacja reklamy na platformie (link do biblioteki reklam, identyfikator, strona reklamodawcy), potem strony docelowe per reklama. Człowiek weryfikuje treść przed wysłaniem; narzędzie niczego nie wysyła.
`;
}
