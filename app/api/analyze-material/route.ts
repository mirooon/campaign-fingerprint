/**
 * POST /api/analyze-material (multipart/form-data)
 *   files: the material of one case (screenshots, saved page with its _files, HAR, video, yt-dlp .info.json, zip);
 *          the file name may carry a relative path (folder upload)
 *   url, text: optional link and ad text
 *   live=1: passive lookups and one GET for a page the material does not hold; asr=1: transcribe videos
 * Runs `scripts/analyze-material.ts` in a child process (media tools and native models stay out of the
 * server bundle) against the run the viewer shows, and returns its result.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MaterialResult } from "@/lib/pipeline/analyzeMaterial";
import { DATA_DIR } from "@/lib/viewer/data";

const MAX_FILES = 400;

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, killSignal: "SIGKILL" }, (err, _stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : null) : 0;
      resolve({ code, stderr: String(stderr ?? "") });
    });
  });
}

/** Relative path of an uploaded file inside the case folder, or null when it tries to leave it. */
function safeRelative(name: string): string | null {
  const parts = name.replace(/\\/g, "/").split("/").filter((p) => p && p !== ".");
  if (!parts.length || parts.some((p) => p === ".." || p.includes("\0"))) return null;
  return parts.join("/");
}

/** A folder upload puts everything under one top folder: the case is that folder's content. */
async function flattenSingleTop(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory() || entries[0].name.endsWith("_files")) return;
  const top = path.join(dir, entries[0].name);
  for (const e of await readdir(top)) await rename(path.join(top, e), path.join(dir, e));
  await rm(top, { recursive: true, force: true });
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Oczekiwano multipart/form-data" }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string" && f.size > 0);
  const url = String(form.get("url") ?? "").trim().slice(0, 2048);
  const text = String(form.get("text") ?? "").trim().slice(0, 5000);
  if (!files.length && !url && !text) return Response.json({ error: "Dodaj pliki sprawy, link albo treść reklamy" }, { status: 400 });
  if (files.length > MAX_FILES) return Response.json({ error: `Za dużo plików (maks. ${MAX_FILES})` }, { status: 400 });
  if (!existsSync(path.join(DATA_DIR, "campaigns.json"))) return Response.json({ error: "Brak przebiegu do porównania (campaigns.json)" }, { status: 503 });

  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const root = path.join(process.cwd(), ".cache", "uploads", `${stamp}-${Math.random().toString(36).slice(2, 8)}`);
  const caseDir = path.join(root, `nowa-${stamp}`);
  await mkdir(caseDir, { recursive: true });
  try {
    for (const f of files) {
      const rel = safeRelative(f.name);
      if (!rel) continue;
      const dest = path.join(caseDir, rel);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, Buffer.from(await f.arrayBuffer()));
      if (/\.zip$/i.test(rel)) {
        // unzip skips entries that would leave the target folder
        const r = await run("unzip", ["-qq", "-o", dest, "-d", path.dirname(dest)], 120_000);
        if (r.code !== 0) return Response.json({ error: `Nie udało się rozpakować ${rel}` }, { status: 400 });
        await rm(dest, { force: true });
      }
    }
    await flattenSingleTop(caseDir);
    const out = path.join(root, "wynik.json");
    const args = ["scripts/analyze-material.ts", "--data", DATA_DIR, "--work", path.join(root, "praca"), "--out", out];
    if (files.length) args.push("--case", caseDir);
    if (url) args.push("--url", url);
    if (text) args.push("--text", text);
    if (form.get("live") === "1") args.push("--live");
    if (form.get("asr") === "1") args.push("--asr", "--audio");
    const sample = path.join(DATA_DIR, "sample", "fixtures");
    if (existsSync(sample)) args.push("--fixtures", sample);
    const r = await run(process.env.BUN_BIN ?? "bun", args, 600_000);
    if (r.code !== 0 || !existsSync(out)) {
      return Response.json({ error: `Analiza nie powiodła się: ${r.stderr.split("\n").filter(Boolean).slice(-3).join(" | ")}` }, { status: 500 });
    }
    const result = JSON.parse(await readFile(out, "utf8")) as MaterialResult;
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: `Analiza nie powiodła się: ${(e as Error).message}` }, { status: 500 });
  }
}
