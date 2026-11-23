/**
 * `bun run demo` offline: every verdict, the dead page (only a screenshot) and the evolving campaign
 * (three pages, other faces and domains, one back end -> one campaign), and the same result on a re-run.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { MaterialItemResult, MaterialResult } from "../lib/pipeline/analyzeMaterial";
import { runDemo } from "../lib/pipeline/demoScenario";
import { SAMPLE } from "./sampleRun";

let root: string;
let result: MaterialResult;
const item = (id: string): MaterialItemResult => result.items.find((i) => i.id === id)!;
const evolution = () => result.items.filter((i) => i.id.startsWith("6-evolution"));

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "demo-"));
  ({ result } = await runDemo(SAMPLE, path.join(root, "a")));
}, 180_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("demo batch", () => {
  it("gives every verdict once, in a batch of 8", () => {
    expect(result.items).toHaveLength(8);
    expect(item("1-known-campaign").verdict).toBe("known_campaign");
    expect(item("1-known-campaign").campaign).toBeTruthy();
    expect(item("2-similar-campaigns").verdict).toBe("similar_campaigns");
    expect(item("2-similar-campaigns").similarCampaigns.length).toBeGreaterThanOrEqual(2);
    expect(item("3-duplicate")).toMatchObject({ verdict: "duplicate", duplicateOf: { id: "base-c2-a" } });
    expect(item("4-insufficient-data").verdict).toBe("insufficient");
    expect(item("4-insufficient-data").missing?.length).toBeGreaterThan(0);
    expect(item("5-dead-page").verdict).toBe("new_campaign");
  });

  it("dead page: no HTML, the address comes from the screenshot, RDAP, DNS and the host from recorded answers, and the result says what is missing", () => {
    const dead = item("5-dead-page");
    expect(dead.features.observedUrls).toEqual(["martwa-oferta.example.com"]);
    const types = (dead.pivots ?? []).map((p) => p.type);
    expect(types).toEqual(expect.arrayContaining(["host", "ip", "registrar", "domain"]));
    expect(dead.missing).toContain("HAR file from a visit to the page");
    const steps = result.steps.filter((s) => s.caseId === "5-dead-page");
    expect(steps.find((s) => s.step === "address_bar")?.status).toBe("done");
    expect(steps.find((s) => s.step === "lookups")?.status).toBe("done");
    expect(steps.find((s) => s.step === "asr")).toMatchObject({ status: "skipped" });
  });

  it("evolving campaign: three pages with other faces and domains are one campaign through the back end", () => {
    const pages = evolution();
    expect(pages).toHaveLength(3);
    expect(new Set(pages.map((p) => p.newCampaign)).size).toBe(1);
    expect(result.newCampaigns).toHaveLength(1);
    expect(result.newCampaigns![0].members).toEqual(pages.map((p) => p.id));
    expect(new Set(pages.map((p) => (p.features.personas as string[])[0])).size).toBe(3);
    expect(new Set(pages.map((p) => String(p.features.finalUrl ?? p.features.landingUrl).split("/")[2])).size).toBe(3);
    const evidence = result.newCampaigns![0].evidence.join(" | ");
    expect(evidence).toMatch(/tracker server/);
    expect(evidence).toMatch(/page-builder account/);
    expect(evidence).toMatch(/backend .*client/);
  });

  it("gives the same result on a second run", async () => {
    const again = await runDemo(SAMPLE, path.join(root, "b"));
    const strip = (r: MaterialResult) => JSON.stringify({ items: r.items, newCampaigns: r.newCampaigns, steps: r.steps });
    expect(strip(again.result)).toBe(strip(result));
    expect(readFileSync(path.join(root, "a", "wynik", "wynik.csv"), "utf8")).toBe(readFileSync(path.join(root, "b", "wynik", "wynik.csv"), "utf8"));
  }, 180_000);
});
