/**
 * Checksums of the input files of a case (HAR, saved page, screenshots, video, yt-dlp description)
 * taken at import: they show later that the files in an evidence pack are the files the analyst
 * handed over. The only file access of the case provenance; a file that cannot be read stays in
 * the list with the reason, so a gap in the record is visible.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

export type CaseFileRole = "har" | "saved_html" | "screenshot" | "more_screenshot" | "page_screenshot" | "video" | "info_json";

export interface CaseFileRecord {
  role: CaseFileRole;
  /** Absolute path as at import. */
  path: string;
  /** Null when the file could not be read (see `error`). */
  sha256: string | null;
  size: number;
  /** Modification time of the file (UTC ISO): the closest thing to "acquired" the file system keeps. */
  modifiedUtc: string | null;
  error: string | null;
}

/** SHA-256, size and modification time of each listed file. */
export function hashCaseFiles(entries: Array<{ role: CaseFileRole; file: string }>): CaseFileRecord[] {
  return entries.map(({ role, file }) => {
    try {
      const data = readFileSync(file);
      return { role, path: file, sha256: createHash("sha256").update(data).digest("hex"), size: data.length, modifiedUtc: statSync(file).mtime.toISOString(), error: null };
    } catch (e) {
      return { role, path: file, sha256: null, size: 0, modifiedUtc: null, error: (e as Error).message };
    }
  });
}
