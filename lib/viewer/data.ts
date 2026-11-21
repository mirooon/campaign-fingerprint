/**
 * Server-side loader for the viewer: reads the pipeline outputs from data/.
 * The viewer never calls an LLM or the network, so it builds and runs anywhere.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CampaignsFile, EvidenceGraph } from "../graph/model";
import type { CampaignSummary } from "../pipeline/summary";

export interface ViewerData {
  graph: EvidenceGraph | null;
  campaigns: CampaignsFile | null;
  summaries: Record<string, CampaignSummary>;
  error: string | null;
}

/** Pipeline outputs: `data/` of the project, or VIEWER_DATA_DIR (e.g. a run on data that must stay outside the repository). */
export const DATA_DIR = process.env.VIEWER_DATA_DIR ? path.resolve(process.env.VIEWER_DATA_DIR) : path.join(process.cwd(), "data");

function read<T>(file: string): T | null {
  const full = path.join(DATA_DIR, file);
  return existsSync(full) ? (JSON.parse(readFileSync(full, "utf8")) as T) : null;
}

export function loadViewerData(): ViewerData {
  try {
    const graph = read<EvidenceGraph>("graph.json");
    const campaigns = read<CampaignsFile>("campaigns.json");
    const summariesFile = read<{ summaries: Record<string, CampaignSummary> }>("summaries.json");
    if (!graph || !campaigns) {
      return { graph: null, campaigns: null, summaries: {}, error: "Brak data/graph.json lub data/campaigns.json — uruchom: bun run pipeline --offline" };
    }
    return { graph, campaigns, summaries: summariesFile?.summaries ?? {}, error: null };
  } catch (e) {
    return { graph: null, campaigns: null, summaries: {}, error: `Nie udało się wczytać danych: ${(e as Error).message}` };
  }
}

/** The base is the bundled sample (synthetic data): no VIEWER_DATA_DIR, or one that points at the project's own data/. */
export const SAMPLE_BASE = !process.env.VIEWER_DATA_DIR || DATA_DIR === path.join(process.cwd(), "data");
