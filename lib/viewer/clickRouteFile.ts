/**
 * Edge of the click route (B-021): finds the enriched data of the base or of an analysis job on disk and
 * hands one material of it to the pure `clickRoute`. Every problem comes back as a message with an HTTP
 * status, never an exception, so the card can show it.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { evidenceInputsDir, findEnriched } from "../pipeline/analyzeMaterial";
import type { EnrichedDataset } from "../pipeline/types";
import { clickRoute, routeSourceOf, type RouteLink } from "./clickRoute";

export interface ClickRouteInput {
  /** Folder of the base (graph.json, enriched.json). */
  dataDir: string;
  /** Work folder of an analysis job (<job>/praca): the material belongs to that job's batch. */
  jobWorkDir?: string;
  itemId: string;
}

export type ClickRouteResult = { ok: true; route: RouteLink[] } | { ok: false; status: 404 | 409 | 500; error: string };

/** Route of one material of the base or of a job; a message when the enriched data is missing, unreadable or lacks the material. */
export function loadClickRoute(input: ClickRouteInput): ClickRouteResult {
  const file = input.jobWorkDir ? path.join(evidenceInputsDir(input.jobWorkDir), "enriched.json") : findEnriched(input.dataDir);
  if (!file || !existsSync(file)) return { ok: false, status: 409, error: "Brak danych wzbogaconych (enriched.json), więc nie da się odtworzyć trasy kliknięcia. Uruchom przebieg albo analizę ponownie." };
  try {
    const src = routeSourceOf(JSON.parse(readFileSync(file, "utf8")) as EnrichedDataset, input.itemId);
    return src ? { ok: true, route: clickRoute(src) } : { ok: false, status: 404, error: `Nie ma materiału ${input.itemId} w danych wzbogaconych.` };
  } catch (e) {
    return { ok: false, status: 500, error: `Nie udało się wczytać danych trasy kliknięcia: ${(e as Error).message}` };
  }
}
