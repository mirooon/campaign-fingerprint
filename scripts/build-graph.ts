/** bun run build-graph -- [--enriched data/work/enriched.json] [--text tfidf|embedding|none] */
import { DEFAULTS, runBuildGraph } from "../lib/pipeline/steps";
import { cli, main } from "./_cli";

const args = cli(
  {
    enriched: { type: "string" },
    graph: { type: "string" },
    campaigns: { type: "string" },
    config: { type: "string" },
    text: { type: "string" },
  } as const,
  `Użycie: bun run build-graph -- [--enriched ...] [--graph data/graph.json] [--campaigns data/campaigns.json] [--config linking.json] [--text tfidf|embedding|none]`,
);

void main(async () => {
  const text = (args.text ?? process.env.TEXT_SIMILARITY ?? "tfidf") as "tfidf" | "embedding" | "none";
  if (!["tfidf", "embedding", "none"].includes(text)) throw new Error(`--text: nieznana metoda ${text}`);
  await runBuildGraph({
    enriched: args.enriched ?? DEFAULTS.enriched,
    graph: args.graph ?? DEFAULTS.graph,
    campaigns: args.campaigns ?? DEFAULTS.campaigns,
    config: args.config ?? DEFAULTS.config,
    text,
  });
});
