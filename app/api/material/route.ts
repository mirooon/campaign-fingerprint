/**
 * POST /api/material (multipart/form-data) — starts an analysis job, returns { jobId }.
 *   files:  files of the material (screenshots, saved pages with _files, HAR, video, .info.json, ZIP)
 *   paths:  relative path of every file inside its case (one per file, same order; browsers cut names)
 *   cases:  case of every file (one per file, same order) — the split chosen in the preview
 *   url, text: optional link and ad text
 *   live=1: passive lookups (DNS, RDAP) for the domains of the material; asr=1: transcribe videos
 * The case split is computed in the browser (lib/viewer/caseDetect.ts). Files go to
 * MATERIAL_WORK_DIR/<job>/sprawy/<case>/; ZIPs are unpacked there with size and path checks.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeCaseName } from "@/lib/viewer/caseDetect";
import { DATA_DIR, SAMPLE_BASE } from "@/lib/viewer/data";
import { rateLimitResponse } from "@/lib/viewer/rateLimit";
import { newJobId, registerJob, startJob, workRoot, type Job, type JobCase } from "@/lib/viewer/jobs";
import { extractZip, MAX_FILES, maxBytes, safeRelative, UploadError } from "@/lib/viewer/upload";

/** A case folder holding one top folder only: its content is the case (folder upload, ZIP of a folder). */
async function flattenSingleTop(dir: string): Promise<void> {
  const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => !e.name.startsWith("."));
  if (entries.length !== 1 || !entries[0].isDirectory() || entries[0].name.endsWith("_files")) return;
  const top = path.join(dir, entries[0].name);
  const inner = await readdir(top);
  if (inner.includes("manifest.json") && inner.includes("dom.html")) return;
  for (const e of inner) await rename(path.join(top, e), path.join(dir, e));
  await rm(top, { recursive: true, force: true });
}

export async function POST(request: Request): Promise<Response> {
  const limited = rateLimitResponse(request);
  if (limited) return limited;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Oczekiwano multipart/form-data" }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string" && f.size > 0);
  const paths = form.getAll("paths").map(String);
  const caseNames = form.getAll("cases").map(String);
  const url = String(form.get("url") ?? "").trim().slice(0, 2048);
  const text = String(form.get("text") ?? "").trim().slice(0, 5000);
  // ANALYZE_OFFLINE=1 (the container default) switches the passive lookups off whatever the form asks for.
  const live = form.get("live") !== "0" && process.env.ANALYZE_OFFLINE !== "1";
  if (!files.length && !url && !text) return Response.json({ error: "Dodaj pliki, link albo tekst reklamy" }, { status: 400 });
  if (files.length > MAX_FILES) return Response.json({ error: `Za dużo plików (maks. ${MAX_FILES})` }, { status: 400 });
  const limit = maxBytes();
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > limit) return Response.json({ error: `Pliki mają razem ${Math.round(total / 1024 / 1024)} MB, limit to ${Math.round(limit / 1024 / 1024)} MB (MATERIAL_MAX_MB)` }, { status: 413 });
  if (!existsSync(path.join(DATA_DIR, "campaigns.json"))) return Response.json({ error: "Brak bazy porównawczej (campaigns.json). Uruchom: bun run pipeline --offline" }, { status: 503 });

  const id = newJobId();
  const dir = path.join(workRoot(), id);
  const casesDir = path.join(dir, "sprawy");
  const counts = new Map<string, number>();
  try {
    await mkdir(casesDir, { recursive: true });
    let unpacked = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const rel = safeRelative(paths[i] || f.name);
      if (!rel) continue;
      const caseName = safeCaseName(caseNames[i] || "sprawa");
      const caseDir = path.join(casesDir, caseName);
      const dest = path.join(caseDir, rel);
      if (!dest.startsWith(caseDir + path.sep)) continue;
      await mkdir(path.dirname(dest), { recursive: true });
      const data = new Uint8Array(await f.arrayBuffer());
      counts.set(caseName, (counts.get(caseName) ?? 0) + 1);
      if (/\.zip$/i.test(rel)) {
        const { entries } = extractZip(data, { maxBytes: limit - unpacked, maxFiles: MAX_FILES });
        const target = path.join(path.dirname(dest), path.basename(rel).replace(/\.zip$/i, ""));
        for (const e of entries) {
          const out = path.join(target, e.path);
          if (!out.startsWith(caseDir + path.sep)) continue;
          unpacked += e.data.length;
          await mkdir(path.dirname(out), { recursive: true });
          await writeFile(out, e.data);
        }
        await flattenSingleTop(target);
      } else {
        await writeFile(dest, data);
      }
    }
    const caseDirs: string[] = [];
    for (const name of counts.keys()) {
      await flattenSingleTop(path.join(casesDir, name));
      caseDirs.push(path.join(casesDir, name));
    }
    const cases: JobCase[] = [...counts.entries()].map(([name, n]) => ({ name, status: "waiting", steps: [], files: n }));
    const job: Job = { id, createdAt: new Date().toISOString(), status: "running", cases, log: [], dir, live, fileCount: files.length, together: caseDirs.length > 1 };
    registerJob(job);
    const fixtures = path.join(DATA_DIR, "sample", "fixtures");
    await startJob(job, {
      dataDir: DATA_DIR,
      sampleBase: SAMPLE_BASE,
      caseDirs,
      url: url || undefined,
      text: text || undefined,
      live,
      asr: form.get("asr") === "1",
      fixtures: existsSync(fixtures) ? fixtures : undefined,
      config: process.env.LINK_CONFIG || undefined,
      personas: process.env.PERSONAS_FILE || undefined,
    });
    return Response.json({ jobId: id });
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    const status = e instanceof UploadError ? 400 : 500;
    return Response.json({ error: e instanceof UploadError ? e.message : `Nie udało się przyjąć plików: ${(e as Error).message}` }, { status });
  }
}
