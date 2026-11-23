/**
 * "Build a new base" in the viewer (B-284): builds a fresh base of known campaigns from uploaded cases and, after the
 * analyst confirmed the replacement, swaps it in. The previous base is never deleted: it is moved to a hidden folder
 * `.poprzednia-baza-<stamp>` inside the base folder. The bundled sample base is read-only.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";

/** What the current base holds, shown in the replacement confirmation. */
export interface BaseSummary {
  exists: boolean;
  campaigns: number;
  materials: number;
}

/** Why the base cannot be rebuilt from the GUI, or null when it can. */
export function buildBaseRefusal(sampleBase: boolean): string | null {
  return sampleBase ? "The sample base is read-only. To build a base of your own, start the viewer with VIEWER_DATA_DIR pointing at an empty folder or one of your own." : null;
}

/** Counts campaigns (≥ 2 materials) and materials of the base in `dataDir`; an unreadable campaigns file counts as no base. */
export function baseSummary(dataDir: string): BaseSummary {
  const file = path.join(dataDir, "campaigns.json");
  if (!existsSync(file)) return { exists: false, campaigns: 0, materials: 0 };
  try {
    const c = JSON.parse(readFileSync(file, "utf8")) as { campaigns?: Array<{ size?: number }>; assignments?: Record<string, string> };
    return { exists: true, campaigns: (c.campaigns ?? []).filter((x) => (x.size ?? 0) > 1).length, materials: Object.keys(c.assignments ?? {}).length };
  } catch {
    return { exists: false, campaigns: 0, materials: 0 };
  }
}

/** Sentence of the replacement confirmation for the current base. */
export function replaceQuestion(s: BaseSummary): string {
  if (!s.exists) return "There is no base yet: the new base will be created in the base folder.";
  return `The new base will replace the current one (${s.campaigns} ${s.campaigns === 1 ? "campaign" : "campaigns"}, ${s.materials} ${s.materials === 1 ? "sample" : "samples"}). We will move the previous one to the hidden folder .poprzednia-baza-…, nothing will be deleted.`;
}

/**
 * Moves the current base's entries (everything but hidden entries) of `dataDir` to `.poprzednia-baza-<stamp>`, so a new
 * base can be built in place (paths inside a base stay valid). Returns that folder, or null when there was nothing to keep.
 */
export function setAsideBase(dataDir: string, stamp: string): string | null {
  mkdirSync(dataDir, { recursive: true });
  const old = readdirSync(dataDir).filter((e) => !e.startsWith("."));
  if (!old.length) return null;
  const backup = path.join(dataDir, `.poprzednia-baza-${stamp}`);
  mkdirSync(backup, { recursive: true });
  for (const e of old) renameSync(path.join(dataDir, e), path.join(backup, e));
  return backup;
}

/** Undoes `setAsideBase` after a failed build: drops what the build left (non-hidden entries) and moves the previous base back. */
export function restoreBase(dataDir: string, backup: string | null): void {
  for (const e of readdirSync(dataDir).filter((x) => !x.startsWith("."))) rmSync(path.join(dataDir, e), { recursive: true, force: true });
  if (!backup) return;
  for (const e of readdirSync(backup)) renameSync(path.join(backup, e), path.join(dataDir, e));
  rmSync(backup, { recursive: true, force: true });
}
