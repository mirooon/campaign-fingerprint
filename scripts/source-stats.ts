/** bun run source-stats -- <graph.json> [--json] */
import { parseArgs } from "node:util";
import type { EvidenceGraph } from "../lib/graph/model";
import { sourceStats, sourceStatsMarkdown } from "../lib/pipeline/sourceStats";
import { readJson } from "../lib/pipeline/steps";
import { main } from "./_cli";

const USAGE = `Użycie: bun run source-stats -- <graph.json> [--json]
Ile powiązań wewnątrz kampanii dał każdy typ metadanych (tabela Markdown albo --json). Działa na dowolnym graph.json.`;

void main(() => {
  const { values, positionals } = parseArgs({ options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } }, allowPositionals: true });
  if (values.help) return void console.log(USAGE);
  if (positionals.length !== 1) throw new Error(`podaj ścieżkę graph.json\n\n${USAGE}`);
  const stats = sourceStats(readJson<EvidenceGraph>(positionals[0]));
  console.log(values.json ? JSON.stringify(stats, null, 2) : sourceStatsMarkdown(stats));
});
