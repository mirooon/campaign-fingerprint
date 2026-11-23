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
  `Usage: bun run ingest -- [--input file.csv|.json|.jsonl] [--mapping mapping.json] [--out items.json] [--base-dir image_folder]
Without --mapping the columns are recognized automatically (Polish and English synonyms).`,
);

void main(() => {
  runIngest({
    input: args.input ?? DEFAULTS.input,
    mapping: args.mapping ?? (args.input ? undefined : DEFAULTS.mapping),
    out: args.out ?? DEFAULTS.items,
    baseDir: args["base-dir"],
  });
});
