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
  return `# Odbiorcy zgłoszeń — kampania ${f.campaignId}

Paczka \`${f.packageId}\`. Odbiorcy są propozycją z powodem; decyzję o zgłoszeniu podejmuje człowiek, narzędzie niczego nie wysyła.

- **Platformy reklamowe** (art. 16 DSA): każda dostaje osobne zgłoszenie (\`dsa-art16-*.md\`) i wskaźniki z \`wskazniki/platforma.csv\`.
- **CERT Polska**: domeny z \`cert-domains.txt\` (bez domen już na liście).
- **Rejestratorzy i hosting**: ${abuse.length ? `kontakt abuse z RDAP: ${[...new Set(abuse.map((d) => d.abuse_email))].join(", ")}; wskaźniki w \`wskazniki/rejestrator.csv\` i \`wskazniki/hosting.csv\`` : "RDAP nie podał kontaktu abuse; wskaźniki w pliku rejestratora i hostingu"}.
${f.personas.length ? `- **UODO**: w reklamach użyto wizerunku lub nazwiska (${f.personas.join(", ")}); skargę składa osoba, której dane dotyczą.\n` : ""}${f.financialOffer ? "- **KNF**: reklamy zawierają ofertę usług finansowych (inwestycje lub kryptowaluty); szkic w `knf-notification.md`.\n" : ""}- **Prokuratura / Policja**: szkic w \`prosecutor-notification.md\`.
- **Prezes UKE**: skarga po wcześniejszym zgłoszeniu do platformy i bez jej reakcji${f.priorReports ? ` (w paczce jest ${f.priorReports} wcześniejszych zgłoszeń)` : " (w paczce nie ma wcześniejszych zgłoszeń)"}.
`;
}

/** Files of indicators per recipient and the note of proposed recipients; only the files that have rows. */
export function recipientFiles(f: CampaignFacts): RecipientFile[] {
  const domains = own(f);
  const files: Array<{ file: string; content: string | null }> = [
    {
      file: "wskazniki/rejestrator.csv",
      content: csv(["domena", "rejestrator", "iana_id", "abuse_email", "utworzona_utc", "reklam_w_kampanii"], domains.map((d) => [d.domain, d.registrar, d.registrar_iana_id, d.abuse_email, d.created_utc, d.ads])),
    },
    {
      file: "wskazniki/hosting.csv",
      content: csv(["ip", "asn", "nazwa_asn", "domena"], domains.flatMap((d) => d.ips.map((i) => [i.ip, i.asn, i.as_name, d.domain]))),
    },
    {
      file: "wskazniki/platforma.csv",
      content: csv(
        ["platforma", "id_reklamy", "id_biblioteki", "adres_biblioteki"],
        f.ads.map((a) => [a.platform, a.ad_ids.ad_id ?? a.item_id, a.ad_ids.ad_library_id, a.ad_urls.find((u) => /\/ads\/library\//i.test(u))]),
      ),
    },
    {
      file: "wskazniki/platnosci.csv",
      content: csv(
        ["rodzaj", "identyfikator", "domena"],
        domains.flatMap((d) => d.payment_identifiers.map((p) => [p.slice(0, p.indexOf(":")), p.slice(p.indexOf(":") + 1), d.domain])),
      ),
    },
    {
      file: "wskazniki/operator.csv",
      content: csv(["numer", "domena"], domains.flatMap((d) => d.contact_points.filter((c) => PHONE.test(c)).map((c) => [c, d.domain]))),
    },
  ];
  return [...files.filter((x): x is RecipientFile => x.content !== null), { file: "odbiorcy.md", content: recipientsNote(f) }];
}
