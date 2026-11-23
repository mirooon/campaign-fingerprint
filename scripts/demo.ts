/** bun run demo -- [--out dane/demo] [--sample data/sample] */
import path from "node:path";
import { runDemo } from "../lib/pipeline/demoScenario";
import { cli, main } from "./_cli";

const args = cli(
  { out: { type: "string" }, sample: { type: "string" } } as const,
  `Usage: bun run demo -- [--out dane/demo] [--sample data/sample]
--out: default DEMO_OUT (in the container /dane/demo), and without it dane/demo.
One command, offline and deterministic: builds a synthetic base (12 cases from the sample), analyzes a batch of 8 samples
(known campaign, similar campaigns, duplicate, insufficient data, dead page, three pages of one campaign with changed
faces and domains) and writes <out>/wynik/wynik.json and wynik.csv. Base: <out>/baza (viewable in the GUI through VIEWER_DATA_DIR).`,
);

void main(async () => {
  const out = path.resolve(args.out ?? process.env.DEMO_OUT ?? "dane/demo");
  const { paths, result } = await runDemo(path.resolve(args.sample ?? "data/sample"), out, (m) => console.error(`[demo] ${m}`));
  for (const it of result.items) console.log(`${it.id.padEnd(22)} ${it.verdict.padEnd(18)} ${it.campaign ?? it.newCampaign ?? "-"}  ${it.verdictText.slice(0, 90)}`);
  console.log(`\nResult: ${paths.result}/wynik.json, wynik.csv. Base for the GUI: VIEWER_DATA_DIR=${paths.base} (locally: bun run dev; in the container: VIEWER_DATA_DIR=/dane/demo/baza docker compose up -d)`);
});
