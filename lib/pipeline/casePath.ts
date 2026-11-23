/**
 * Where a case file named in a run lives on this computer. Pure (the caller passes `exists`), so it can be tested.
 * A run built here keeps absolute paths; the non-public data pack keeps paths relative to the evaluator's own copy
 * of the cases (e.g. `sprawy/<case>/<file>`), which is found through CASES_DIR.
 */
import path from "node:path";

export interface CasePathContext {
  /** Folder the run's relative paths are resolved against first (the run itself, or the dataset folder). */
  baseDir: string;
  /** CASES_DIR: the evaluator's copy of the cases; empty when not set. */
  casesDir?: string;
  exists: (file: string) => boolean;
}

export type CasePathResult = { file: string; reason: null } | { file: null; reason: string };

/**
 * Finds the file a run refers to. An absolute path is used as it is. A relative one is tried under `baseDir`, then
 * under CASES_DIR as written and without its first segment (so CASES_DIR may point at the folder that holds `sprawy/`
 * or at `sprawy/` itself, whichever the evaluator mounted). Returns the file, or `null` with a plain-language reason
 * (CASES_DIR not set, or the file not found there) so the caller can skip the step instead of failing.
 */
export function resolveCasePath(p: string, ctx: CasePathContext): CasePathResult {
  if (path.isAbsolute(p)) return ctx.exists(p) ? { file: p, reason: null } : { file: null, reason: `file does not exist: ${p}` };
  const candidates = [path.join(ctx.baseDir, p)];
  if (ctx.casesDir) {
    const rest = p.split(/[\\/]/).slice(1).join(path.sep);
    candidates.push(path.join(ctx.casesDir, p), ...(rest ? [path.join(ctx.casesDir, rest)] : []));
  }
  const found = candidates.find((f) => ctx.exists(f));
  if (found) return { file: found, reason: null };
  return {
    file: null,
    reason: ctx.casesDir
      ? `${p} not found in CASES_DIR (${ctx.casesDir}); point it at a folder with your own copy of the cases`
      : `relative path ${p} needs the CASES_DIR variable (a folder with your own copy of the cases)`,
  };
}
