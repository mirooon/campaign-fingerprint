/**
 * GET /api/threshold-preview on a tiny base in a temporary folder: the rows follow the threshold, and a folder
 * without a base answers 503 with a message.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clusterCampaigns } from "../lib/graph/cluster";
import type { EvidenceGraph, GraphNode, ItemLink } from "../lib/graph/model";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const node = (key: string): GraphNode => ({ id: `item:${key}`, type: "item", key, label: key, df: 1, weight: null, strong: false, discounts: [], data: {}, campaignId: null });
const link = (a: string, b: string, score: number): ItemLink => ({ a, b, score, strong: false, evidence: [{ kind: "pivot", pivot: "tracker:t", pivotType: "tracker", edgeType: null, weight: score, strong: false, discounted: false, evidence: "wspólny tracker", pathA: [], pathB: [] }] });

function base(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "progi-"));
  dirs.push(dir);
  const graph: EvidenceGraph = { version: 1, generatedAt: "2026-01-01T00:00:00.000Z", mode: "offline", baseDir: ".", textMethod: "none", stats: { items: 4, nodes: 4, edges: 0, links: 2, strongLinks: 0, byType: {} }, nodes: ["a", "b", "c", "d"].map(node), edges: [], links: [link("a", "b", 0.5), link("c", "d", 0.2)] };
  writeFileSync(path.join(dir, "graph.json"), JSON.stringify(graph));
  writeFileSync(path.join(dir, "campaigns.json"), JSON.stringify(clusterCampaigns(graph).campaigns));
  return dir;
}

describe("GET /api/threshold-preview", () => {
  it("zwraca wiersze dla progów, z aktualnym progiem bazy", async () => {
    vi.stubEnv("VIEWER_DATA_DIR", base());
    const { GET } = await import("../app/api/threshold-preview/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { current: number; rows: Array<{ value: number; campaigns: number }> };
    expect(body.rows.map((r) => r.value)).toContain(body.current);
    expect(body.rows.find((r) => r.value === 0.15)?.campaigns).toBe(2);
    expect(body.rows.find((r) => r.value === 0.3)?.campaigns).toBe(1);
  });
  it("bez bazy odpowiada 503 z komunikatem", async () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), "progi-puste-"));
    dirs.push(empty);
    vi.stubEnv("VIEWER_DATA_DIR", empty);
    const { GET } = await import("../app/api/threshold-preview/route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain("No base");
  });
});
