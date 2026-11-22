/** bun run meta-id-suffix -- <graph.json> [--json] */
import { parseArgs } from "node:util";
import type { EvidenceGraph } from "../lib/graph/model";
import { metaIdSuffixReport } from "../lib/pipeline/metaIdSuffix";
import { readJson } from "../lib/pipeline/steps";
import { main } from "./_cli";

const USAGE = `Użycie: bun run meta-id-suffix -- <graph.json> [--json]
Pomiar hipotezy sufiksu identyfikatorów Mety (B-349): zgodność 4 ostatnich cyfr w sprawie, zbieżności między sprawami i liczba oczekiwana losowo.`;

/** Reads the graph, collects the Meta identifiers of every case and prints the report. */
void main(() => {
  const { values, positionals } = parseArgs({ options: { json: { type: "boolean" }, help: { type: "boolean", short: "h" } }, allowPositionals: true });
  if (values.help) return void console.log(USAGE);
  if (positionals.length !== 1) throw new Error(`podaj ścieżkę graph.json\n\n${USAGE}`);
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
  console.log(`Sprawy z identyfikatorem Mety: ${r.casesWithId}, z co najmniej dwoma: ${r.casesWithTwoIds}`);
  console.log(`Zgodność 4 ostatnich cyfr w sprawie: ${r.casesInAgreement}/${r.casesWithTwoIds}`);
  console.log(`Zbieżności między sprawami: ${r.crossCasePairs} z ${r.pairsCompared} par (losowo oczekiwane: ${r.expectedByChance.toFixed(2)})`);
  for (const [a, b, s] of r.coincidences) console.log(`  ${a} + ${b}: ${s}`);
});
