/**
 * bun run evaluate -- [--graph data/graph.json] [--campaigns data/campaigns.json] [--json]
 * bun run evaluate -- --csv <batch.csv> --labels <labels.json> [--json]
 */
import { readFileSync } from "node:fs";
import { formatEval } from "../lib/graph/eval";
import { parseCsv } from "../lib/pipeline/ingest";
import { evaluateMaterialRows, truthFromLabels } from "../lib/pipeline/materialEval";
import { DEFAULTS, runEvaluate } from "../lib/pipeline/steps";
import { cli, main } from "./_cli";

const args = cli(
  {
    graph: { type: "string" },
    campaigns: { type: "string" },
    csv: { type: "string" },
    labels: { type: "string" },
    json: { type: "boolean" },
  } as const,
  `Usage: bun run evaluate -- [--graph data/graph.json] [--campaigns data/campaigns.json] [--json]
       bun run evaluate -- --csv <batch.csv> --labels <labels.json> [--json]
Without --csv the truth labels come from the label column (mapped at ingest).
With --csv a batch of analyze-material is scored; the labels file is {"label": ["case", …]} or {"case": "label"}
(case = the case column, and when the labels lack it, material_id). A record goes to campaign_id, new_campaign_id
or the group of the record in duplicate_of; “similar campaigns” do not assign (the record stays alone).`,
);

/** Batch CSV + labels file → scores, or null when only one of the two flags is given. */
function evaluateBatch(): ReturnType<typeof evaluateMaterialRows> | null {
  if (!args.csv && !args.labels) return null;
  if (!args.csv || !args.labels) throw new Error("--csv and --labels go together");
  const rows = parseCsv(readFileSync(args.csv, "utf8"), ",");
  return evaluateMaterialRows(rows, truthFromLabels(JSON.parse(readFileSync(args.labels, "utf8"))));
}

void main(() => {
  const batch = evaluateBatch();
  if (batch && !batch.result.n) {
    console.log(`[evaluate] no record of the batch has a label (without a label: ${batch.unlabeled.length}) — nothing to score.`);
    return;
  }
  if (batch?.unlabeled.length) console.error(`[evaluate] records without a label (skipped): ${batch.unlabeled.length}`);
  const { result, breakdown } = batch ?? runEvaluate({ graph: args.graph ?? DEFAULTS.graph, campaigns: args.campaigns ?? DEFAULTS.campaigns });
  if (!result) {
    console.log("[evaluate] no truth labels (label column) — nothing to score.");
    return;
  }
  if (args.json) {
    console.log(JSON.stringify({ result, breakdown, ...(batch ? { unlabeled: batch.unlabeled } : {}) }, null, 2));
    return;
  }
  console.log(formatEval(result));
  console.log("\nTrue campaign -> predicted campaigns (number of ads):");
  for (const b of breakdown) {
    const parts = Object.entries(b.predicted)
      .sort((x, y) => y[1] - x[1])
      .map(([k, v]) => `${k}×${v}`)
      .join(", ");
    console.log(`  ${b.label.padEnd(12)} (${b.size}) -> ${parts}`);
  }
});
