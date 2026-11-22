import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset } from "./testkit";

describe("displayedDomainMismatch on the item (I28)", () => {
  const dataOf = (spec: { ocrText?: string; text?: string }) => {
    const g = buildEvidenceGraph(makeDataset([{ id: "a", url: "https://losowa-strona.test/", ...spec }]), { textMethod: "none" });
    return g.nodes.find((n) => n.type === "item" && n.key === "a")!.data;
  };

  it("keeps the shown domain, the landing domain and the brand flag as attributes, without any link evidence", () => {
    const d = dataOf({ ocrText: "Sponsorowane\nONET.PL\nSzok!" });
    expect(d.displayedDomainMismatch).toEqual({ displayed: "onet.pl", landing: "losowa-strona.test", source: "ocr", confidence: "high" });
    expect(d.displayedBrandDomain).toBe(true);
  });

  it("is absent when the creative shows no domain", () => {
    expect(dataOf({ ocrText: "Sponsorowane\nSzok!" }).displayedDomainMismatch).toBeUndefined();
  });
});

describe("phone line attributes on the item (I28)", () => {
  const dataOf = (phones: string[], pageText = "") => {
    const g = buildEvidenceGraph(makeDataset([{ id: "a", url: "https://losowa-strona.test/", phones, pageText }]), { textMethod: "none" });
    return g.nodes.find((n) => n.type === "item" && n.key === "a")!.data;
  };

  it("keeps the line type and country of each number and flags a number of another country", () => {
    const d = dataOf(["+48601234567", "+442079460958"]);
    expect(d.phoneLines).toEqual([
      { phone: "+48601234567", lineType: "mobile", country: "PL" },
      { phone: "+442079460958", lineType: "fixed", country: "GB" },
    ]);
    expect(d.phoneCountryMismatch).toBe(true);
    expect(d.tollFreeOnAlert).toBeUndefined();
  });

  it("has no phone attributes without a number", () => {
    expect(dataOf([]).phoneLines).toBeUndefined();
  });
});

describe("toll-free number on a fake security alert (I28)", () => {
  it("is flagged only when the page carries the fake_security_alert technique", () => {
    const flag = (techniques: Array<"fake_security_alert" | "back_trap">) => {
      const g = buildEvidenceGraph(makeDataset([{ id: "a", url: "https://losowa-strona.test/", phones: ["+48800000000"], kit: { techniques } }]), { textMethod: "none" });
      return g.nodes.find((n) => n.type === "item" && n.key === "a")!.data.tollFreeOnAlert;
    };
    expect(flag(["fake_security_alert"])).toBe(true);
    expect(flag(["back_trap"])).toBeUndefined();
  });
});

describe("P2 attributes on the item and the campaign (I28)", () => {
  const run = (specs: Array<{ id: string; url: string; extra?: Record<string, string>; text?: string }>) => buildEvidenceGraph(makeDataset(specs), { textMethod: "none" });
  const item = (g: ReturnType<typeof run>, id: string) => g.nodes.find((n) => n.type === "item" && n.key === id)!.data;

  it("keeps the weekday of the library start date of the ad", () => {
    const g = run([{ id: "a", url: "https://losowa-strona.test/", extra: { ad_platform: "google", ad_id: "CR1", ad_first_shown: "2026-11-02" } }]);
    expect(item(g, "a").adStartWeekday).toEqual({ weekday: 0, hour: null });
  });

  it("keeps a look-alike host of the landing address and the creation date of a Discord id in the ad text", () => {
    const g = run([{ id: "a", url: "https://bank-przyklad.example∕logowanie.zlosliwa.test/", text: "https://discord.com/users/175928847299117063" }]);
    expect(item(g, "a").idnConfusable).toMatchObject({ kind: "lookalike_char", looksLike: "bank-przyklad.example/logowanie.zlosliwa.test" });
    expect(item(g, "a").discordSnowflakes).toEqual([{ id: "175928847299117063", kind: "user", createdAt: "2016-04-30T11:18:25.796Z" }]);
  });

  it("counts the start weekdays of a campaign's ads, Monday first", () => {
    const libra = (day: string) => ({ ad_platform: "google", ad_id: `CR-${day}`, ad_first_shown: day });
    const g = run([
      { id: "a", url: "https://wspolna.test/", extra: libra("2026-11-02") },
      { id: "b", url: "https://wspolna.test/", extra: libra("2026-11-03") },
      { id: "c", url: "https://wspolna.test/", extra: libra("2026-11-03") },
    ]);
    const campaign = clusterCampaigns(g).campaigns.campaigns.find((c) => c.members.length === 3)!;
    expect(campaign.attributes.adStartWeekdays).toEqual([1, 2, 0, 0, 0, 0, 0]);
  });
});
