/** bun run ingest -- --input data/sample/ads.csv --mapping data/sample/mapping.json --out data/work/items.json */
import { DEFAULTS, runIngest } from "../lib/pipeline/steps";
import { cli, main } from "./_cli";

const args = cli(
  {
    input: { type: "string" },
    mapping: { type: "string" },
    out: { type: "string" },
    "base-dir": { type: "string" },
  } as const,
  `Użycie: bun run ingest -- [--input plik.csv|.json|.jsonl] [--mapping mapping.json] [--out items.json] [--base-dir katalog_obrazów]
Bez --mapping kolumny są rozpoznawane automatycznie (synonimy PL/EN).`,
);

void main(() => {
  runIngest({
    input: args.input ?? DEFAULTS.input,
    mapping: args.mapping ?? (args.input ? undefined : DEFAULTS.mapping),
    out: args.out ?? DEFAULTS.items,
    baseDir: args["base-dir"],
  });
});
