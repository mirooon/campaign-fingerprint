/**
 * GET /api/threshold-preview — how many campaigns the saved links give at other values of the link threshold
 * (`minLinkScore`), computed by the backend's clustering on the base's graph with the base's weights. Read-only;
 * an approximation because graph.json keeps the strongest links of each ad, not every pair.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveLinkConfigFile } from "@/lib/pipeline/linkConfigFile";
import { loadLinkConfig } from "@/lib/pipeline/steps";
import { DATA_DIR, loadViewerData, SAMPLE_BASE } from "@/lib/viewer/data";
import { previewThresholds, thresholdSteps } from "@/lib/viewer/thresholdPreview";

/** GET /api/threshold-preview: `{ current, rows }` (campaigns, singletons and the largest campaign per threshold), or `{ error }` with 503 when there is no base. */
export async function GET(): Promise<Response> {
  const { graph, campaigns, error } = loadViewerData();
  if (!graph || !campaigns) return Response.json({ error: error ?? "Brak bazy" }, { status: 503 });
  const file = resolveLinkConfigFile({ dataDir: DATA_DIR, env: process.env.LINK_CONFIG, sampleConfig: SAMPLE_BASE ? path.join(DATA_DIR, "sample", "linking.json") : undefined, exists: existsSync });
  const current = campaigns.method.minLinkScore;
  const rows = previewThresholds(graph, loadLinkConfig(file ?? undefined), thresholdSteps(current));
  return Response.json({ current, rows }, { headers: { "cache-control": "no-store" } });
}
