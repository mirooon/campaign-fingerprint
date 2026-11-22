import { describe, expect, it } from "vitest";
import type { CampaignsFile } from "../graph/model";
import type { EnrichedDataset } from "../pipeline/types";
import { DEFAULT_CT_CONFIG } from "./config";
import { appearanceTime, backtestFingerprints, campaignsKnownBefore, leadHours, parseCertActions, parseSightings, summarizeLeads, withRetry } from "./backtest";
import { buildFingerprints } from "./fingerprint";

describe("czas pojawienia się w logach CT i wyprzedzenie względem Listy CERT", () => {
  it("bierze czas wpisu w logu (SCT); bez niego not_before przesunięty o ok. godzinę, bo CA cofa jego początek", () => {
    expect(appearanceTime({ entryTimestamp: "2026-11-10T10:00:00Z", notBefore: "2026-11-10T08:00:00Z" })).toBe("2026-11-10T10:00:00.000Z");
    expect(appearanceTime({ entryTimestamp: null, notBefore: "2026-11-10T08:00:00Z" })).toBe("2026-11-10T09:00:00.000Z");
    expect(appearanceTime({ entryTimestamp: null, notBefore: null })).toBeNull();
  });

  it("wyprzedzenie to godziny od pojawienia się certyfikatu do wpisu na liście; dodatnie = CT było pierwsze", () => {
    expect(leadHours("2026-11-12T10:00:00Z", "2026-11-10T10:00:00Z")).toBe(48);
    expect(leadHours("2026-11-10T10:00:00Z", "2026-11-10T12:30:00Z")).toBe(-2.5);
  });

  it("podsumowuje: ile domen miało certyfikat, mediana i kwartyle, udział z wyprzedzeniem ≥ 24 h", () => {
    const s = summarizeLeads([
      { domain: "a.test", listedUtc: "2026-11-12T00:00:00Z", appearedUtc: "2026-11-10T00:00:00Z" },
      { domain: "b.test", listedUtc: "2026-11-12T00:00:00Z", appearedUtc: "2026-11-11T12:00:00Z" },
      { domain: "c.test", listedUtc: "2026-11-12T00:00:00Z", appearedUtc: null },
    ]);
    expect(s).toMatchObject({ n: 3, withCt: 2, medianHours: 30, shareAtLeast24h: 0.5 });
  });

  it("ponawia zapytanie, które się nie udało (crt.sh często odrzuca), z przerwą, i oddaje ostatni błąd po wyczerpaniu prób", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const ok = await withRetry(async () => (++calls < 3 ? Promise.reject(new Error("503")) : "gotowe"), { attempts: 3, delayMs: 10, sleep: async (ms) => void sleeps.push(ms) });
    expect(ok).toBe("gotowe");
    expect(sleeps).toEqual([10, 10]);
    await expect(withRetry(async () => Promise.reject(new Error("zawsze")), { attempts: 2, delayMs: 1, sleep: async () => {} })).rejects.toThrow("zawsze");
  });
});

describe("wczytywanie nagrań", () => {
  it("log akcji Listy CERT: tylko blokady, najwcześniejszy wpis domeny, uszkodzona linia pominięta", () => {
    const log = [
      JSON.stringify({ DomainAddress: "B.example.", ActionTime: "2026-11-02T10:00:00Z", ActionType: "block" }),
      "{uszkodzona",
      JSON.stringify({ DomainAddress: "a.example", ActionTime: "2026-11-03T10:00:00Z", ActionType: "block" }),
      JSON.stringify({ DomainAddress: "a.example", ActionTime: "2026-11-01T10:00:00Z", ActionType: "block" }),
      JSON.stringify({ DomainAddress: "c.example", ActionTime: "2026-11-01T10:00:00Z", ActionType: "unblock" }),
    ].join("\n");
    expect(parseCertActions(log)).toEqual([
      { domain: "a.example", listedUtc: "2026-11-01T10:00:00.000Z" },
      { domain: "b.example", listedUtc: "2026-11-02T10:00:00.000Z" },
    ]);
  });

  it("certyfikaty z nagrania: najwcześniejsze pojawienie się domeny rejestrowalnej, nazwy z subdomenami i bez czasu pomijane lub scalane", () => {
    const rec = [
      JSON.stringify({ names: ["www.x.example", "x.example"], entry_timestamp: "2026-11-05T10:00:00Z", not_before: "2026-11-05T09:00:00Z" }),
      JSON.stringify({ names: ["x.example"], entry_timestamp: "2026-11-04T10:00:00Z" }),
      JSON.stringify({ names: ["y.example"], not_before: "2026-11-06T08:00:00Z" }),
      JSON.stringify({ names: ["z.example"] }),
    ].join("\n");
    expect(parseSightings(rec)).toEqual([
      { domain: "x.example", seenUtc: "2026-11-04T10:00:00.000Z" },
      { domain: "y.example", seenUtc: "2026-11-06T09:00:00.000Z" },
    ]);
  });
});

