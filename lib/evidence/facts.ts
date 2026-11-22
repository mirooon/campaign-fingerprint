/**
 * Facts of a campaign that the documents of the evidence pack are written from (DSA notices,
 * data-preservation request, notices to KNF and the prosecutor, files of indicators per recipient).
 * Plain data taken from the pack record; the documents themselves are pure functions over it.
 */

export interface FactDomain {
  domain: string;
  created_utc: string | null;
  registrar: string | null;
  registrar_iana_id: string | null;
  /** Abuse contact of the registrar from RDAP; null when RDAP has none. */
  abuse_email: string | null;
  nameservers: string[];
  ips: Array<{ ip: string; asn: number | null; as_name: string | null }>;
  /** Status on the CERT Warning List from the local copy (active / removed / absent / unchecked) with the date of entry. */
  cert_status: "active" | "removed" | "absent" | "unchecked";
  cert_insert_date: string | null;
  /** Number of ads of the campaign that lead to the domain. */
  ads: number;
  payment_identifiers: string[];
  contact_points: string[];
  /** Shared infrastructure (Cloudflare etc.): it does not tell sites apart, so it is not a target of requests. */
  shared_infrastructure: boolean;
}

export interface FactAd {
  item_id: string;
  platform: string | null;
  ad_ids: Record<string, string>;
  ad_urls: string[];
  first_seen_utc: string | null;
  last_seen_utc: string | null;
}

export interface CampaignFacts {
  campaignId: string;
  packageId: string;
  createdUtc: string;
  firstSeenUtc: string | null;
  lastSeenUtc: string | null;
  ads: FactAd[];
  domains: FactDomain[];
  personas: string[];
  /** An offer of investment, crypto or other financial service appears in the ads (flag from the pack). */
  financialOffer: boolean;
  /** A synthetic-media score from the input data or a model is present. */
  deepfake: boolean;
  /** Earlier reports of this campaign (prior_reports of the pack), for the recipients that need them. */
  priorReports: number;
}
