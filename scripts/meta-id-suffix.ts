/** bun run meta-id-suffix -- <graph.json> [--json] */
import { parseArgs } from "node:util";
import type { EvidenceGraph } from "../lib/graph/model";
import { metaIdSuffixReport } from "../lib/pipeline/metaIdSuffix";
import { readJson } from "../lib/pipeline/steps";
import { main } from "./_cli";

const USAGE = `Usage: bun run meta-id-suffix -- <graph.json> [--json]
Test of the Meta ID suffix hypothesis (B-349): agreement of the last 4 digits within a case, coincidences between cases and the number expected by chance.`;

/** Reads the graph, collects the Meta identifiers of every case and prints the report. */
void main(() => {
  const { values, positionals } = parseArgs({ options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } }, allowPositionals: true });
  if (values.help) return void console.log(USAGE);
  if (positionals.length !== 1) throw new Error(`give the path of graph.json\n\n${USAGE}`);
  const g = readJson<EvidenceGraph>(positionals[0]);
  const byNode = new Map(g.nodes.map((n) => [n.id, n]));
  const cases = new Map<string, string[]>();
  const push = (item: string, value: unknown) => {
    if (typeof value === "string" && /^\d{15,20}$/.test(value)) cases.set(item, [...(cases.get(item) ?? []), value]);
  };
  for (const n of g.nodes) if (n.type === "item") cases.set(n.key, []);
  for (const e of g.edges) {
    const a = byNode.get(e.source);
    const b = byNode.get(e.target);
    for (const [x, y] of [[a, b], [b, a]] as const) {
      if (x?.type !== "item" || !y) continue;
      if (y.type === "meta_ad") push(x.key, y.data.adId);
      else if (y.type === "campaign_param") push(x.key, y.data.value);
    }
  }
  const r = metaIdSuffixReport(cases);
  if (values.json) return void console.log(JSON.stringify(r, null, 2));
  console.log(`Cases with a Meta ID: ${r.casesWithId}, with at least two: ${r.casesWithTwoIds}`);
  console.log(`Agreement of the last 4 digits within a case: ${r.casesInAgreement}/${r.casesWithTwoIds}`);
  console.log(`Coincidences between cases: ${r.crossCasePairs} of ${r.pairsCompared} pairs (expected by chance: ${r.expectedByChance.toFixed(2)})`);
  for (const [a, b, s] of r.coincidences) console.log(`  ${a} + ${b}: ${s}`);
});
