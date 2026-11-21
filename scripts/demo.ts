/** bun run demo -- [--out dane/demo] [--sample data/sample] */
import path from "node:path";
import { runDemo } from "../lib/pipeline/demoScenario";
import { cli, main } from "./_cli";

const args = cli(
  { out: { type: "string" }, sample: { type: "string" } } as const,
  `Użycie: bun run demo -- [--out dane/demo] [--sample data/sample]
--out: domyślnie DEMO_OUT (w kontenerze /dane/demo), a bez niego dane/demo.
Jedno polecenie, offline i deterministycznie: buduje syntetyczną bazę (12 spraw z próbki), analizuje partię 8 materiałów
(znana kampania, podobne kampanie, duplikat, za mało danych, martwa strona, trzy strony jednej kampanii ze zmienionymi
twarzami i domenami) i zapisuje <out>/wynik/wynik.json oraz wynik.csv. Baza: <out>/baza (można ją oglądać w GUI przez VIEWER_DATA_DIR).`,
);

void main(async () => {
  const out = path.resolve(args.out ?? process.env.DEMO_OUT ?? "dane/demo");
  const { paths, result } = await runDemo(path.resolve(args.sample ?? "data/sample"), out, (m) => console.error(`[demo] ${m}`));
  for (const it of result.items) console.log(`${it.id.padEnd(22)} ${it.verdict.padEnd(18)} ${it.campaign ?? it.newCampaign ?? "-"}  ${it.verdictText.slice(0, 90)}`);
  console.log(`\nWynik: ${paths.result}/wynik.json, wynik.csv. Baza do GUI: VIEWER_DATA_DIR=${paths.base} (lokalnie: bun run dev; w kontenerze: VIEWER_DATA_DIR=/dane/demo/baza docker compose up -d)`);
});
