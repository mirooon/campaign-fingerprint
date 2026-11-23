/**
 * "New domains of this campaign" (B-030): which candidates of the CT feed point at a campaign and how their certificate
 * time relates to the campaign's first ad. Pure functions over the feed records.
 */
import type { CtFeedRecord } from "@/lib/ct/feed";
import { count } from "./format";

const HOUR_MS = 3_600_000;
/** Beyond this many hours the lead is told in days. */
const DAYS_FROM_HOURS = 72;
const HOUR: [string, string, string] = ["hour", "hours", "hours"];
const DAY: [string, string, string] = ["day", "days", "days"];

/**
 * "certificate issued 5 hours before the campaign's first ad": certificate start (`not_before`, ISO) against
 * the first ad of the campaign (ISO). Within an hour of it: "within the same hour". Null when either date is missing.
 */
export function ctLeadSentence(notBefore: string | null | undefined, firstAd: string | null | undefined): string | null {
  const cert = Date.parse(notBefore ?? "");
  const ad = Date.parse(firstAd ?? "");
  if (Number.isNaN(cert) || Number.isNaN(ad)) return null;
  const hours = Math.round((ad - cert) / HOUR_MS);
  if (hours === 0) return "certificate issued within the same hour as the campaign's first ad";
  const abs = Math.abs(hours);
  const span = abs > DAYS_FROM_HOURS ? count(Math.round(abs / 24), DAY) : count(abs, HOUR);
  return `certificate issued ${span} ${hours > 0 ? "before" : "after"} the campaign's first ad`;
}

/** Feed records whose candidate points at the campaign `campaignId`. */
export function campaignCtRecords(records: CtFeedRecord[], campaignId: string): CtFeedRecord[] {
  return records.filter((r) => r.candidate.campaign_id === campaignId);
}
