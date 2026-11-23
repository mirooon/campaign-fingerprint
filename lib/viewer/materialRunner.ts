/**
 * Child process of the GUI job API: `bun lib/viewer/materialRunner.ts <spec.json>`.
 * Runs `analyzeMaterial` with the same options as scripts/analyze-material.ts (weights config,
 * personas, OCR, optional ASR/audio, passive lookups) and reports progress per case and step as
 * JSON lines on stdout: {"t":"progress",...} and {"t":"log","m":...}. The result goes to `spec.out`.
 * Media tools and native models stay out of the Next.js server bundle.
 */
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { analyzeMaterial } from "../pipeline/analyzeMaterial";
import { archiveStepOptions } from "../pipeline/archiveContext";
import { resolveLinkConfigFile } from "../pipeline/linkConfigFile";
import { liveSources } from "../pipeline/sources";
import { loadLinkConfig } from "../pipeline/steps";
import { saveCaptured } from "./addToBaseJob";
import { compileWatchlist, loadWatchlist } from "../text/persona";

export interface RunnerSpec {
  dataDir: string;
  /** The run is the bundled sample: only then its weights and persona list are the fallback. */
  sampleBase: boolean;
  workDir: string;
  out: string;
  caseDirs: string[];
  url?: string;
  text?: string;
  live: boolean;
  /** Archive step on (also switched on by ARCHIVE_SOURCES in the environment). */
  archive?: boolean;
  asr?: boolean;
  fixtures?: string;
  config?: string;
  personas?: string;
}

function emit(obj: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

/** Reads the job spec, runs the analysis with the config and personas chosen for the run, and writes the result to `spec.out`. */
async function main(): Promise<void> {
  const specFile = process.argv[2];
  if (!specFile) throw new Error("no job file");
  const spec = JSON.parse(readFileSync(specFile, "utf8")) as RunnerSpec;
  const pick = (...files: string[]) => files.find((f) => existsSync(f));
  const dataDir = spec.dataDir;
  const configFile = resolveLinkConfigFile({
    explicit: spec.config,
    dataDir,
    sampleConfig: spec.sampleBase ? path.join(dataDir, "sample", "linking.json") : undefined,
    exists: existsSync,
  });
  const personasFile = spec.personas ?? pick(path.join(dataDir, "personas.json"), path.join(dataDir, "..", "personas.json"), ...(spec.sampleBase ? [path.join(dataDir, "sample", "personas.json")] : []));
  const res = await analyzeMaterial(
    {
      caseDir: spec.caseDirs.length === 1 ? spec.caseDirs[0] : undefined,
      caseDirs: spec.caseDirs.length > 1 ? spec.caseDirs : undefined,
      url: spec.url || undefined,
      text: spec.text || undefined,
    },
    {
      dataDir,
      workDir: spec.workDir,
      fixtures: spec.fixtures,
      casesDir: process.env.CASES_DIR || undefined,
      live: spec.live ? liveSources({ skipCt: true }) : null,
      archive: archiveStepOptions({ enabled: !!spec.archive, screenshotDir: path.join(spec.workDir, "archiwum") }),
      config: loadLinkConfig(configFile ?? undefined),
      personas: personasFile ? compileWatchlist(loadWatchlist(personasFile)) : null,
      media: { ocr: true, asr: !!spec.asr, audio: !!spec.asr, clip: false, speaker: false, adLibrary: false },
      log: (m) => emit({ t: "log", m }),
      onAnalyzed: (a) => saveCaptured(spec.workDir, a),
      onProgress: (e) => emit({ t: "progress", ...e }),
    },
  );
  writeFileSync(spec.out, JSON.stringify(res));
  emit({ t: "done" });
}

main().catch((e) => {
  emit({ t: "error", m: (e as Error).message });
  process.exit(1);
});
