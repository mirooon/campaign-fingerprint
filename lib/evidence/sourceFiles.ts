/**
 * Input files of a case in the evidence pack: what each file is (Polish role names), which folder of
 * the pack it goes to, and which of them are not copied as they are. Pure; the copying and hashing
 * of the pack stay in pack.ts and caseFiles.ts.
 */
import { redactHar, redactPageHtml } from "../osint/redact";
import type { CaseFileRecord, CaseFileRole } from "../pipeline/caseFiles";

/** provenance.json of an import: the part the pack reads. */
export interface PackProvenance {
  generatedAt: string;
  cases: Array<{ id: string; files?: CaseFileRecord[]; importedAt?: string }>;
}

export const SOURCE_FILE_LABEL: Record<CaseFileRole, string> = {
  har: "browser traffic record (HAR)",
  saved_html: "saved page (HTML)",
  screenshot: "screenshot of the ad",
  more_screenshot: "further screenshot of the ad",
  page_screenshot: "screenshot of the landing page",
  video: "recording of the ad",
  page_video: "video from the landing page (stitched from HLS)",
  info_json: "description of the recording (.info.json)",
};

/** Folder of the pack for a file role; HAR and saved pages go there only as redacted copies (REDACTORS). */
export const SOURCE_FILE_DIR: Record<CaseFileRole, string | null> = {
  har: "files/har",
  saved_html: "files/html-source",
  screenshot: "files/screenshots",
  more_screenshot: "files/screenshots",
  page_screenshot: "files/screenshots",
  video: "files/media",
  page_video: "files/media",
  info_json: "files/info",
};

/** Records of a case by item id; none when the import left no provenance. */
export function caseFilesOf(provenance: PackProvenance | null | undefined, itemId: string): { files: CaseFileRecord[]; importedAt: string | null } {
  const c = provenance?.cases.find((x) => x.id === itemId);
  return { files: c?.files ?? [], importedAt: c?.importedAt ?? provenance?.generatedAt ?? null };
}

/**
 * Roles whose original is never copied: a HAR and a saved page carry the analyst's cookies, headers
 * and visit data, so the pack gets a redacted copy and the manifest the hash of the original next to it.
 * Each function takes the text of the original and returns the text of the copy.
 */
export const REDACTORS: Partial<Record<CaseFileRole, (text: string) => string>> = {
  har: (text) => redactHar(text).text,
  saved_html: (text) => redactPageHtml(text).text,
};
