/**
 * Upload sessions of the GUI analysis: the browser sends every file in its own request, streamed to
 * disk, so a batch of many GB never sits in memory (one multipart request of the whole batch would).
 * Flow: POST /api/material/upload → { uploadId }; PUT /api/material/upload/<id>?case=&path= per file;
 * POST /api/material with `uploadId` starts the analysis on the files already on disk.
 */
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { safeCaseName } from "./caseDetect";
import { newJobId, workRoot } from "./jobs";
import { extractZip, limitLabel, maxBytes, maxFiles, safeRelative, UploadError } from "./upload";

export interface UploadSession {
  id: string;
  dir: string;
  casesDir: string;
  bytes: number;
  files: number;
  /** files per case, in upload order of the cases */
  counts: Map<string, number>;
  /** absolute paths of uploaded ZIPs, unpacked when the analysis starts */
  zips: string[];
  createdAt: number;
}

const g = globalThis as unknown as { __uploadSessions?: Map<string, UploadSession> };
const sessions = (g.__uploadSessions ??= new Map());

/** ZIPs above this size are unpacked by a streaming extractor instead of in memory. */
const IN_MEMORY_ZIP_BYTES = 100 * 1024 * 1024;

/** New empty session with its folder under MATERIAL_WORK_DIR. */
export async function createUploadSession(): Promise<UploadSession> {
  const id = newJobId();
  const dir = path.join(workRoot(), id);
  const casesDir = path.join(dir, "sprawy");
  await mkdir(casesDir, { recursive: true });
  const s: UploadSession = { id, dir, casesDir, bytes: 0, files: 0, counts: new Map(), zips: [], createdAt: Date.now() };
  sessions.set(id, s);
  return s;
}

/** Session by id, or undefined for an unknown or malformed id. */
export function getUploadSession(id: string): UploadSession | undefined {
  return /^[a-z0-9-]{6,40}$/.test(id) ? sessions.get(id) : undefined;
}

/** Forgets a session (its folder now belongs to the analysis job). */
export function closeUploadSession(id: string): void {
  sessions.delete(id);
}

/**
 * Streams one file into the session: `rel` is its path inside the case `caseName`. Throws UploadError
 * on an unsafe path or when MATERIAL_MAX_MB / MATERIAL_MAX_FILES (unset = no limit) would be exceeded.
 */
export async function addUploadFile(s: UploadSession, caseName: string, rel: string, body: ReadableStream<Uint8Array> | null, declared: number): Promise<void> {
  const safe = safeRelative(rel);
  if (!safe) throw new UploadError(`File path not allowed: ${rel}`);
  if (s.files + 1 > maxFiles()) throw new UploadError(`Too many files (max. ${maxFiles()}, MATERIAL_MAX_FILES)`);
  const limit = maxBytes();
  if (s.bytes + Math.max(0, declared) > limit) throw new UploadError(`The files exceed the limit of ${limitLabel(limit)} (MATERIAL_MAX_MB)`);
  const name = safeCaseName(caseName || "case");
  const caseDir = path.join(s.casesDir, name);
  const dest = path.join(caseDir, safe);
  if (!dest.startsWith(caseDir + path.sep)) throw new UploadError(`File path not allowed: ${rel}`);
  await mkdir(path.dirname(dest), { recursive: true });
  if (body) await pipeline(Readable.fromWeb(body as unknown as WebReadableStream<Uint8Array>), createWriteStream(dest));
  else await writeFile(dest, "");
  const size = (await stat(dest)).size;
  s.bytes += size;
  s.files += 1;
  s.counts.set(name, (s.counts.get(name) ?? 0) + 1);
  if (/\.zip$/i.test(safe)) s.zips.push(dest);
  if (s.bytes > limit) throw new UploadError(`The files exceed the limit of ${limitLabel(limit)} (MATERIAL_MAX_MB)`);
}

/**
 * Unpacks a ZIP already on disk next to itself (folder named like the archive without .zip), keeping
 * entries inside `caseDir`, then removes the archive. Large archives go through a streaming extractor
 * (Python zipfile, which drops absolute and `..` parts) so they never sit in memory. The target folder
 * always exists afterwards, also for an archive with no usable entries (the caller flattens it).
 */
export async function unpackZipOnDisk(zipPath: string, caseDir: string, budget: number): Promise<number> {
  const target = path.join(path.dirname(zipPath), path.basename(zipPath).replace(/\.zip$/i, ""));
  await mkdir(target, { recursive: true });
  const size = (await stat(zipPath)).size;
  let written = 0;
  if (size <= IN_MEMORY_ZIP_BYTES) {
    const { entries } = extractZip(new Uint8Array(await readFile(zipPath)), { maxBytes: budget, maxFiles: maxFiles() });
    for (const e of entries) {
      const out = path.join(target, e.path);
      if (!out.startsWith(caseDir + path.sep)) continue;
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, e.data);
      written += e.data.length;
    }
  } else {
    written = await extractLargeZip(zipPath, target, budget);
  }
  await rm(zipPath, { force: true });
  return written;
}

const PY_EXTRACT = `
import sys, zipfile, os
src, dst, budget = sys.argv[1], sys.argv[2], float(sys.argv[3])
total = 0
with zipfile.ZipFile(src) as z:
    for i in z.infolist():
        n = i.filename.replace('\\\\', '/')
        if n.endswith('/') or n.startswith('__MACOSX') or '\\0' in n: continue
        parts = [p for p in n.split('/') if p and p not in ('.', '..')]
        if not parts or ':' in parts[0]: continue
        total += i.file_size
        if total > budget: sys.exit(3)
        z.extract(i, dst)
print(total)
`;

/** Streaming extraction of a big ZIP with Python's zipfile; returns the unpacked size. */
export function extractLargeZip(zipPath: string, target: string, budget: number): Promise<number> {
  const py = process.env.PYTHON_BIN || "python3";
  return new Promise((resolve, reject) => {
    execFile(py, ["-I", "-c", PY_EXTRACT, zipPath, target, String(Number.isFinite(budget) ? budget : 1e18)], { maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        const code = (err as { code?: unknown }).code;
        reject(new UploadError(code === 3 ? "The unpacked archive exceeds the limit (MATERIAL_MAX_MB)" : `Could not unpack the archive ${path.basename(zipPath)}: ${err.message}`));
        return;
      }
      resolve(Number(String(stdout).trim()) || 0);
    });
  });
}
