/**
 * Edge of the analyst's decisions (B-282): reads and writes the decisions file. A write goes through a temporary
 * file and a rename, so an interrupted write leaves the old file; a broken file is reported, never overwritten.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, SAMPLE_BASE } from "./data";
import { decisionsFilePath, setDecision, type Decision, type DecisionsFile } from "./decisions";
import { workRoot } from "./jobs";

export type DecisionsResult = { ok: true; file: DecisionsFile } | { ok: false; error: string };

/** The decisions in `file`; a missing file means no decisions yet, an unreadable one a message with the reason. */
export function loadDecisions(file: string): DecisionsResult {
  if (!existsSync(file)) return { ok: true, file: { version: 1, decisions: {} } };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as DecisionsFile;
    if (parsed.version !== 1 || typeof parsed.decisions !== "object" || parsed.decisions === null) throw new Error("nieznany układ pliku");
    return { ok: true, file: parsed };
  } catch (e) {
    return { ok: false, error: `Nie udało się odczytać ${path.basename(file)} (${(e as Error).message}). Plik został nietknięty: napraw go albo usuń.` };
  }
}

/** Sets (or, with null, removes) the decision of a campaign and writes the file; returns the new content or the reason it failed. */
export function saveDecision(file: string, campaign: string, status: Decision | null, now: Date = new Date()): DecisionsResult {
  const current = loadDecisions(file);
  if (!current.ok) return current;
  const next = setDecision(current.file, campaign, status, now);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    renameSync(tmp, file);
    return { ok: true, file: next };
  } catch (e) {
    return { ok: false, error: `Nie udało się zapisać decyzji: ${(e as Error).message}` };
  }
}

/** Decisions file of the base the viewer shows (see `decisionsFilePath`). */
export function currentDecisionsFile(): string {
  return decisionsFilePath({ dataDir: DATA_DIR, sampleBase: SAMPLE_BASE, workRoot: workRoot() });
}
