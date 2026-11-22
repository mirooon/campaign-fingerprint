/**
 * GET /api/build-base → `{ summary, question, refusal }`: what the current base holds and the replacement question.
 * POST /api/build-base (multipart/form-data) files (folder of cases: one subfolder per case, or ZIPs), confirm=1
 * builds a new base of known campaigns in the viewer's base folder (`bun run base`, offline). Without `confirm=1` an
 * existing base answers 409 with the question. The previous base is set aside to `.poprzednia-baza-<stamp>` and
 * restored when the build fails. The bundled sample base is read-only (403).
 */
import { execFile } from "node:child_process";
import { readdir, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { baseSummary, buildBaseRefusal, replaceQuestion, restoreBase, setAsideBase } from "@/lib/viewer/buildBase";
import { DATA_DIR, SAMPLE_BASE } from "@/lib/viewer/data";
import { rateLimitResponse } from "@/lib/viewer/rateLimit";
import { maxBytes } from "@/lib/viewer/upload";

const MAX_FILES = 4000;

/** Runs a command; resolves to its exit code (null on a signal or timeout) and stderr. */
function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, killSignal: "SIGKILL" }, (err, _stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : null) : 0;
      resolve({ code, stderr: String(stderr ?? "") });
    });
  });
}

/** Relative path of an uploaded file inside the cases folder, or null when it tries to leave it. */
function safeRelative(name: string): string | null {
  const parts = name.replace(/\\/g, "/").split("/").filter((p) => p && p !== ".");
  if (!parts.length || parts.some((p) => p === ".." || p.includes("\0"))) return null;
  return parts.join("/");
}

/** A folder upload puts everything under one top folder: the cases are that folder's subfolders. */
async function flattenSingleTop(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory()) return;
  const top = path.join(dir, entries[0].name);
  for (const e of await readdir(top)) await rename(path.join(top, e), path.join(dir, e));
  await rm(top, { recursive: true, force: true });
}

/** Loose files at the top of the cases folder form one case of their own (`sprawa-1`). */
async function gatherLooseFiles(dir: string): Promise<void> {
  const loose = (await readdir(dir, { withFileTypes: true })).filter((e) => !e.isDirectory());
  if (!loose.length) return;
  await mkdir(path.join(dir, "sprawa-1"), { recursive: true });
  for (const e of loose) await rename(path.join(dir, e.name), path.join(dir, "sprawa-1", e.name));
}

/** GET /api/build-base: the current base and the replacement question. */
export async function GET(): Promise<Response> {
  const summary = baseSummary(DATA_DIR);
  return Response.json({ summary, question: replaceQuestion(summary), refusal: buildBaseRefusal(SAMPLE_BASE) }, { headers: { "cache-control": "no-store" } });
}

/** POST /api/build-base: builds the new base; 400 bad upload, 403 sample base, 409 replacement not confirmed, 500 failed build. */
export async function POST(request: Request): Promise<Response> {
  const limited = rateLimitResponse(request);
  if (limited) return limited;
  const refusal = buildBaseRefusal(SAMPLE_BASE);
  if (refusal) return Response.json({ error: refusal }, { status: 403 });
  if (Number(request.headers.get("content-length")) > maxBytes()) return Response.json({ error: `Wgrane pliki przekraczają limit ${Math.round(maxBytes() / 1024 / 1024)} MB` }, { status: 413 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Oczekiwano multipart/form-data" }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string" && f.size > 0);
  if (!files.length) return Response.json({ error: "Dodaj folder spraw (jeden podfolder na sprawę) albo ZIP" }, { status: 400 });
  if (files.length > MAX_FILES) return Response.json({ error: `Za dużo plików (maks. ${MAX_FILES})` }, { status: 400 });
  const summary = baseSummary(DATA_DIR);
  if (summary.exists && form.get("confirm") !== "1") return Response.json({ error: "Potwierdź zastąpienie bazy", question: replaceQuestion(summary) }, { status: 409 });

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const casesDir = path.join(process.cwd(), ".cache", "uploads", `baza-${stamp}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(casesDir, { recursive: true });
  try {
    for (const f of files) {
      const rel = safeRelative(f.name);
      if (!rel) continue;
      const dest = path.join(casesDir, rel);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, Buffer.from(await f.arrayBuffer()));
      if (/\.zip$/i.test(rel)) {
        const r = await run("unzip", ["-qq", "-o", dest, "-d", path.dirname(dest)], 120_000);
        if (r.code !== 0) return Response.json({ error: `Nie udało się rozpakować ${rel}` }, { status: 400 });
        await rm(dest, { force: true });
      }
    }
    await flattenSingleTop(casesDir);
    await gatherLooseFiles(casesDir);
  } catch (e) {
    return Response.json({ error: `Nie udało się zapisać wgranych plików: ${(e as Error).message}` }, { status: 500 });
  }

  const backup = setAsideBase(DATA_DIR, stamp);
  const r = await run(process.env.BUN_BIN ?? "bun", ["scripts/base.ts", "--cases", casesDir, "--out", DATA_DIR, "--offline"], 1_800_000);
  const after = baseSummary(DATA_DIR);
  if (r.code !== 0 || !after.exists) {
    restoreBase(DATA_DIR, backup);
    return Response.json({ error: `Budowa bazy nie powiodła się, poprzednia baza wróciła na miejsce: ${r.stderr.split("\n").filter(Boolean).slice(-3).join(" | ")}` }, { status: 500 });
  }
  return Response.json({ summary: after, backup: backup ? path.basename(backup) : null }, { headers: { "cache-control": "no-store" } });
}
