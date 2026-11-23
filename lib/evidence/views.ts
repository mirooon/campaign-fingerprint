/**
 * Views of one campaign record for the institutions that act on it: the data-preservation request
 * to providers (E), the notice to the financial supervisor (K) and the notice to the prosecutor (P).
 * All three are drafted from the same facts as evidence.json (lib/evidence/facts.ts), so they cannot
 * disagree with it; a human checks and files them, the tool sends nothing. Pure functions.
 */
import type { CampaignFacts, FactDomain } from "./facts";
import { formatRange, formatUtc } from "./format";

const SIGNATURE = "Draft prepared automatically from the evidence pack; for a human to verify and sign.";

/** Domains that name an operator: shared infrastructure (CDN, large host) is left out because its provider holds data about thousands of unrelated sites. */
const operatorDomains = (f: CampaignFacts): FactDomain[] => f.domains.filter((d) => !d.shared_infrastructure);

/** Platforms of the ads of a campaign with the time range of the ads on each, in the order they first appear. */
function platformRanges(f: CampaignFacts): Array<{ platform: string; from: string | null; to: string | null; ids: string[] }> {
  const by = new Map<string, { platform: string; from: string | null; to: string | null; ids: string[] }>();
  for (const a of f.ads) {
    const key = (a.platform ?? "unknown platform").toLowerCase();
    const cur = by.get(key) ?? { platform: a.platform ?? "unknown platform", from: null, to: null, ids: [] };
    const first = a.first_seen_utc;
    const last = a.last_seen_utc ?? a.first_seen_utc;
    if (first && (!cur.from || first < cur.from)) cur.from = first;
    if (last && (!cur.to || last > cur.to)) cur.to = last;
    cur.ids.push(a.ad_ids.ad_library_id ?? a.ad_ids.ad_id ?? a.item_id);
    by.set(key, cur);
  }
  return [...by.values()];
}

/** Sentence on the CERT Warning List status of a domain, for documents addressed to people. */
function certSentence(d: FactDomain): string {
  if (d.cert_status === "active") return `on the CERT Warning List since ${formatUtc(d.cert_insert_date)}`;
  if (d.cert_status === "removed") return "was on the CERT Warning List (the entry expired)";
  if (d.cert_status === "absent") return "not on the CERT Warning List (per the local copy)";
  return "status on the CERT Warning List not checked";
}

/**
 * Request to preserve data (Art. 218a of the Code of Criminal Procedure / e-evidence style) addressed to the providers: per
 * platform the ads and the time range to preserve, per domain the registrar and hosting with the
 * contact, and the categories of data to keep. The ranges are the times the ads and pages were
 * observed, in UTC; the provider decides what it holds.
 */
export function renderPreservationRequest(f: CampaignFacts): string {
  const platforms = platformRanges(f);
  const domains = operatorDomains(f);
  return `# Request to preserve data — campaign ${f.campaignId}

Pack \`${f.packageId}\`, ${formatUtc(f.createdUtc)}. ${SIGNATURE}

Request to keep the data (without disclosing it until a competent authority decides) concerning the ads and domains described in the pack.

## Ad platforms

${platforms.map((p) => `- **${p.platform}**: ads ${p.ids.join(", ")}; period to preserve ${formatRange(p.from, p.to)} (UTC); categories of data: advertiser account data and its changes, payer data and payment methods, history of ad delivery and edits, reach data, logins and IP addresses of the account administrators, earlier reports and moderation decisions.`).join("\n") || "- no ads"}

## Domains: registrars and hosting

${domains
  .map(
    (d) =>
      `- **${d.domain}** (registered ${formatUtc(d.created_utc)}; ads in the campaign: ${d.ads})\n  - registrar: ${d.registrar ?? "not established"}${d.registrar_iana_id ? ` (IANA ${d.registrar_iana_id})` : ""}, abuse contact: ${d.abuse_email ?? "not in RDAP"}; categories of data: registrant and contact data, history of changes, payments for the domain and services, panel logs\n  - hosting: ${d.ips.map((i) => `${i.ip}${i.asn ? ` (AS${i.asn}${i.as_name ? `, ${i.as_name}` : ""})` : ""}`).join(", ") || "no data"}; categories of data: subscriber data, access and panel logs, copies of the content, payments; period ${formatRange(f.firstSeenUtc, f.lastSeenUtc)} (UTC)`,
  )
  .join("\n") || "- no domains"}

Domains on shared infrastructure (CDNs and large providers) are left out: their provider serves thousands of independent sites and does not point to the operator of the campaign.

## Time range

First seen ${formatUtc(f.firstSeenUtc)}, last seen ${formatUtc(f.lastSeenUtc)} (UTC). The data is needed for the period from the first observation to the date of the request.
`;
}

