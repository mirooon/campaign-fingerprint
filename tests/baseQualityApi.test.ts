/**
 * GET /api/base-quality on a tiny base in a temporary folder: counts of gaps per check with provenance.json, and the
 * note about a partial picture without it.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clusterCampaigns } from "../lib/graph/cluster";
import type { EvidenceGraph, GraphNode } from "../lib/graph/model";
import type { BaseQuality } from "../lib/viewer/baseQuality";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const node = (key: string): GraphNode => ({ id: `item:${key}`, type: "item", key, label: key, df: 0, weight: null, strong: false, discounts: [], data: {}, campaignId: null });

function base(provenance: unknown): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "jakosc-"));
  dirs.push(dir);
  const graph: EvidenceGraph = { version: 1, generatedAt: "2026-01-01T00:00:00.000Z", mode: "offline", baseDir: ".", textMethod: "none", stats: { items: 2, nodes: 2, edges: 0, links: 0, strongLinks: 0, byType: {} }, nodes: [node("a"), node("b")], edges: [], links: [] };
  writeFileSync(path.join(dir, "graph.json"), JSON.stringify(graph));
  writeFileSync(path.join(dir, "campaigns.json"), JSON.stringify(clusterCampaigns(graph).campaigns));
  if (provenance) writeFileSync(path.join(dir, "provenance.json"), JSON.stringify(provenance));
  return dir;
}

describe("GET /api/base-quality", () => {
  it("z provenance.json liczy sprawy bez HAR i bez strony", async () => {
    vi.stubEnv("VIEWER_DATA_DIR", base({ cases: [{ id: "a", caseId: "a", landingUrl: "https://a.example/", bodySource: "har", har: "r.har", screenshot: "z.png" }, { id: "b", caseId: "b", landingUrl: "https://b.example/", bodySource: "none", har: null, screenshot: "z.png" }] }));
    const { GET } = await import("../app/api/base-quality/route");
    const q = (await (await GET()).json()) as BaseQuality;
    expect(q.total).toBe(2);
    expect(q.counts.find((c) => c.check === "har")?.missing).toBe(1);
    expect(q.counts.find((c) => c.check === "page")?.missing).toBe(1);
    expect(q.note).toBeNull();
  });
  it("bez provenance.json zwraca notatkę o niepełnym obrazie", async () => {
    vi.stubEnv("VIEWER_DATA_DIR", base(null));
    const { GET } = await import("../app/api/base-quality/route");
    expect(((await (await GET()).json()) as BaseQuality).note).toContain("provenance.json");
  });
  it("uszkodzony provenance.json to 500 z powodem", async () => {
    const dir = base(null);
    writeFileSync(path.join(dir, "provenance.json"), "{zepsute");
    vi.stubEnv("VIEWER_DATA_DIR", dir);
    const { GET } = await import("../app/api/base-quality/route");
    const res = await GET();
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toContain("provenance.json");
  });
});
