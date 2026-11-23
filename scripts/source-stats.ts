/** bun run source-stats -- <graph.json> [--json] */
import { parseArgs } from "node:util";
import type { EvidenceGraph } from "../lib/graph/model";
import { sourceStats, sourceStatsMarkdown } from "../lib/pipeline/sourceStats";
import { readJson } from "../lib/pipeline/steps";
import { main } from "./_cli";

const USAGE = `Usage: bun run source-stats -- <graph.json> [--json]
How many links inside campaigns each kind of metadata gave (Markdown table or --json). Works on any graph.json.`;

void main(() => {
  const { values, positionals } = parseArgs({ options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } }, allowPositionals: true });
  if (values.help) return void console.log(USAGE);
  if (positionals.length !== 1) throw new Error(`give the path of graph.json\n\n${USAGE}`);
  const stats = sourceStats(readJson<EvidenceGraph>(positionals[0]));
  console.log(values.json ? JSON.stringify(stats, null, 2) : sourceStatsMarkdown(stats));
});
