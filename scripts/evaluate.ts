/** bun run evaluate -- [--graph data/graph.json] [--campaigns data/campaigns.json] [--json] */
import { formatEval } from "../lib/graph/eval";
import { DEFAULTS, runEvaluate } from "../lib/pipeline/steps";
import { cli, main } from "./_cli";

const args = cli(
  {
    graph: { type: "string" },
    campaigns: { type: "string" },
    json: { type: "boolean" },
  } as const,
  `Użycie: bun run evaluate -- [--graph data/graph.json] [--campaigns data/campaigns.json] [--json]
Etykiety prawdy pochodzą z kolumny label (zmapowanej przy ingest).`,
);

void main(() => {
  const { result, breakdown } = runEvaluate({ graph: args.graph ?? DEFAULTS.graph, campaigns: args.campaigns ?? DEFAULTS.campaigns });
  if (!result) {
    console.log("[evaluate] brak etykiet prawdy (kolumna label) — nie ma czego ocenić.");
    return;
  }
  if (args.json) {
    console.log(JSON.stringify({ result, breakdown }, null, 2));
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
