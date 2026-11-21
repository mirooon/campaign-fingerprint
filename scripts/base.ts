/** bun run base -- --cases <katalog spraw> [--out <katalog bazy>] [--offline | --lookups] [--labels etykiety.json] [--config linking.json] */
import path from "node:path";
import { runBase } from "../lib/pipeline/base";
import { cli, main } from "./_cli";

const args = cli(
  {
    cases: { type: "string" },
    out: { type: "string" },
    offline: { type: "boolean" },
    lookups: { type: "boolean" },
    labels: { type: "string" },
    config: { type: "string" },
  } as const,
  `Użycie: bun run base -- --cases <katalog spraw> [--out <katalog bazy>] [--offline | --lookups] [--labels etykiety.json] [--config linking.json]
Buduje bazę znanych kampanii ze spraw (podkatalogi z zapisaną stroną, HAR-em, zrzutem albo wideo): import-cases -> ingest -> enrich -> build-graph.
--out: domyślnie VIEWER_DATA_DIR (tam czyta GUI i analyze-material --data), a bez niego data/.
--offline: bez zapytań o DNS, RDAP i ASN; tylko to, co jest w zapisanych materiałach. Domyślnie włączone, gdy ANALYZE_OFFLINE=1 (kontener).
--lookups: wymusza pasywne zapytania o DNS, RDAP i ASN domen stron (sieć), także przy ANALYZE_OFFLINE=1.
--labels: opcjonalne etykiety referencyjne {"<kampania>": ["<id sprawy>", ...]} (tylko dla evaluate; baza ich nie wymaga).
--config: wagi łączenia; bez niego wagi wbudowane (nie konfiguracja próbki).
Brakujące narzędzia i modele (OCR, ASR, odcisk audio, CLIP) dają krok "skipped" z powodem w <out>/base.json.`,
);

void main(async () => {
  if (!args.cases) throw new Error("wymagane: --cases (zob. --help)");
  await runBase({
    casesDir: path.resolve(args.cases),
    outDir: path.resolve(args.out ?? process.env.VIEWER_DATA_DIR ?? "data"),
    offline: !args.lookups && (!!args.offline || process.env.ANALYZE_OFFLINE === "1"),
    labels: args.labels,
    config: args.config,
  });
});
