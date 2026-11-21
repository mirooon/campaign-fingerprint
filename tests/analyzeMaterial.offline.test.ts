/**
 * New material against an existing run (synthetic sample, recorded fixtures, no network):
 * a held-out ad of a known campaign comes back as that campaign, an unrelated saved page as a new one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeMaterial } from "../lib/pipeline/analyzeMaterial";
import type { Item } from "../lib/pipeline/types";
import { compileWatchlist, loadWatchlist } from "../lib/text/persona";
import { runSample, SAMPLE, sampleItems } from "./sampleRun";

let root: string;
let held: Item;
let expectedCampaign: string;
let run: Awaited<ReturnType<typeof runSample>>;

beforeAll(async () => {
  const all = sampleItems().items;
  const byLabel = new Map<string, Item[]>();
  for (const it of all) if (it.label && it.landingUrl) byLabel.set(it.label, [...(byLabel.get(it.label) ?? []), it]);
  const group = [...byLabel.values()].find((g) => g.length >= 3)!;
  held = group[group.length - 1];
  run = await runSample({ only: all.filter((it) => it.id !== held.id).map((it) => it.id) });
  expectedCampaign = run.campaigns.assignments[group[0].id];
  root = mkdtempSync(path.join(os.tmpdir(), "analyze-material-"));
  const data = path.join(root, "run");
  mkdirSync(data);
  writeFileSync(path.join(data, "enriched.json"), JSON.stringify(run.ds));
  writeFileSync(path.join(data, "campaigns.json"), JSON.stringify(run.campaigns));
  writeFileSync(path.join(data, "graph.json"), JSON.stringify(run.graph));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const ctx = (work: string) => ({
  dataDir: path.join(root, "run"),
  workDir: path.join(root, work),
  fixtures: path.join(SAMPLE, "fixtures"),
  config: run.config,
  personas: compileWatchlist(loadWatchlist(path.join(SAMPLE, "personas.json"))),
  media: { ocr: false },
});

describe("analyzeMaterial", () => {
  it("puts a held-out ad of a known campaign back into that campaign, with the links behind it", async () => {
    const res = await analyzeMaterial({ url: held.landingUrl!, text: held.text ?? undefined }, ctx("w1"));
    expect(res.mode).toBe("offline");
    const [it] = res.items;
    expect(it.verdict).toBe("known_campaign");
    expect(it.campaign).toBe(expectedCampaign);
    expect(it.links[0].otherCampaign).toBe(expectedCampaign);
    expect(it.verdictText).toContain(expectedCampaign);
    expect(it.features.landingUrl).toBeTruthy();
    // every premise says what it is: a shared node (with its id and type) or a similarity edge
    const ev = it.links.flatMap((l) => l.evidence);
    expect(ev.length).toBeGreaterThan(0);
    for (const e of ev) {
      if (e.kind === "pivot") {
        expect(e.pivotType).toBeTruthy();
        expect(e.pivot?.startsWith(`${e.pivotType}:`)).toBe(true);
        expect(e.edgeType).toBeNull();
      } else {
        expect(e.kind).toBe("similarity");
        expect(e.edgeType).toMatch(/^similar_/);
        expect(e.pivot).toBeNull();
      }
    }
    expect(ev.some((e) => e.kind === "pivot")).toBe(true);
    // traits of the record, counted against the existing run only
    const dom = it.pivots!.find((p) => p.type === "domain" && p.df > 0)!;
    expect(dom).toBeTruthy();
    expect(dom.sharedWith.length).toBe(dom.df);
    expect(dom.sharedWith).not.toContain(it.id);
    expect(dom.sharedWith.every((id) => run.ds.items.some((x) => x.id === id))).toBe(true);
    expect(dom.data.created).toMatch(/^\d{4}-\d{2}-\d{2}/);
    for (const p of it.pivots!) {
      expect(p.id.startsWith(`${p.type}:`)).toBe(true);
      expect(p.discounted).toBe(p.discountReasons.length > 0);
    }
  });

  it("reports a saved page with nothing in common as a new campaign", async () => {
    const caseDir = path.join(root, "upload", "nowa-sprawa");
    mkdirSync(caseDir, { recursive: true });
    writeFileSync(
      path.join(caseDir, "Strona.html"),
      `<!-- saved from url=(0040)https://zupelnie-inna-oferta.example/lp -->\n<html><head><title>Rowery miejskie</title></head><body><p>Promocja na rowery i darmowa dostawa przez cały miesiąc.</p></body></html>`,
    );
    const res = await analyzeMaterial({ caseDir }, ctx("w2"));
    expect(res.items.map((i) => [i.id, i.verdict])).toEqual([["nowa-sprawa", "new_campaign"]]);
  });

  it("keeps the outcome of every step in the result, skipped steps with their reason", async () => {
    const caseDir = path.join(root, "upload", "kroki");
    mkdirSync(caseDir, { recursive: true });
    writeFileSync(path.join(caseDir, "Strona.html"), `<!-- saved from url=(0036)https://kroki-demo.example/lp -->\n<html><body><p>Tekst.</p></body></html>`);
    const res = await analyzeMaterial({ caseDir }, ctx("w3"));
    const step = (name: string) => res.steps.find((s) => s.caseId === "kroki" && s.step === name);
    expect(step("lookups")).toMatchObject({ status: "skipped" });
    expect(step("lookups")?.detail).toMatch(/offline/);
    expect(step("asr")).toMatchObject({ status: "skipped" });
    expect(step("clip")?.detail).toBeTruthy();
    expect(res.steps.some((s) => s.status === "start")).toBe(false);
  });
});
