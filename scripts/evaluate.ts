/**
 * bun run evaluate -- [--graph data/graph.json] [--campaigns data/campaigns.json] [--json]
 * bun run evaluate -- --csv <partia.csv> --labels <etykiety.json> [--json]
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
  `Użycie: bun run evaluate -- [--graph data/graph.json] [--campaigns data/campaigns.json] [--json]
       bun run evaluate -- --csv <partia.csv> --labels <etykiety.json> [--json]
Bez --csv etykiety prawdy pochodzą z kolumny label (zmapowanej przy ingest).
Z --csv oceniana jest partia analyze-material; plik etykiet to {"etykieta": ["sprawa", …]} albo {"sprawa": "etykieta"}
(sprawa = kolumna case, a gdy jej brak w etykietach, material_id). Rekord trafia do campaign_id, new_campaign_id
albo grupy rekordu z duplicate_of; „podobne kampanie” nie przypisują (rekord zostaje sam).`,
);

/** Batch CSV + labels file → scores, or null when only one of the two flags is given. */
function evaluateBatch(): ReturnType<typeof evaluateMaterialRows> | null {
  if (!args.csv && !args.labels) return null;
  if (!args.csv || !args.labels) throw new Error("--csv i --labels podaje się razem");
  const rows = parseCsv(readFileSync(args.csv, "utf8"), ",");
  return evaluateMaterialRows(rows, truthFromLabels(JSON.parse(readFileSync(args.labels, "utf8"))));
}

void main(() => {
  const batch = evaluateBatch();
  if (batch && !batch.result.n) {
    console.log(`[evaluate] żaden rekord partii nie ma etykiety (bez etykiety: ${batch.unlabeled.length}) — nie ma czego ocenić.`);
    return;
  }
  if (batch?.unlabeled.length) console.error(`[evaluate] rekordy bez etykiety (pominięte): ${batch.unlabeled.length}`);
  const { result, breakdown } = batch ?? runEvaluate({ graph: args.graph ?? DEFAULTS.graph, campaigns: args.campaigns ?? DEFAULTS.campaigns });
  if (!result) {
    console.log("[evaluate] brak etykiet prawdy (kolumna label) — nie ma czego ocenić.");
    return;
  }
  if (args.json) {
    console.log(JSON.stringify({ result, breakdown, ...(batch ? { unlabeled: batch.unlabeled } : {}) }, null, 2));
    return;
  }
  console.log(formatEval(result));
  console.log("\nPrawdziwa kampania -> przewidziane kampanie (liczba reklam):");
  for (const b of breakdown) {
    const parts = Object.entries(b.predicted)
      .sort((x, y) => y[1] - x[1])
      .map(([k, v]) => `${k}×${v}`)
      .join(", ");
    console.log(`  ${b.label.padEnd(12)} (${b.size}) -> ${parts}`);
  }
});
