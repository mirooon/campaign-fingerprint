/**
 * The scan scheduler: every cycle asks the public sources (CT, ad libraries, urlscan, Lista Ostrzeżeń CERT) for
 * new addresses, runs each new one through the analysis against the base of known campaigns and appends a row to
 * an append-only JSONL file. No source, network or clock is reached from here: sources, the analysis and the
 * clock are passed in, so a cycle is testable without waiting and without the network.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AdRecord } from "../adlib/types";
import type { MaterialVerdict } from "../pipeline/analyzeMaterial";
import { WATCH_CONFIG } from "./config";
import type { WatchRecipe } from "./recipes";

export type WatchSourceName = (typeof WATCH_CONFIG.sources)[number];

/** An address a source found, with where it came from and what the source already knows about it. */
export interface WatchHit {
  source: WatchSourceName;
  url: string;
  /** Id of the recipe that produced the hit. */
  recipe?: string;
  /** Infrastructure shared with a known campaign (same NS, registrar, registration hours ...). */
  confirmations?: string[];
  /** Campaign the source itself matched (a CT fingerprint); not a verdict of the analysis. */
  campaignHint?: string | null;
  note?: string;
  /** Ad-library record behind the hit: the analysis reads it instead of fetching the landing page. */
  adRecord?: AdRecord;
}

export interface WatchPollContext {
  now: Date;
  /** Recipes of this source that are due now (the engine applies each recipe's `every`). */
  recipes: WatchRecipe[];
}

export interface WatchPollResult {
  hits: WatchHit[];
  /** Set when the source could not be asked (no network, no key, no tool): the reason; the scheduler goes on. */
  skipped?: string;
}

export interface WatchSource {
  name: WatchSourceName;
  poll(ctx: WatchPollContext): Promise<WatchPollResult>;
}

/** What the analysis of one hit says; `verdict` is a verdict of `analyzeMaterial` or `error` when it failed. */
export interface WatchAnalysis {
  verdict: MaterialVerdict | "error";
  campaign: string | null;
  /** Id of the record the analysis made, for `--add-to-base`. */
  itemId?: string;
}

/** One row of watch.jsonl. */
export interface WatchRow {
  ts: string;
  source: WatchSourceName;
  url: string;
  verdict: WatchAnalysis["verdict"];
  campaign: string | null;
  recipe?: string;
  confirmations?: string[];
  /** Why the analysis failed, or a remark of the source. */
  note?: string;
}

export interface WatchClock {
  now(): Date;
  sleep(ms: number): Promise<void>;
}

export interface WatchSourceReport {
  source: WatchSourceName;
  status: "ok" | "skipped" | "error";
  reason?: string;
  /** New hits (not seen before) analysed in this cycle. */
  hits: number;
}

export interface WatchOptions {
  sources: WatchSource[];
  recipes: WatchRecipe[];
  /** Analyses one hit against the base. May throw: the row then gets verdict `error` with the message. */
  analyze: (hit: WatchHit) => Promise<WatchAnalysis>;
  /** Called after each analysed hit that produced a row (the place for `--add-to-base`). */
  onAnalyzed?: (hit: WatchHit, analysis: WatchAnalysis, row: WatchRow) => Promise<void> | void;
  /** watch.jsonl; the addresses already in it are not analysed again. */
  file: string;
  everyMs: number;
  once: boolean;
  clock: WatchClock;
  /** Stops after this many cycles (tests, demos). */
  maxCycles?: number;
  signal?: AbortSignal;
  log?: (message: string) => void;
}

export interface WatchResult {
  cycles: number;
  /** Report of the last cycle, per source. */
  report: WatchSourceReport[];
}

const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Milliseconds of an interval written as `45s`, `30m`, `6h` or `1d`; anything else is an error that shows the format. */
export function parseEvery(text: string): number {
  const m = /^(\d+)([smhd])$/.exec(text.trim());
  if (!m || Number(m[1]) === 0) throw new Error(`zły odstęp „${text}”: podaj liczbę z jednostką s, m, h albo d, np. 30m`);
  return Number(m[1]) * UNITS[m[2]];
}

