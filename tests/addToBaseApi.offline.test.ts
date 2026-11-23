/**
 * POST /api/add-to-base on the synthetic sample, always on a copy of the base in a temporary folder (never on
 * data/): a new material of a new campaign is added through the route, and the next material of that campaign is
 * then a known campaign. The bundled sample base itself is refused (403), a bad body is 400.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { analyzeMaterial, type AnalyzedMaterial } from "../lib/pipeline/analyzeMaterial";
import { runBase, type MediaAvailability } from "../lib/pipeline/base";
import { writeSampleCases } from "../lib/pipeline/sampleCases";
import { saveCaptured } from "../lib/viewer/addToBaseJob";
import type { Job, JobResult } from "../lib/viewer/jobs";
import { SAMPLE } from "./sampleRun";

let root: string;
let baza: string;
const quiet = () => undefined;
const off = { available: false, reason: "wyłączone w teście" };
const noTools = async (): Promise<MediaAvailability> => ({ ocr: off, asr: off, audio: off, clip: off });
const post = (body: unknown) => new Request("http://localhost/api/add-to-base", { method: "POST", body: JSON.stringify(body) });

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "add-to-base-api-"));
  const cases = path.join(root, "sprawy");
  writeSampleCases(SAMPLE, cases, [
    { name: "c1-a", itemId: "c1-01" }, { name: "c1-b", itemId: "c1-02" },
    { name: "c2-a", itemId: "c2-01" }, { name: "c2-b", itemId: "c2-04" },
    { name: "c4-a", itemId: "c4-01" }, { name: "c4-b", itemId: "c4-02" },
  ]);
  writeSampleCases(SAMPLE, path.join(root, "nowe"), [{ name: "n1", itemId: "c3-07" }, { name: "n2", itemId: "c3-08" }]);
  baza = path.join(root, "baza");
  await runBase({ casesDir: cases, outDir: baza, offline: true, detect: noTools, log: quiet });
}, 120_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("POST /api/add-to-base", () => {
  it("baza przykładowa (bez VIEWER_DATA_DIR) jest tylko do odczytu: 403 z opisem", async () => {
    const { POST } = await import("../app/api/add-to-base/route");
    const res = await POST(post({ jobId: "20261122000000-abc123", ids: ["n1"] }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain("VIEWER_DATA_DIR");
  });

  it("zły body to 400, nieznane zadanie to 404", async () => {
    vi.stubEnv("VIEWER_DATA_DIR", baza);
    const { POST } = await import("../app/api/add-to-base/route");
    expect((await POST(post({ ids: [] }))).status).toBe(400);
    expect((await POST(post({ jobId: "20261122000000-zzz999", ids: ["n1"] }))).status).toBe(404);
  });

  it("dodaje materiał z zadania do bazy; drugi materiał tej kampanii jest potem znany; powtórka jest pominięta z powodem", async () => {
    vi.stubEnv("VIEWER_DATA_DIR", baza);
    const jobDir = path.join(root, "zadanie");
    const workDir = path.join(jobDir, "praca");
    mkdirSync(workDir, { recursive: true });
    let captured: AnalyzedMaterial | undefined;
    const result = await analyzeMaterial({ caseDir: path.join(root, "nowe", "n1") }, { dataDir: baza, workDir, media: { ocr: false }, log: quiet, onAnalyzed: (a) => { captured = a; saveCaptured(workDir, a); } });
    expect(captured).toBeDefined();
    expect(result.items[0].verdict).toBe("new_campaign");
    const { registerJob } = await import("../lib/viewer/jobs");
    const job: Job = { id: "20261122000000-abc123", createdAt: "2026-11-22T10:00:00Z", status: "done", cases: [], log: [], result: { ...result, lookups: false, fileCount: 1 } satisfies JobResult, dir: jobDir, live: false, fileCount: 1, together: false };
    registerJob(job);

    const { POST } = await import("../app/api/add-to-base/route");
    const res = await POST(post({ jobId: job.id, ids: [result.items[0].id] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { added: Array<{ id: string }> }; messages: string[] };
    expect(body.result.added.map((a) => a.id)).toEqual([result.items[0].id]);
    expect(body.messages[0]).toMatch(/^Dodano do bazy 1 sample: n1 \(nowa kampania K\d+\)\.$/);

    const second = await analyzeMaterial({ caseDir: path.join(root, "nowe", "n2") }, { dataDir: baza, workDir: path.join(root, "w2"), media: { ocr: false }, log: quiet });
    expect(second.items[0].verdict).toBe("known_campaign");

    const again = await POST(post({ jobId: job.id, ids: [result.items[0].id] }));
    const repeated = (await again.json()) as { messages: string[] };
    expect(repeated.messages).toEqual(["Nic nie dodano do bazy.", expect.stringContaining("Nie dodano n1")]);
  }, 180_000);
});
