/**
 * In-memory jobs of the GUI analysis (`/api/material`). Kept in `globalThis` so they survive module
 * reloads in dev mode. A job runs `lib/viewer/materialRunner.ts` in a child process and follows its
 * progress lines; files live in MATERIAL_WORK_DIR (default: the system temp folder), outside the repo.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MaterialProgress, MaterialResult } from "@/lib/pipeline/analyzeMaterial";
import type { CaseProvenance } from "./completeness";
import type { RunnerSpec } from "./materialRunner";

export type CaseStatus = "waiting" | "running" | "done" | "error";

export interface JobCase {
  name: string;
  status: CaseStatus;
  /** Last state of every step reported for the case. */
  steps: Array<{ step: string; status: MaterialProgress["status"]; detail?: string }>;
  detail?: string;
  files: number;
}

export interface JobResult extends MaterialResult {
  /** Case records of the import (provenance.json of the job). */
  provenance?: CaseProvenance[];
  failedLookups?: string[];
  /** Passive lookups were on. */
  lookups: boolean;
  /** Files sent with the job. */
  fileCount: number;
}

export interface Job {
  id: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  status: "running" | "done" | "error";
  cases: JobCase[];
  log: string[];
  result?: JobResult;
  error?: string;
  /** Job folder (never sent to the browser). */
  dir: string;
  live: boolean;
  fileCount: number;
  /** Cases are analysed in one run and compared with each other. */
  together: boolean;
}

type Store = Map<string, Job>;
const g = globalThis as unknown as { __materialJobs?: Store };
const store: Store = (g.__materialJobs ??= new Map());

const MAX_LOG = 400;
const MAX_JOBS = 50;

export function workRoot(): string {
  return path.resolve(process.env.MATERIAL_WORK_DIR || path.join(os.tmpdir(), "analiza-kampanii"));
}

export function getJob(id: string): Job | undefined {
  return /^[a-z0-9-]{6,40}$/.test(id) ? store.get(id) : undefined;
}

export function newJobId(): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

export function registerJob(job: Job): void {
  store.set(job.id, job);
  if (store.size > MAX_JOBS) {
    const oldest = [...store.values()].filter((j) => j.status !== "running").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (oldest) store.delete(oldest.id);
  }
}

function pushLog(job: Job, line: string): void {
  job.log.push(line);
  if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG);
}

/** Applies one progress event to the case it names. */
export function applyProgress(job: Job, e: MaterialProgress): void {
  let c = job.cases.find((x) => x.name === e.caseId);
  if (!c) {
    c = { name: e.caseId, status: "waiting", steps: [], files: 0 };
    job.cases.push(c);
  }
  const step = c.steps.find((s) => s.step === e.step);
  if (step) Object.assign(step, { status: e.status, detail: e.detail });
  else c.steps.push({ step: e.step, status: e.status, ...(e.detail ? { detail: e.detail } : {}) });
  if (c.status === "waiting" && e.status === "start") c.status = "running";
  if (e.step === "import" && e.status === "skipped") {
    c.status = "error";
    c.detail = e.detail ?? "brak plików do analizy";
  }
  if (e.step === "import" && e.status === "error") {
    c.status = "error";
    c.detail = e.detail;
  }
  if (e.step === "group" && e.status === "done" && c.status !== "error") c.status = "done";
}

/** Case record for the browser: without the file checksums, which carry server paths and belong to the evidence pack. */
function withoutFiles(c: CaseProvenance & { files?: unknown }): CaseProvenance {
  const copy = { ...c };
  delete copy.files;
  return copy;
}

/** Starts the runner for a job whose case folders are ready. */
export async function startJob(job: Job, spec: Omit<RunnerSpec, "out" | "workDir">): Promise<void> {
  const specFile = path.join(job.dir, "zadanie.json");
  const out = path.join(job.dir, "wynik.json");
  const full: RunnerSpec = { ...spec, out, workDir: path.join(job.dir, "praca") };
  await writeFile(specFile, JSON.stringify(full));
  job.startedAt = new Date().toISOString();
  const runner = path.join(process.cwd(), "lib", "viewer", "materialRunner.ts");
  const child = spawn(process.env.BUN_BIN ?? "bun", [runner, specFile], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  // big batches (many GB) take long: default 6 h, MATERIAL_TIMEOUT_MS=0 switches the limit off
  const timeoutMs = Number(process.env.MATERIAL_TIMEOUT_MS ?? 6 * 60 * 60_000);
  const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs > 0 ? timeoutMs : 2 ** 31 - 1);
  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as { t: string; m?: string } & MaterialProgress;
        if (msg.t === "progress") applyProgress(job, msg);
        else if (msg.t === "log" && msg.m) pushLog(job, msg.m);
        else if (msg.t === "error" && msg.m) {
          pushLog(job, `błąd: ${msg.m}`);
          job.error = msg.m;
        }
      } catch {
        pushLog(job, line);
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    for (const l of chunk.split("\n")) if (l.trim()) pushLog(job, l.trim());
  });
  child.on("error", (e) => {
    clearTimeout(timeout);
    finish(job, null, `Nie udało się uruchomić analizy: ${e.message}`);
  });
  child.on("close", (code) => {
    clearTimeout(timeout);
    if (code === 0 && existsSync(out)) {
      try {
        const res = JSON.parse(readFileSync(out, "utf8")) as MaterialResult;
        const provFile = path.join(job.dir, "praca", "import", "provenance.json");
        const prov = existsSync(provFile) ? (JSON.parse(readFileSync(provFile, "utf8")) as { cases?: CaseProvenance[]; failedLookups?: string[] }) : null;
        finish(job, { ...res, provenance: (prov?.cases ?? []).map(withoutFiles), failedLookups: prov?.failedLookups ?? [], lookups: job.live, fileCount: job.fileCount }, null);
        return;
      } catch (e) {
        finish(job, null, `Nie udało się odczytać wyniku: ${(e as Error).message}`);
        return;
      }
    }
    finish(job, null, job.error ?? `Analiza zakończona błędem (kod ${code ?? "?"})${job.log.length ? `: ${job.log.at(-1)}` : ""}`);
  });
}

function finish(job: Job, result: JobResult | null, error: string | null): void {
  job.finishedAt = new Date().toISOString();
  if (result) {
    job.result = result;
    job.status = "done";
    const withItems = new Set(result.items.map((it) => it.caseId ?? it.id));
    for (const c of job.cases) {
      if (c.status === "error") continue;
      c.status = withItems.has(c.name) ? "done" : "error";
      if (c.status === "error") c.detail ??= result.skipped.find((s) => s.id === c.name || s.id.startsWith(`${c.name}/`))?.reason ?? "brak materiału w wyniku";
    }
  } else {
    job.status = "error";
    job.error = error ?? "nieznany błąd";
    for (const c of job.cases) if (c.status !== "done") Object.assign(c, { status: "error", detail: c.detail ?? job.error });
  }
}

/** What the browser gets: no server paths. */
export function publicJob(job: Job) {
  return {
    id: job.id,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
    status: job.status,
    cases: job.cases,
    log: job.log,
    error: job.error ?? null,
    live: job.live,
    together: job.together,
    fileCount: job.fileCount,
    result: job.result ?? null,
  };
}

export type PublicJob = ReturnType<typeof publicJob>;
