/**
 * Age of a domain and of its first TLS certificate on the day a material was first seen (B-191, B-206):
 * short-lived domains registered days before the ad. A description for the analyst, not a risk score and
 * not evidence of a campaign. Without an RDAP creation date (some ccTLDs) the earliest certificate in CT
 * stands in, and is named "first certificate", never "registration".
 */

const DAY_MS = 86_400_000;

/** Whole days from `from` to `to` (floor; negative when `from` is later), null when either date is missing or unreadable. */
function wholeDays(from: string | null | undefined, to: string | null | undefined): number | null {
  const a = Date.parse(from ?? "");
  const b = Date.parse(to ?? "");
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.floor((b - a) / DAY_MS);
}

/**
 * Takes the RDAP creation date, the notBefore dates of the domain's certificates and the material's first
 * sight (ISO strings, null when unknown); returns the domain age and the age of the earliest certificate in
 * whole days at that moment (negative: registered after the material, e.g. a re-registered domain), and that
 * certificate's date.
 */
export function domainAgeAt(created: string | null | undefined, certNotBefore: Array<string | null | undefined>, at: string | null | undefined): { domainAgeDays: number | null; certAgeDays: number | null; firstCertificate: string | null } {
  const certs = certNotBefore.filter((d): d is string => !!d && !Number.isNaN(Date.parse(d))).sort((x, y) => Date.parse(x) - Date.parse(y));
  const firstCertificate = certs[0] ?? null;
  return { domainAgeDays: wholeDays(created, at), certAgeDays: wholeDays(firstCertificate, at), firstCertificate };
}
