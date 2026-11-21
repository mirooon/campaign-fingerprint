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
import { liveSources } from "../pipeline/sources";
import { loadLinkConfig } from "../pipeline/steps";
import { compileWatchlist, loadWatchlist } from "../text/persona";

export interface RunnerSpec {
  dataDir: string;
  workDir: string;
  out: string;
  caseDirs: string[];
  url?: string;
  text?: string;
  live: boolean;
  asr?: boolean;
  fixtures?: string;
  config?: string;
  personas?: string;
}

function emit(obj: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

async function main(): Promise<void> {
  const specFile = process.argv[2];
  if (!specFile) throw new Error("brak pliku zadania");
  const spec = JSON.parse(readFileSync(specFile, "utf8")) as RunnerSpec;
  const pick = (...files: string[]) => files.find((f) => existsSync(f));
  const dataDir = spec.dataDir;
  const configFile = spec.config ?? pick(path.join(dataDir, "linking.json"), path.join(dataDir, "..", "linking-default.json"), path.join(dataDir, "sample", "linking.json"));
  const personasFile = spec.personas ?? pick(path.join(dataDir, "personas.json"), path.join(dataDir, "..", "personas.json"), path.join(dataDir, "sample", "personas.json"));
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
      live: spec.live ? liveSources({ skipCt: true }) : null,
      config: loadLinkConfig(configFile),
      personas: personasFile ? compileWatchlist(loadWatchlist(personasFile)) : null,
      media: { ocr: true, asr: !!spec.asr, audio: !!spec.asr, clip: false, speaker: false, adLibrary: false },
      log: (m) => emit({ t: "log", m }),
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
