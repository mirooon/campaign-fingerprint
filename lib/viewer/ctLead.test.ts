import { describe, expect, it } from "vitest";
import type { CtFeedRecord } from "@/lib/ct/feed";
import { campaignCtRecords, ctLeadSentence } from "./ctLead";

describe("ctLeadSentence", () => {
  const firstAd = "2026-09-10T12:00:00.000Z";
  it("certyfikat przed pierwszą reklamą: godziny z odmianą", () => {
    expect(ctLeadSentence("2026-09-10T11:00:00.000Z", firstAd)).toBe("certyfikat wystawiono 1 godzinę przed pierwszą reklamą kampanii");
    expect(ctLeadSentence("2026-09-10T07:00:00.000Z", firstAd)).toBe("certyfikat wystawiono 5 godziny przed pierwszą reklamą kampanii");
  });
  it("powyżej trzech dób liczy w dniach", () => {
    expect(ctLeadSentence("2026-09-05T12:00:00.000Z", firstAd)).toBe("certyfikat wystawiono 5 dni przed pierwszą reklamą kampanii");
  });
  it("certyfikat po pierwszej reklamie i w tej samej godzinie", () => {
    expect(ctLeadSentence("2026-09-10T14:00:00.000Z", firstAd)).toBe("certyfikat wystawiono 2 godziny po pierwszej reklamie kampanii");
    expect(ctLeadSentence("2026-09-10T12:10:00.000Z", firstAd)).toBe("certyfikat wystawiono w tej samej godzinie co pierwsza reklama kampanii");
  });
  it("bez dat nie ma zdania", () => {
    expect(ctLeadSentence(null, firstAd)).toBeNull();
    expect(ctLeadSentence("2026-09-10T14:00:00.000Z", null)).toBeNull();
  });
});

describe("campaignCtRecords", () => {
  const rec = (domain: string, campaign: string) => ({ domain, candidate: { campaign_id: campaign } }) as unknown as CtFeedRecord;
  it("zostawia kandydatów wskazujących tę kampanię", () => {
    expect(campaignCtRecords([rec("a.test", "K01"), rec("b.test", "K02"), rec("c.test", "K01")], "K01").map((r) => r.domain)).toEqual(["a.test", "c.test"]);
  });
});
