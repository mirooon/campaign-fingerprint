/**
 * Edge of the analyst's corrections (B-281): reads and changes `corrections.json` of the base the viewer shows.
 * `build-graph` applies the file on its next run (lib/graph/corrections.ts). A write goes through a temporary file
 * and a rename; a broken file is reported, never overwritten.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { emptyCorrections, parseCorrections, type CorrectionPair, type CorrectionsFile } from "../graph/corrections";
import { DATA_DIR, SAMPLE_BASE } from "./data";
import { workRoot } from "./jobs";

export type CorrectionsResult = { ok: true; file: CorrectionsFile } | { ok: false; error: string };

/** One change of the corrections: join, split ("this link is wrong"), disable a trace, or undo a pair/trace. */
export type CorrectionAction =
  | { action: "must"; a: string; b: string; note?: string }
  | { action: "cannot"; a: string; b: string; note?: string }
  | { action: "disable-pivot"; pivot: string; note?: string }
  | { action: "remove"; a?: string; b?: string; pivot?: string };

/** File of the corrections: `corrections.json` in the base's folder; for the bundled sample a file in the work folder. */
export function correctionsFilePath(o: { dataDir: string; sampleBase: boolean; workRoot: string }): string {
  return o.sampleBase ? path.join(o.workRoot, "corrections-probka.json") : path.join(o.dataDir, "corrections.json");
}

/** Corrections file of the base the viewer shows. */
export function currentCorrectionsFile(): string {
  return correctionsFilePath({ dataDir: DATA_DIR, sampleBase: SAMPLE_BASE, workRoot: workRoot() });
}

/** The corrections in `file`; a missing file means none, an unreadable one a message with the reason. */
export function loadCorrectionsFile(file: string): CorrectionsResult {
  if (!existsSync(file)) return { ok: true, file: emptyCorrections() };
  try {
    return { ok: true, file: parseCorrections(JSON.parse(readFileSync(file, "utf8"))) };
  } catch (e) {
    return { ok: false, error: `Could not read ${path.basename(file)} (${(e as Error).message}). The file was left untouched: fix it or delete it.` };
  }
}

/** Whether two pairs name the same ads in any order. */
function samePair(p: CorrectionPair, a: string, b: string): boolean {
  return (p.a === a && p.b === b) || (p.a === b && p.b === a);
}

/**
 * Applies one action to the corrections (pure). A pair lives in at most one list: joining removes an earlier split of
 * the same pair and the other way round; repeating an action does not duplicate it.
 */
export function applyCorrectionAction(file: CorrectionsFile, act: CorrectionAction, now: Date = new Date()): CorrectionsFile {
  const at = now.toISOString();
  const next: CorrectionsFile = { version: 1, mustLink: [...file.mustLink], cannotLink: [...file.cannotLink], disabledPivots: [...file.disabledPivots] };
  if (act.action === "disable-pivot") {
    if (!next.disabledPivots.some((d) => d.pivot === act.pivot)) next.disabledPivots.push({ pivot: act.pivot, ...(act.note ? { note: act.note } : {}), at });
    return next;
  }
  if (act.action === "remove") {
    if (act.pivot) next.disabledPivots = next.disabledPivots.filter((d) => d.pivot !== act.pivot);
    if (act.a && act.b) {
      next.mustLink = next.mustLink.filter((p) => !samePair(p, act.a!, act.b!));
      next.cannotLink = next.cannotLink.filter((p) => !samePair(p, act.a!, act.b!));
    }
    return next;
  }
  next.mustLink = next.mustLink.filter((p) => !samePair(p, act.a, act.b));
  next.cannotLink = next.cannotLink.filter((p) => !samePair(p, act.a, act.b));
  const pair = { a: act.a, b: act.b, ...(act.note ? { note: act.note } : {}), at };
  (act.action === "must" ? next.mustLink : next.cannotLink).push(pair);
  return next;
}

/** Applies one action to `file` on disk and writes it; returns the new content or the reason it failed. */
export function saveCorrectionAction(file: string, act: CorrectionAction, now: Date = new Date()): CorrectionsResult {
  const current = loadCorrectionsFile(file);
  if (!current.ok) return current;
  const next = applyCorrectionAction(current.file, act, now);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    renameSync(tmp, file);
    return { ok: true, file: next };
  } catch (e) {
    return { ok: false, error: `Could not save the correction: ${(e as Error).message}` };
  }
}
