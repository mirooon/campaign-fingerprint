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

const NO_PLATFORM = "unknown-platform";
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
    ...libraryLinks.map((u) => `ad library: ${u}${ad.ad_ids.ad_library_id ? ` (library ID ${ad.ad_ids.ad_library_id})` : ""}`),
    ...(ad.advertiser_displayed || pages.length ? [`advertiser page: ${[ad.advertiser_displayed ? `“${ad.advertiser_displayed}”` : null, ...pages.map(pageUrl)].filter(Boolean).join(", ")}`] : []),
    ...posts.map((u) => `address of the ad or post: ${u}`),
  ];
  return `- ad ${ad.item_id} (ID ${ad.ad_ids.ad_id ?? ad.item_id}, first seen ${ad.first_seen_utc ?? "?"})${parts.length ? `:\n${parts.map((p) => `  - ${p}`).join("\n")}` : ": no link to the ad on the platform, attach a screenshot and the date"}`;
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
    `In the period ${formatRange(dates[0] ?? null, dates.at(-1) ?? null)} (UTC), ${ads.length} ${ads.length === 1 ? "ad was" : "ads were"} recorded on ${platform}, leading to the domains: ${landingDomains.join(", ") || "none"}.`,
    input.financialOffer ? "The ads offer financial services (investments or crypto) and bear the marks of fraud: the promise of profit leads to a page that collects data or payments." : "The ads bear the marks of fraud: they lead to pages that collect data or payments from people who clicked them.",
    ...(input.personas.length ? [`The ads use the image or name of: ${input.personas.join(", ")}; this person's consent has not been established, so the impersonation serves to make the offer credible.`] : []),
    ...(input.deepfake ? ["The sample has a model score indicating synthetic content (a hint, not proof)."] : []),
    ...known.map((d) => `Domain ${d.domain}: registered ${formatUtc(d.created_utc)}; ${d.cert_status === "active" ? `on the CERT Warning List since ${formatUtc(d.cert_insert_date)}` : d.cert_status === "unchecked" ? "status on the CERT Warning List not checked" : "not on the CERT Warning List"}.`),
    "Draft put together from the facts of the evidence pack; for a human to verify before sending.",
  ];
  return sentences.join(" ");
}

/** One notice for the ads of a single platform. */
function renderOne(input: DsaInput, platform: string, ads: DsaAd[]): string {
  const domains = [...new Set(ads.flatMap(landingOf).map((u) => registrableDomain(u)).filter((d): d is string => !!d))].sort();
  const category = input.personas.length
    ? `impersonation of a person (${input.personas.join(", ")}): image used in the ad without consent, for fraud`
    : "fraud: ad for a fake offer";
  return `# Notice of illegal content (Art. 16(2) DSA) — ${platform} — TEMPLATE

Notice category: ${category}

> Generated from the evidence pack \`${input.packageId}\` (campaign ${input.campaignId}, ${input.createdUtc}).
> Before sending, a human verifies the content and decides whether to report. This file covers only the ads on ${platform}. Send precise notices: mass and imprecise ones may lead to their handling being suspended (Art. 23(2) DSA).

## (a) Explanation of why the content is illegal

${justification(input, platform, ads, domains)}

Proposed legal bases (to verify): ${input.legalCandidates.join("; ")}.

## (b) Exact electronic location (URL)

### Location of the ad on the platform

${ads.map(platformLocation).join("\n")}

### Landing pages (per ad)

${ads.map((a) => `- ad ${a.item_id}:\n${landingOf(a).map((u) => `  - ${u}`).join("\n") || "  - no landing URL"}`).join("\n")}

## (c) Submitter

- Full name / name: ${input.submitter.name}
- E-mail: ${input.submitter.email}

## (d) Statement of good faith

${input.goodFaith}
`;
}

/** One notice per platform of the ads, in the order platforms first appear; file `dsa-art16-<platform>.md`. */
export function renderDsaNotices(input: DsaInput): DsaNotice[] {
  const byPlatform = new Map<string, { label: string; ads: DsaAd[] }>();
  for (const ad of input.ads) {
    const slug = platformSlug(ad.platform);
    const cur = byPlatform.get(slug) ?? { label: ad.platform ?? "unknown platform", ads: [] };
    cur.ads.push(ad);
    byPlatform.set(slug, cur);
  }
  return [...byPlatform.entries()].map(([slug, { label, ads }]) => ({ platform: label, file: `dsa-art16-${slug}.md`, content: renderOne(input, label, ads) }));
}

/** Cover note `dsa-art16-notice.md`: which file goes to which platform and how to file them. */
export function renderDsaIndex(input: DsaInput, notices: DsaNotice[]): string {
  return `# Art. 16 DSA notices — campaign ${input.campaignId}

Pack \`${input.packageId}\`, ${input.createdUtc}. Each platform gets a separate notice, only about its own ads (do not mix services in one notice):

${notices.map((n) => `- \`${n.file}\` — ${n.platform}`).join("\n") || "- no ads"}

In point (b) of each notice the location of the ad on the platform comes first (ad library link, ID, advertiser page), then the landing pages per ad. A human verifies the content before sending; the tool sends nothing.
`;
}