/**
 * Notice to the financial supervisor (KNF): the brands and persons used, the domains with the date of
 * registration, the offer, payment identifiers and the scale. Null when the ads hold no financial
 * offer, because the supervisor has no remit over other frauds.
 */
export function renderKnfNotice(f: CampaignFacts): string | null {
  if (!f.financialOffer) return null;
  const domains = operatorDomains(f);
  const payments = [...new Set(domains.flatMap((d) => d.payment_identifiers))];
  return `# Information for KNF — campaign ${f.campaignId}

Pack \`${f.packageId}\`, ${formatUtc(f.createdUtc)}. ${SIGNATURE}

In the period ${formatRange(f.firstSeenUtc, f.lastSeenUtc)} (UTC), ${f.ads.length} ${f.ads.length === 1 ? "ad" : "ads"} with an offer of financial services (investments, crypto or similar) were recorded, leading to ${domains.length} ${domains.length === 1 ? "domain" : "domains"}.

## Brands and people used

${f.personas.map((p) => `- ${p} (image in the ads)`).join("\n") || "- no people named"}

## Domains of the offer

${domains.map((d) => `- ${d.domain}: registered ${formatUtc(d.created_utc)}, ads ${d.ads}; ${certSentence(d)}`).join("\n") || "- none"}

## Payments

${payments.map((p) => `- ${p}`).join("\n") || "- the pack has no payment identifiers"}

## Scale

${f.ads.length} ${f.ads.length === 1 ? "ad" : "ads"} on the platforms: ${[...new Set(f.ads.map((a) => a.platform ?? "unknown"))].join(", ")}. Reach data comes from the ad libraries, if it was fetched (evidence.json).

Request to consider an entry on the public warning list and to establish whether the entity is licensed for the services offered.
`;
}

/**
 * Notice to the prosecutor: the grounds of the campaign (fraud always; impersonation only when a
 * person is named), the dates, the CERT status, and who may file (the person whose image was used
 * has the standing to press charges for impersonation). The legal qualification is a proposal.
 */
export function renderProsecutorNotice(f: CampaignFacts): string {
  const domains = operatorDomains(f);
  return `# Notification of a possible offence — campaign ${f.campaignId}

Pack \`${f.packageId}\`, ${formatUtc(f.createdUtc)}. ${SIGNATURE}

## Grounds

- Art. 286 of the Criminal Code (fraud): ${f.ads.length} ${f.ads.length === 1 ? "ad" : "ads"} in the period ${formatRange(f.firstSeenUtc, f.lastSeenUtc)} (UTC) ${f.ads.length === 1 ? "leads" : "lead"} to ${domains.length} ${domains.length === 1 ? "domain" : "domains"} with an offer that the tool links into one campaign through shared traces (evidence.json, \`observations.shared_identifiers\`).
${f.personas.length ? `- Art. 190a § 2 of the Criminal Code (impersonation): the ads use the image or name of: ${f.personas.join(", ")}.\n` : ""}${f.deepfake ? "- the sample may be synthetic (model output: a hint, not proof).\n" : ""}
The legal qualification is a proposal to verify.

## Domains

${domains.map((d) => `- ${d.domain}: registered ${formatUtc(d.created_utc)}; ${certSentence(d)}`).join("\n") || "- none"}

## Who may file the notification

${f.personas.length ? "Anyone may file the notification; in a case of impersonation the request to prosecute is filed by the injured person (the person whose image was used) or their representative: they confirm the lack of consent." : "Anyone may file the notification; the pack does not name injured parties (people who paid money)."}

## Attachments

Full pack: evidence.json, manifest.sha256, copies of the case files with SHA-256 checksums.
`;
}
