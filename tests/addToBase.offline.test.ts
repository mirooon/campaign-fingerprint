/**
 * "Baza rośnie" on the synthetic sample, always on a copy of the base in a temporary folder (never on data/):
 * two materials of a new campaign with the same infrastructure. The first is a new campaign; after it is added to
 * the base the second is a known campaign with the first as the reason; without adding it stays a new campaign.
 * Ids of the existing campaigns do not change; duplicates and too-little-data materials are not added.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CampaignsFile } from "../lib/graph/model";
import { addToBase } from "../lib/pipeline/addToBase";
import { analyzeMaterial, type AnalyzedMaterial, type MaterialResult } from "../lib/pipeline/analyzeMaterial";
import { runBase, type MediaAvailability } from "../lib/pipeline/base";
import { writeSampleCases } from "../lib/pipeline/sampleCases";
import { SAMPLE } from "./sampleRun";

let root: string;
let baza: string;
let untouched: string;
const quiet = () => undefined;
const off = { available: false, reason: "wyłączone w teście" };
const noTools = async (): Promise<MediaAvailability> => ({ ocr: off, asr: off, audio: off, clip: off });
const readCampaigns = (dir: string) => JSON.parse(readFileSync(path.join(dir, "campaigns.json"), "utf8")) as CampaignsFile;

/** Analyses one case folder against a base, keeping what `addToBase` needs. */
async function analyze(dataDir: string, caseDir: string, work: string): Promise<{ result: MaterialResult; captured: AnalyzedMaterial }> {
  let captured: AnalyzedMaterial | undefined;
  const result = await analyzeMaterial({ caseDir }, { dataDir, workDir: path.join(root, work), media: { ocr: false }, log: quiet, onAnalyzed: (a) => (captured = a) });
  return { result, captured: captured! };
}

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "add-to-base-"));
  const cases = path.join(root, "sprawy");
  writeSampleCases(SAMPLE, cases, [
    { name: "c1-a", itemId: "c1-01" }, { name: "c1-b", itemId: "c1-02" },
    { name: "c2-a", itemId: "c2-01" }, { name: "c2-b", itemId: "c2-04" },
    { name: "c4-a", itemId: "c4-01" }, { name: "c4-b", itemId: "c4-02" },
  ]);
  // two ads of campaign C3 of the sample (one site), absent from the base
  writeSampleCases(SAMPLE, path.join(root, "nowe"), [{ name: "n1", itemId: "c3-07" }, { name: "n2", itemId: "c3-08" }]);
  baza = path.join(root, "baza");
  await runBase({ casesDir: cases, outDir: baza, offline: true, detect: noTools, log: quiet });
  untouched = path.join(root, "baza-bez-zmian");
  cpSync(baza, untouched, { recursive: true });
}, 120_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("dodawanie materiału do bazy", () => {
  it("drugi materiał nowej kampanii bez dodania pierwszego jest nową kampanią", async () => {
    const second = await analyze(untouched, path.join(root, "nowe", "n2"), "w0");
    expect(second.result.items[0].verdict).toBe("new_campaign");
  }, 60_000);

  it("po dodaniu pierwszego drugi jest znaną kampanią z pierwszym jako przesłanką; id istniejących kampanii bez zmian", async () => {
    const before = readCampaigns(baza);
    const first = await analyze(baza, path.join(root, "nowe", "n1"), "w1");
    expect(first.result.items[0].verdict).toBe("new_campaign");
    const firstId = first.result.items[0].id;

    const added = await addToBase(baza, first, { source: "cli", now: () => new Date("2026-11-22T10:00:00Z") });
    expect(added.added.map((a) => a.id)).toEqual([firstId]);
    expect(added.skipped).toEqual([]);

    const after = readCampaigns(baza);
    for (const c of before.campaigns) {
      const same = after.campaigns.find((x) => x.id === c.id);
      expect(same, `kampania ${c.id}`).toBeDefined();
      expect([...same!.members].sort()).toEqual([...c.members].sort());
    }
    expect(after.campaigns.length).toBe(before.campaigns.length + 1);
    expect(before.campaigns.map((c) => c.id)).not.toContain(after.assignments[firstId]);

    const second = await analyze(baza, path.join(root, "nowe", "n2"), "w2");
    const it = second.result.items[0];
    expect(it.verdict).toBe("known_campaign");
    expect(it.campaign).toBe(after.assignments[firstId]);
    expect(it.links[0].other).toBe(firstId);
    expect(it.links[0].evidence.length).toBeGreaterThan(0);
  }, 120_000);

  it("zostawia kopię poprzednich plików, wpis w dodane.jsonl i żadnych plików tymczasowych", () => {
    const history = readdirSync(path.join(baza, "historia"));
    expect(history).toEqual(["2026-11-22T10-00-00Z"]);
    const saved = readdirSync(path.join(baza, "historia", history[0]));
    expect(saved).toEqual(expect.arrayContaining(["campaigns.json", "graph.json", "enriched.json"]));
    expect(readCampaigns(path.join(baza, "historia", history[0])).campaigns.length).toBe(readCampaigns(untouched).campaigns.length);
    const log = readFileSync(path.join(baza, "dodane.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log).toEqual([{ ts: "2026-11-22T10:00:00.000Z", source: "cli", id: expect.any(String), verdict: "new_campaign" }]);
    expect(readdirSync(baza).filter((f) => f.includes(".tmp") || f.startsWith(".dodaj"))).toEqual([]);
  });

  it("materiał z obrazem jest kopiowany do bazy (ścieżka względna), więc baza nie zależy od katalogu roboczego", () => {
    const enriched = JSON.parse(readFileSync(path.join(baza, "enriched.json"), "utf8")) as { items: Array<{ id: string; imagePath: string | null }> };
    const added = enriched.items.find((i) => i.id === "n1");
    expect(added).toBeDefined();
    expect(existsSync(path.join(baza, added!.imagePath ?? "brak"))).toBe(true);
  });

  it("duplikat nie jest dopisywany i wskazuje, czego jest duplikatem", async () => {
    const again = await analyze(baza, path.join(root, "nowe", "n1"), "w3");
    expect(again.result.items[0].verdict).toBe("duplicate");
    const res = await addToBase(baza, again, { source: "cli" });
    expect(res.added).toEqual([]);
    expect(res.skipped[0]).toMatchObject({ reason: expect.stringContaining("duplikat"), duplicateOf: again.result.items[0].duplicateOf?.id });
  }, 60_000);

  it("za mało danych nie jest dopisywane bez force, z force tak", async () => {
    const bare = path.join(root, "gole", "obraz");
    mkdirSync(bare, { recursive: true });
    copyFileSync(path.join(SAMPLE, "images", "n4.png"), path.join(bare, "zrzut.png"));
    const lone = await analyze(baza, bare, "w4");
    expect(lone.result.items[0].verdict).toBe("insufficient");
    const refused = await addToBase(baza, lone, { source: "cli" });
    expect(refused.added).toEqual([]);
    expect(refused.skipped[0].reason).toMatch(/za mało danych/);
    expect((await addToBase(baza, lone, { source: "cli", force: true })).added).toHaveLength(1);
  }, 60_000);

  it("lista werdyktów zawęża dopisywanie: werdykt poza listą nie jest dopisywany", async () => {
    const third = await analyze(untouched, path.join(root, "nowe", "n1"), "w5");
    const res = await addToBase(untouched, third, { source: "watch", verdicts: ["known_campaign"] });
    expect(res.added).toEqual([]);
    expect(res.skipped[0].reason).toMatch(/new_campaign/);
    expect(existsSync(path.join(untouched, "dodane.jsonl"))).toBe(false);
  }, 60_000);
});
