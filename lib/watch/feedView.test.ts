import { describe, expect, it } from "vitest";
import type { CtFeedRecord } from "../ct/feed";
import { mergeFeeds, watchRowToFeedRecord } from "./feedView";
import type { WatchRow } from "./schedule";

const row = (over: Partial<WatchRow> = {}): WatchRow => ({ ts: "2026-11-22T10:00:00.000Z", source: "urlscan", url: "https://nowa.test/x?y=1", verdict: "known_campaign", campaign: "K04", ...over });

describe("wiersze harmonogramu w feedzie CT", () => {
  it("wiersz z kampanią staje się rekordem feedu: domena z adresu, werdykt i przepis w przesłankach, źródło watch", () => {
    const r = watchRowToFeedRecord(row({ recipe: "najemca", confirmations: ["najemca: x"] }))!;
    expect(r).toMatchObject({ type: "ct_candidate", source: "watch", domain: "nowa.test", observed_utc: "2026-11-22T10:00:00.000Z", status: "confirmed" });
    expect(r.candidate).toMatchObject({ campaign_id: "K04", kind: "watch" });
    expect(r.candidate.evidence).toEqual(expect.arrayContaining(["źródło: urlscan, przepis: najemca", "werdykt analizy: known_campaign", "najemca: x"]));
    expect(r.stream).toBe("https://nowa.test/x?y=1");
  });

  it("wiersz bez kampanii i bez potwierdzeń, błąd analizy i zły adres nie trafiają do feedu; sam kandydat po odciskach zostaje kandydatem", () => {
    expect(watchRowToFeedRecord(row({ campaign: null, verdict: "new_campaign" }))).toBeNull();
    expect(watchRowToFeedRecord(row({ verdict: "error", campaign: null }))).toBeNull();
    expect(watchRowToFeedRecord(row({ url: "nie adres" }))).toBeNull();
    expect(watchRowToFeedRecord(row({ verdict: "new_campaign", source: "ct" }))?.status).toBe("candidate");
  });

  it("łączy feed CT i wiersze harmonogramu, najnowsze pierwsze, do limitu", () => {
    const ct = { observed_utc: "2026-11-22T09:00:00.000Z", domain: "a.test" } as CtFeedRecord;
    const merged = mergeFeeds([ct], [row(), row({ ts: "2026-11-22T08:00:00.000Z", url: "https://b.test/" })], 2);
    expect(merged.map((r) => r.domain)).toEqual(["nowa.test", "a.test"]);
  });
});
