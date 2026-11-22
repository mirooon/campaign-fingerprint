/**
 * "Nowe domeny tej kampanii" (B-030): which candidates of the CT feed point at a campaign and how their certificate
 * time relates to the campaign's first ad. Pure functions over the feed records.
 */
import type { CtFeedRecord } from "@/lib/ct/feed";
import { count } from "./format";

const HOUR_MS = 3_600_000;
/** Beyond this many hours the lead is told in days. */
const DAYS_FROM_HOURS = 72;
const HOUR: [string, string, string] = ["godzinę", "godziny", "godzin"];
const DAY: [string, string, string] = ["dzień", "dni", "dni"];

/**
 * "certyfikat wystawiono 5 godzin przed pierwszą reklamą kampanii": certificate start (`not_before`, ISO) against
 * the first ad of the campaign (ISO). Within an hour of it: "w tej samej godzinie". Null when either date is missing.
 */
export function ctLeadSentence(notBefore: string | null | undefined, firstAd: string | null | undefined): string | null {
  const cert = Date.parse(notBefore ?? "");
  const ad = Date.parse(firstAd ?? "");
  if (Number.isNaN(cert) || Number.isNaN(ad)) return null;
  const hours = Math.round((ad - cert) / HOUR_MS);
  if (hours === 0) return "certyfikat wystawiono w tej samej godzinie co pierwsza reklama kampanii";
  const abs = Math.abs(hours);
  const span = abs > DAYS_FROM_HOURS ? count(Math.round(abs / 24), DAY) : count(abs, HOUR);
  return `certyfikat wystawiono ${span} ${hours > 0 ? "przed pierwszą reklamą" : "po pierwszej reklamie"} kampanii`;
}

/** Feed records whose candidate points at the campaign `campaignId`. */
export function campaignCtRecords(records: CtFeedRecord[], campaignId: string): CtFeedRecord[] {
  return records.filter((r) => r.candidate.campaign_id === campaignId);
}
