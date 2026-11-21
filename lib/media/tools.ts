/**
 * Running optional local media tools (tesseract, whisper-cli, mlx_whisper, fpcalc, ffmpeg).
 *
 * - execFile with argument arrays, never a shell (no injection through file names)
 * - hard timeout with SIGKILL
 * - the runner never rejects: a missing binary, a non-zero exit or a timeout all come
 *   back as a RunResult, so adapters can skip quietly and the project stays portable
 */
import { execFile } from "node:child_process";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";

export interface RunResult {
  /** Exit code; null when the process could not start (e.g. ENOENT) or was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type ToolRunner = (cmd: string, args: string[], opts?: { timeoutMs?: number; maxBuffer?: number }) => Promise<RunResult>;

interface ExecError extends Error {
  code?: string | number;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
}

export const defaultRunner: ToolRunner = (cmd, args, opts = {}) =>
  new Promise<RunResult>((resolve) => {
    try {
      execFile(
        cmd,
        args,
        {
          timeout: opts.timeoutMs ?? 60_000,
          maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
          killSignal: "SIGKILL",
          windowsHide: true,
          encoding: "utf8",
          shell: false,
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve({ code: 0, stdout, stderr, timedOut: false });
            return;
          }
          const e = error as ExecError;
          const maxBufferHit = e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
          resolve({
            code: typeof e.code === "number" ? e.code : null,
            stdout: stdout ?? "",
            stderr: stderr || e.message,
            timedOut: !!e.killed && !maxBufferHit,
          });
        },
      );
    } catch (e) {
      resolve({ code: null, stdout: "", stderr: e instanceof Error ? e.message : String(e), timedOut: false });
    }
  });

async function isExecutableFile(file: string): Promise<boolean> {
  try {
    const st = await fs.stat(file);
    if (!st.isFile()) return false;
    await fs.access(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Finds an executable on PATH (no shell). Paths containing a separator are checked directly. */
export async function which(cmd: string, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  if (!cmd) return null;
  if (cmd.includes("/") || cmd.includes(path.sep)) return (await isExecutableFile(cmd)) ? cmd : null;
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, cmd);
    if (await isExecutableFile(candidate)) return candidate;
  }
  return null;
}

/** True when a file exists and is non-empty. */
export async function nonEmptyFile(file: string): Promise<boolean> {
  try {
    const st = await fs.stat(file);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}
