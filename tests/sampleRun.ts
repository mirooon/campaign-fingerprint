/**
 * Shared helper for the end-to-end tests on the synthetic sample: ingest -> enrich from
 * recorded fixtures (no network) -> evidence graph -> clustering.
 */
import path from "node:path";
import { clusterCampaigns } from "../lib/graph/cluster";
import { buildEvidenceGraph } from "../lib/graph/link";
import { enrichItems, type EnrichOptions } from "../lib/pipeline/enrich";
import { loadMapping, loadRecords, normalizeRecords } from "../lib/pipeline/ingest";
import { fixtureSources } from "../lib/pipeline/sources";
import { loadLinkConfig } from "../lib/pipeline/steps";
import { compileWatchlist, loadWatchlist } from "../lib/text/persona";

export const SAMPLE = path.join(process.cwd(), "data", "sample");

export function sampleItems() {
  return normalizeRecords(loadRecords(path.join(SAMPLE, "ads.csv")), loadMapping(path.join(SAMPLE, "mapping.json")));
}

export async function runSample(opts: { only?: string[]; enrich?: Partial<EnrichOptions> } = {}) {
  const { items, warnings } = sampleItems();
  const subset = opts.only ? items.filter((it) => opts.only!.includes(it.id)) : items;
  const ds = await enrichItems(subset, {
    sources: fixtureSources(path.join(SAMPLE, "fixtures")),
    baseDir: SAMPLE,
    personas: compileWatchlist(loadWatchlist(path.join(SAMPLE, "personas.json"))),
    ...opts.enrich,
  });
  const config = loadLinkConfig(path.join(SAMPLE, "linking.json"));
  const { graph, campaigns } = clusterCampaigns(buildEvidenceGraph(ds, { config }), { config });
  return { items: subset, warnings, ds, config, graph, campaigns };
}
