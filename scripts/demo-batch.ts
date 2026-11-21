/** bun run demo-batch -- [--out dane] [--cases-name syntetyczne] [--new-name syntetyczne-nowe] [--sample data/sample] */
import path from "node:path";
import { writeSampleCases, writeSampleFiles } from "../lib/pipeline/sampleCases";
import { cli, main } from "./_cli";

const args = cli(
  {
    out: { type: "string" },
    "cases-name": { type: "string" },
    "new-name": { type: "string" },
    sample: { type: "string" },
  } as const,
  `Użycie: bun run demo-batch -- [--out dane] [--cases-name syntetyczne] [--new-name syntetyczne-nowe] [--sample data/sample]
Buduje z syntetycznej próbki dwa katalogi do wypróbowania kontenera bez własnych danych:
  <out>/<cases-name>/   4 sprawy (zapisana strona + zrzut), z których powstaje baza (bun run base)
  <out>/<new-name>/     luźne pliki do analizy (bun run analyze-material -- --cases ... --each-file)`,
);

void main(() => {
  const sample = path.resolve(args.sample ?? "data/sample");
  const out = path.resolve(args.out ?? "dane");
  const cases = writeSampleCases(sample, path.join(out, args["cases-name"] ?? "syntetyczne"), [
    { name: "sprawa-1", itemId: "c1-01" },
    { name: "sprawa-2", itemId: "c1-02" },
    { name: "sprawa-3", itemId: "c2-01" },
    { name: "sprawa-4", itemId: "c3-01" },
  ]);
  const files = writeSampleFiles(sample, path.join(out, args["new-name"] ?? "syntetyczne-nowe"), [
    { name: "kopia-jpeg", itemId: "c1-08" },
    { name: "wariant", itemId: "c2-02" },
    { name: "nowy", itemId: "n-01" },
  ]);
  console.log(`[demo-batch] sprawy: ${cases.length}, nowe pliki: ${files.length} -> ${out}`);
});
