/**
 * Indicator files per recipient next to cert-domains.txt: the registrar gets domains with the abuse
 * contact from RDAP, the hosting provider the addresses and AS numbers, the platform the ad
 * identifiers and library links, the bank the payment identifiers, the telecom operator the phone
 * numbers; odbiorcy.md names who else could be asked and why. Indicators on shared infrastructure
 * (a CDN, a large host) are left out: they do not identify an operator. Pure functions over the
 * facts of the pack (lib/evidence/facts.ts); writing the files stays with pack.ts.
 */
import type { CampaignFacts, FactDomain } from "./facts";

export interface RecipientFile {
  file: string;
  content: string;
}

const PHONE = /^\+?[\d\s().-]{7,}$/;

/** One CSV cell: quoted when it holds a comma, quote or line break. */
function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text with a header row; null when there are no data rows, so that no empty file is written. */
function csv(header: string[], rows: unknown[][]): string | null {
  if (!rows.length) return null;
  return `${[header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n")}\n`;
}

/** Domains that name an operator (not on shared infrastructure). */
const own = (f: CampaignFacts): FactDomain[] => f.domains.filter((d) => !d.shared_infrastructure);

/** Proposed recipients with the reason each one is proposed; UODO and KNF only when the facts call for them, UKE only after an earlier report. */
function recipientsNote(f: CampaignFacts): string {
  const abuse = own(f).filter((d) => d.abuse_email);
  return `# Recipients of reports — campaign ${f.campaignId}

Pack \`${f.packageId}\`. The recipients are a proposal with a reason; a human decides whether to report, the tool sends nothing.

- **Ad platforms** (Art. 16 DSA): each gets a separate notice (\`dsa-art16-*.md\`) and the indicators from \`wskazniki/platforma.csv\`.
- **CERT Polska**: the domains from \`cert-domains.txt\` (without domains already on the list).
- **Registrars and hosting**: ${abuse.length ? `abuse contact from RDAP: ${[...new Set(abuse.map((d) => d.abuse_email))].join(", ")}; indicators in \`wskazniki/rejestrator.csv\` and \`wskazniki/hosting.csv\`` : "RDAP gave no abuse contact; indicators in the registrar and hosting files"}.
${f.personas.length ? `- **UODO**: the ads use the image or name of (${f.personas.join(", ")}); the complaint is filed by the data subject.\n` : ""}${f.financialOffer ? "- **KNF**: the ads hold an offer of financial services (investments or crypto); draft in `knf-notification.md`.\n" : ""}- **Public prosecutor / Police**: draft in \`prosecutor-notification.md\`.
- **President of UKE**: complaint after an earlier report to the platform with no reaction${f.priorReports ? ` (the pack holds ${f.priorReports} earlier ${f.priorReports === 1 ? "report" : "reports"})` : " (the pack holds no earlier reports)"}.
`;
}

/** Files of indicators per recipient and the note of proposed recipients; only the files that have rows. */
export function recipientFiles(f: CampaignFacts): RecipientFile[] {
  const domains = own(f);
  const files: Array<{ file: string; content: string | null }> = [
    {
      file: "wskazniki/rejestrator.csv",
      content: csv(["domain", "registrar", "iana_id", "abuse_email", "created_utc", "ads_in_campaign"], domains.map((d) => [d.domain, d.registrar, d.registrar_iana_id, d.abuse_email, d.created_utc, d.ads])),
    },
    {
      file: "wskazniki/hosting.csv",
      content: csv(["ip", "asn", "asn_name", "domain"], domains.flatMap((d) => d.ips.map((i) => [i.ip, i.asn, i.as_name, d.domain]))),
    },
    {
      file: "wskazniki/platforma.csv",
      content: csv(
        ["platform", "ad_id", "library_id", "library_url"],
        f.ads.map((a) => [a.platform, a.ad_ids.ad_id ?? a.item_id, a.ad_ids.ad_library_id, a.ad_urls.find((u) => /\/ads\/library\//i.test(u))]),
      ),
    },
    {
      file: "wskazniki/platnosci.csv",
      content: csv(
        ["kind", "identifier", "domain"],
        domains.flatMap((d) => d.payment_identifiers.map((p) => [p.slice(0, p.indexOf(":")), p.slice(p.indexOf(":") + 1), d.domain])),
      ),
    },
    {
      file: "wskazniki/operator.csv",
      content: csv(["number", "domain"], domains.flatMap((d) => d.contact_points.filter((c) => PHONE.test(c)).map((c) => [c, d.domain]))),
    },
  ];
  return [...files.filter((x): x is RecipientFile => x.content !== null), { file: "odbiorcy.md", content: recipientsNote(f) }];
}