/** Appends one row to the JSONL file (creating the folder); rows are never rewritten. */
export function appendWatchRow(file: string, row: WatchRow): void {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
}

/** Rows of the file in the order written; a missing file gives `[]`, a damaged line is left out. */
export function readWatchRows(file: string): WatchRow[] {
  if (!existsSync(file)) return [];
  const rows: WatchRow[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as WatchRow;
      if (r && typeof r.url === "string" && typeof r.source === "string") rows.push(r);
    } catch {
      // an interrupted write leaves a partial last line: the rows before it are still valid
    }
  }
  return rows;
}

/**
 * One cycle: for each source the recipes that are due, the hits not seen before, the analysis of each and a row.
 * `lastRun` remembers when each recipe was asked, so a recipe with `every: "6h"` is skipped in the cycles between.
 */
async function runCycle(o: WatchOptions, seen: Set<string>, lastRun: Map<string, number>): Promise<WatchSourceReport[]> {
  const now = o.clock.now();
  const report: WatchSourceReport[] = [];
  for (const source of o.sources) {
    const mine = o.recipes.filter((r) => r.source === source.name);
    const due = mine.filter((r) => {
      const last = lastRun.get(r.id);
      return last === undefined || now.getTime() - last >= (r.every ? parseEvery(r.every) : 0);
    });
    // a source with recipes is asked only when one is due; a source without recipes (generic CT, ad library) every cycle
    if (mine.length && !due.length) {
      report.push({ source: source.name, status: "ok", reason: "przepisy poza terminem", hits: 0 });
      continue;
    }
    let poll: WatchPollResult;
    try {
      poll = await source.poll({ now, recipes: due });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      o.log?.(`[watch] ${source.name}: błąd (${reason})`);
      report.push({ source: source.name, status: "error", reason, hits: 0 });
      continue;
    }
    for (const r of due) lastRun.set(r.id, now.getTime());
    if (poll.skipped) {
      o.log?.(`[watch] ${source.name}: pominięte (${poll.skipped})`);
      report.push({ source: source.name, status: "skipped", reason: poll.skipped, hits: 0 });
      continue;
    }
    let fresh = 0;
    for (const hit of poll.hits) {
      if (o.signal?.aborted) break;
      if (seen.has(hit.url)) continue;
      seen.add(hit.url);
      fresh++;
      let analysis: WatchAnalysis;
      let note = hit.note;
      try {
        analysis = await o.analyze(hit);
      } catch (e) {
        analysis = { verdict: "error", campaign: null };
        note = e instanceof Error ? e.message : String(e);
      }
      const row: WatchRow = {
        ts: o.clock.now().toISOString(),
        source: hit.source,
        url: hit.url,
        verdict: analysis.verdict,
        campaign: analysis.campaign ?? hit.campaignHint ?? null,
        ...(hit.recipe ? { recipe: hit.recipe } : {}),
        ...(hit.confirmations?.length ? { confirmations: hit.confirmations } : {}),
        ...(note ? { note } : {}),
      };
      appendWatchRow(o.file, row);
      o.log?.(`[watch] ${hit.source} ${hit.url} → ${row.verdict}${row.campaign ? ` (${row.campaign})` : ""}`);
      await o.onAnalyzed?.(hit, analysis, row);
    }
    report.push({ source: source.name, status: "ok", hits: fresh });
  }
  return report;
}

/**
 * Runs cycles until `once`, `maxCycles` or the abort signal: a cycle, then `everyMs` of sleep on the injected
 * clock. Addresses already in the file are not analysed again, so a restart continues where the last run stopped.
 */
export async function runWatch(o: WatchOptions): Promise<WatchResult> {
  const seen = new Set(readWatchRows(o.file).map((r) => r.url));
  const lastRun = new Map<string, number>();
  let cycles = 0;
  let report: WatchSourceReport[] = [];
  for (;;) {
    report = await runCycle(o, seen, lastRun);
    cycles++;
    if (o.once || o.signal?.aborted || (o.maxCycles !== undefined && cycles >= o.maxCycles)) break;
    await o.clock.sleep(o.everyMs);
  }
  return { cycles, report };
}
