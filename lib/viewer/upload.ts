/**
 * Upload safety for the job API: relative paths that cannot leave the case folder, and ZIP
 * extraction with limits (size, number of entries, compression ratio) against zip-slip and zip bombs.
 */
import { unzipSync } from "fflate";

/** A ZIP entry may not expand more than this many times (zip bomb). */
export const MAX_RATIO = 200;

/**
 * Upload size limit in bytes. Unset (local use, the container) means no limit: evaluators may
 * bring many GB of material. Set MATERIAL_MAX_MB only when the app is exposed publicly.
 */
export function maxBytes(): number {
  const mb = Number(process.env.MATERIAL_MAX_MB || 0);
  return Number.isFinite(mb) && mb > 0 ? mb * 1024 * 1024 : Number.POSITIVE_INFINITY;
}

/** Limit on the number of uploaded files (MATERIAL_MAX_FILES); unset means no limit. */
export function maxFiles(): number {
  const n = Number(process.env.MATERIAL_MAX_FILES || 0);
  return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}

/** Human-readable limit for error messages. */
export function limitLabel(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

/** Relative path inside the case folder, or null when it tries to leave it (zip-slip, absolute, drive letter, NUL). */
export function safeRelative(name: string): string | null {
  if (!name || name.includes("\0")) return null;
  const norm = name.replace(/\\/g, "/");
  if (norm.startsWith("/") || /^[a-zA-Z]:/.test(norm)) return null;
  const parts = norm.split("/").filter((p) => p && p !== ".");
  if (!parts.length || parts.some((p) => p === "..")) return null;
  if (parts[0] === "__MACOSX") return null;
  return parts.join("/");
}

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

export class UploadError extends Error {}

/**
 * Entries of a ZIP, checked before decompression (declared sizes) and after (real sizes).
 * Unsafe names are skipped and reported; limits throw UploadError.
 */
export function extractZip(buf: Uint8Array, limits: { maxBytes: number; maxFiles: number } = { maxBytes: maxBytes(), maxFiles: maxFiles() }): { entries: ZipEntry[]; rejected: string[] } {
  let declared = 0;
  let count = 0;
  const rejected: string[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf, {
      filter: (f) => {
        if (f.name.endsWith("/")) return false;
        const rel = safeRelative(f.name);
        if (!rel) {
          if (!f.name.startsWith("__MACOSX")) rejected.push(f.name);
          return false;
        }
        count += 1;
        declared += f.originalSize;
        if (count > limits.maxFiles) throw new UploadError(`Za dużo plików w archiwum (maks. ${limits.maxFiles})`);
        if (declared > limits.maxBytes) throw new UploadError(`Archiwum po rozpakowaniu przekracza limit ${limitLabel(limits.maxBytes)}`);
        if (f.size > 0 && f.originalSize / f.size > MAX_RATIO && f.originalSize > 10 * 1024 * 1024) throw new UploadError(`Podejrzanie silna kompresja pliku ${rel} (możliwa bomba ZIP)`);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof UploadError) throw e;
    throw new UploadError(`Nie udało się rozpakować archiwum: ${(e as Error).message}`);
  }
  let real = 0;
  const entries: ZipEntry[] = [];
  for (const [name, data] of Object.entries(files)) {
    real += data.length;
    if (real > limits.maxBytes) throw new UploadError(`Archiwum po rozpakowaniu przekracza limit ${limitLabel(limits.maxBytes)}`);
    entries.push({ path: safeRelative(name)!, data });
  }
  return { entries, rejected };
}
