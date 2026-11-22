import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { appendWatchRow, parseEvery, readWatchRows, runWatch, type WatchAnalysis, type WatchClock, type WatchHit, type WatchSource } from "./schedule";

const dir = mkdtempSync(path.join(tmpdir(), "watch-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Zegar wstrzykiwany: `sleep` przesuwa czas bez czekania i zlicza uśpienia. */
function fakeClock(start = "2026-11-22T10:00:00Z"): WatchClock & { sleeps: number[] } {
  let t = Date.parse(start);
  const sleeps: number[] = [];
  return { now: () => new Date(t), sleep: async (ms) => void (sleeps.push(ms), (t += ms)), sleeps };
}

function source(name: WatchSource["name"], hits: WatchHit[], skipped?: string): WatchSource & { polls: number } {
  const s = { name, polls: 0, async poll() { s.polls++; return skipped ? { hits: [], skipped } : { hits }; } };
  return s;
}

const analyze = async (hit: WatchHit): Promise<WatchAnalysis> =>
  hit.url.includes("dopasowana") ? { verdict: "known_campaign", campaign: "K01" } : { verdict: "new_campaign", campaign: null };

describe("harmonogram skanów", () => {
  it("analizuje każde trafienie źródła i dopisuje wiersze do watch.jsonl; dopasowany ma kampanię", async () => {
    const file = path.join(dir, "a.jsonl");
    const clock = fakeClock();
    const src = source("ct", [
      { source: "ct", url: "https://dopasowana.test/" },
      { source: "ct", url: "https://inna.test/" },
    ]);
    const res = await runWatch({ sources: [src], recipes: [], analyze, file, everyMs: 1_800_000, once: true, clock });
    const rows = readWatchRows(file);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.url, r.verdict, r.campaign])).toEqual([
      ["https://dopasowana.test/", "known_campaign", "K01"],
      ["https://inna.test/", "new_campaign", null],
    ]);
    expect(rows[0].ts).toBe("2026-11-22T10:00:00.000Z");
    expect(res.cycles).toBe(1);
  });

  it("nie analizuje drugi raz tego samego adresu, także po ponownym uruchomieniu (z pliku)", async () => {
    const file = path.join(dir, "b.jsonl");
    const clock = fakeClock();
    let calls = 0;
    const counting = async (h: WatchHit) => (calls++, analyze(h));
    const src = source("urlscan", [{ source: "urlscan", url: "https://dopasowana.test/x" }]);
    await runWatch({ sources: [src], recipes: [], analyze: counting, file, everyMs: 60_000, once: false, clock, maxCycles: 3 });
    expect(calls).toBe(1);
    expect(src.polls).toBe(3);
    expect(clock.sleeps).toEqual([60_000, 60_000]);
    await runWatch({ sources: [src], recipes: [], analyze: counting, file, everyMs: 60_000, once: true, clock });
    expect(calls).toBe(1);
    expect(readWatchRows(file)).toHaveLength(1);
  });

  it("pomija źródło bez sieci albo klucza z powodem i działa dalej z pozostałymi", async () => {
    const file = path.join(dir, "c.jsonl");
    const clock = fakeClock();
    const down = source("urlscan", [], "brak sieci");
    const up = source("certlist", [{ source: "certlist", url: "https://lista.test/" }]);
    const res = await runWatch({ sources: [down, up], recipes: [], analyze, file, everyMs: 60_000, once: true, clock });
    expect(res.report.map((r) => [r.source, r.status, r.reason ?? null, r.hits])).toEqual([
      ["urlscan", "skipped", "brak sieci", 0],
      ["certlist", "ok", null, 1],
    ]);
    expect(readWatchRows(file)).toHaveLength(1);
  });

  it("błąd analizy jednego trafienia nie zatrzymuje reszty i zostaje w wierszu jako werdykt error z powodem", async () => {
    const file = path.join(dir, "d.jsonl");
    const failing = async (h: WatchHit): Promise<WatchAnalysis> => {
      if (h.url.includes("zepsuta")) throw new Error("strona nie odpowiada");
      return analyze(h);
    };
    const src = source("ct", [
      { source: "ct", url: "https://zepsuta.test/" },
      { source: "ct", url: "https://dopasowana.test/" },
    ]);
    await runWatch({ sources: [src], recipes: [], analyze: failing, file, everyMs: 60_000, once: true, clock: fakeClock() });
    const rows = readWatchRows(file);
    expect(rows.map((r) => r.verdict)).toEqual(["error", "known_campaign"]);
    expect(rows[0].note).toBe("strona nie odpowiada");
  });

  it("przepis jest odpytywany nie częściej niż co swoją częstotliwość", async () => {
    const file = path.join(dir, "e.jsonl");
    const clock = fakeClock();
    const seen: string[][] = [];
    const src: WatchSource = { name: "urlscan", async poll({ recipes }) { seen.push(recipes.map((r) => r.id)); return { hits: [] }; } };
    const recipes = [
      { id: "co-cykl", source: "urlscan" as const, query: "a" },
      { id: "co-godzine", source: "urlscan" as const, query: "b", every: "1h" },
    ];
    await runWatch({ sources: [src], recipes, analyze, file, everyMs: 20 * 60_000, once: false, clock, maxCycles: 4 });
    expect(seen).toEqual([["co-cykl", "co-godzine"], ["co-cykl"], ["co-cykl"], ["co-cykl", "co-godzine"]]);
  });

  it("wiersz z potwierdzeniami i przepisem zachowuje je w pliku", async () => {
    const file = path.join(dir, "f.jsonl");
    const src = source("ct", [{ source: "ct", url: "https://x.test/", recipe: "r1", confirmations: ["ten sam NS"] }]);
    await runWatch({ sources: [src], recipes: [], analyze, file, everyMs: 1, once: true, clock: fakeClock() });
    const row = JSON.parse(readFileSync(file, "utf8").trim());
    expect(row.recipe).toBe("r1");
    expect(row.confirmations).toEqual(["ten sam NS"]);
  });

  it("dopisuje, nie nadpisuje, i pomija uszkodzone linie przy czytaniu", () => {
    const file = path.join(dir, "g.jsonl");
    appendWatchRow(file, { ts: "t1", source: "ct", url: "u1", verdict: "new_campaign", campaign: null });
    appendWatchRow(file, { ts: "t2", source: "ct", url: "u2", verdict: "new_campaign", campaign: null });
    expect(readWatchRows(file).map((r) => r.url)).toEqual(["u1", "u2"]);
  });

  it("parseEvery rozumie s, m, h, d i odrzuca resztę", () => {
    expect(parseEvery("30m")).toBe(1_800_000);
    expect(parseEvery("2h")).toBe(7_200_000);
    expect(parseEvery("45s")).toBe(45_000);
    expect(parseEvery("1d")).toBe(86_400_000);
    expect(() => parseEvery("kiedyś")).toThrow(/30m/);
  });
});