describe("backtest dopasowania odcisków bez przecieku z przyszłości", () => {
  const camp = (id: string, members: string[], domains: string[]) => ({ id, size: members.length, members, domains, advertisers: [], attributes: { personas: [] } }) as unknown as CampaignsFile["campaigns"][number];
  const campaigns = { campaigns: [camp("K01", ["a", "b", "c"], ["finance12-dolorem51.example", "finance88-quia40.example", "finance30-nostra11.example"])], assignments: {} } as unknown as CampaignsFile;
  const item = (id: string, firstSeen: string) => ({ id, firstSeen });
  const landing = (domain: string) => ({ landing: { url: `https://${domain}/`, host: domain } });
  const ds = {
    items: [item("a", "2026-10-01T00:00:00Z"), item("b", "2026-10-05T00:00:00Z"), item("c", "2026-11-05T00:00:00Z")],
    perItem: { a: landing("finance12-dolorem51.example"), b: landing("finance88-quia40.example"), c: landing("finance30-nostra11.example") },
  } as unknown as EnrichedDataset;

  it("do dnia D zna tylko domeny rekordów widzianych do tego dnia", () => {
    const known = campaignsKnownBefore(campaigns, ds, "2026-10-10T00:00:00Z");
    expect(known.campaigns[0].domains).toEqual(["finance12-dolorem51.example", "finance88-quia40.example"]);
    expect(campaignsKnownBefore(campaigns, ds, "2026-09-01T00:00:00Z").campaigns).toEqual([]);
  });

  it("dopasowuje certyfikaty po D do odcisków sprzed D i liczy recall przy budżecie alertów oraz wyprzedzenie", () => {
    const set = buildFingerprints(campaignsKnownBefore(campaigns, ds, "2026-10-10T00:00:00Z"), { config: { ...DEFAULT_CT_CONFIG } });
    const out = backtestFingerprints({
      set,
      since: "2026-10-10T00:00:00Z",
      sightings: [
        { domain: "finance23-voluptas94.example", seenUtc: "2026-10-20T00:00:00Z" },
        { domain: "finance41-dolorem56.example", seenUtc: "2026-10-21T00:00:00Z" },
        { domain: "zwykla-strona.example", seenUtc: "2026-10-22T00:00:00Z" },
        { domain: "finance77-przed22.example", seenUtc: "2026-10-01T00:00:00Z" },
      ],
      listed: new Map([["finance23-voluptas94.example", "2026-10-23T00:00:00Z"], ["finance99-nigdy11.example", "2026-10-25T00:00:00Z"]]),
      budgets: [1, 5],
    });
    expect(out.alerts.map((a) => a.domain)).toEqual(["finance23-voluptas94.example", "finance41-dolorem56.example"]);
    expect(out.positives).toBe(2);
    expect(out.alerts[0]).toMatchObject({ campaignId: "K01", listedUtc: "2026-10-23T00:00:00Z", leadHours: 72 });
    expect(out.byBudget).toEqual([
      { budget: 1, alerts: 1, hits: 1, recall: 0.5, medianLeadHours: 72 },
      { budget: 5, alerts: 2, hits: 1, recall: 0.5, medianLeadHours: 72 },
    ]);
  });
});
