/**
 * Folder of a batch of new materials -> case folders for `analyzeMaterial({ caseDirs })`.
 * Every sub-folder is a case. With `eachFile`, every loose file of the folder is a case of its own
 * (a folder in `scratchDir` named after the file, holding a link to it); sub-folders stay whole.
 */
import { mkdirSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import path from "node:path";

export function batchCaseDirs(casesDir: string, opts: { eachFile?: boolean; scratchDir: string }): string[] {
  const root = path.resolve(casesDir);
  const entries = readdirSync(root)
    .filter((n) => !n.startsWith("."))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const dirs: string[] = [];
  const files: string[] = [];
  for (const n of entries) {
    const st = statSync(path.join(root, n));
    if (st.isDirectory()) dirs.push(path.join(root, n));
    else if (st.isFile()) files.push(n);
  }
  if (!opts.eachFile || !files.length) return dirs;
  const single = path.resolve(opts.scratchDir, "pojedyncze-pliki");
  rmSync(single, { recursive: true, force: true });
  for (const f of files) {
    const dir = path.join(single, f);
    mkdirSync(dir, { recursive: true });
    symlinkSync(path.join(root, f), path.join(dir, f));
    dirs.push(dir);
  }
  return dirs;
}
