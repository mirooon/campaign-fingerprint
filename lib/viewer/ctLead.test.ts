import { describe, expect, it } from "vitest";
import type { CtFeedRecord } from "@/lib/ct/feed";
import { campaignCtRecords, ctLeadSentence } from "./ctLead";

describe("ctLeadSentence", () => {
  const firstAd = "2026-09-10T12:00:00.000Z";
  it("certificate before the first ad: hours, singular and plural", () => {
    expect(ctLeadSentence("2026-09-10T11:00:00.000Z", firstAd)).toBe("certificate issued 1 hour before the campaign's first ad");
    expect(ctLeadSentence("2026-09-10T07:00:00.000Z", firstAd)).toBe("certificate issued 5 hours before the campaign's first ad");
  });
  it("beyond three days it counts in days", () => {
    expect(ctLeadSentence("2026-09-05T12:00:00.000Z", firstAd)).toBe("certificate issued 5 days before the campaign's first ad");
  });
  it("certificate after the first ad and within the same hour", () => {
    expect(ctLeadSentence("2026-09-10T14:00:00.000Z", firstAd)).toBe("certificate issued 2 hours after the campaign's first ad");
    expect(ctLeadSentence("2026-09-10T12:10:00.000Z", firstAd)).toBe("certificate issued within the same hour as the campaign's first ad");
  });
  it("no sentence without dates", () => {
    expect(ctLeadSentence(null, firstAd)).toBeNull();
    expect(ctLeadSentence("2026-09-10T14:00:00.000Z", null)).toBeNull();
  });
});

describe("campaignCtRecords", () => {
  const rec = (domain: string, campaign: string) => ({ domain, candidate: { campaign_id: campaign } }) as unknown as CtFeedRecord;
  it("keeps the candidates that point at this campaign", () => {
    expect(campaignCtRecords([rec("a.test", "K01"), rec("b.test", "K02"), rec("c.test", "K01")], "K01").map((r) => r.domain)).toEqual(["a.test", "c.test"]);
  });
});
