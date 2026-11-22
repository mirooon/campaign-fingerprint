/** bun run build-graph -- [--enriched data/work/enriched.json] [--text tfidf|embedding|none] [--corrections corrections.json] */
import { buildGraphConfigFile } from "../lib/pipeline/linkConfigFile";
import { DEFAULTS, runBuildGraph } from "../lib/pipeline/steps";
import { cli, main } from "./_cli";

const args = cli(
  {
    enriched: { type: "string" },
    graph: { type: "string" },
    campaigns: { type: "string" },
    "near-misses": { type: "string" },
    config: { type: "string" },
    text: { type: "string" },
    corrections: { type: "string" },
  } as const,
  `Użycie: bun run build-graph -- [--enriched ...] [--graph data/graph.json] [--campaigns data/campaigns.json] [--near-misses near-misses.json; domyślnie obok campaigns] [--config linking.json; domyślnie wagi wbudowane, dla danych próbki data/sample/linking.json] [--text tfidf|embedding|none] [--corrections corrections.json; domyślnie obok campaigns, korekty analityka]`,
);

void main(async () => {
  const text = (args.text ?? process.env.TEXT_SIMILARITY ?? "tfidf") as "tfidf" | "embedding" | "none";
  if (!["tfidf", "embedding", "none"].includes(text)) throw new Error(`--text: nieznana metoda ${text}`);
  const enriched = args.enriched ?? DEFAULTS.enriched;
  await runBuildGraph({
    enriched,
    graph: args.graph ?? DEFAULTS.graph,
    campaigns: args.campaigns ?? DEFAULTS.campaigns,
    nearMisses: args["near-misses"],
    config: buildGraphConfigFile(args.config, enriched),
    text,
    corrections: args.corrections,
  });
});
