/**
 * "Dodaj do bazy" in the viewer (B-284): the bridge between an analysis job and `addToBase`. The runner
 * (a child process) keeps what the analysis computed in the job's work folder; this module reads it back,
 * adds the chosen materials to the base and words the outcome ("co dodano, a czego nie i dlaczego").
 * The bundled sample base is never written (see `addToBaseRefusal`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { addToBase, type AddToBaseResult } from "../pipeline/addToBase";
import type { AnalyzedMaterial, MaterialResult } from "../pipeline/analyzeMaterial";
import { addMessages } from "./addToBaseView";

/** File in the job's work folder with what the analysis computed for the new records. */
export function capturedFile(workDir: string): string {
  return path.join(workDir, "dodaj", "analiza.json");
}

/** Called by the runner: keeps the records, their enrichment and the import folder, so the job can add them to the base later. */
export function saveCaptured(workDir: string, analyzed: AnalyzedMaterial): void {
  mkdirSync(path.dirname(capturedFile(workDir)), { recursive: true });
  writeFileSync(capturedFile(workDir), JSON.stringify(analyzed));
}

export interface AddJobInput {
  dataDir: string;
  /** Work folder of the job (<job>/praca). */
  workDir: string;
  /** Result of the job's analysis. */
  result: MaterialResult;
  /** Materials to add (ids of `result.items`). */
  ids: string[];
  force?: boolean;
  now?: () => Date;
}

export type AddJobResult = { ok: true; result: AddToBaseResult; messages: string[] } | { ok: false; status: 404 | 409 | 500; error: string };

/** Adds the chosen materials of a finished job to the base in `dataDir`; a message with a status instead of an exception when the job kept nothing to add or the write fails. */
export async function addJobToBase(input: AddJobInput): Promise<AddJobResult> {
  const file = capturedFile(input.workDir);
  if (!existsSync(file)) return { ok: false, status: 409, error: "Zadanie nie zachowało danych do dopisania (uruchom analizę ponownie)." };
  const wanted = new Set(input.ids);
  const items = input.result.items.filter((i) => wanted.has(i.id));
  if (!items.length) return { ok: false, status: 404, error: "Żaden z wybranych materiałów nie należy do tej analizy." };
  try {
    const captured = JSON.parse(readFileSync(file, "utf8")) as AnalyzedMaterial;
    const result = await addToBase(input.dataDir, { result: { ...input.result, items }, captured }, { source: "gui", force: input.force, now: input.now });
    return { ok: true, result, messages: addMessages(result) };
  } catch (e) {
    return { ok: false, status: 500, error: `Nie udało się dodać do bazy: ${(e as Error).message}` };
  }
}
