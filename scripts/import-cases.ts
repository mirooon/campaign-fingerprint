/** bun run import-cases -- --cases <katalog spraw> --out <katalog roboczy> [--lookups] [--ct] */
import { importCases } from "../lib/pipeline/caseImport";
import { liveLookups } from "../lib/pipeline/liveLookups";
import { cli, main } from "./_cli";

const args = cli(
  {
    cases: { type: "string" },
    out: { type: "string" },
    lookups: { type: "boolean" },
    ct: { type: "boolean" },
  } as const,
  `Użycie: bun run import-cases -- --cases <katalog spraw> --out <katalog roboczy> [--lookups] [--ct]
Każda sprawa to podkatalog z zapisaną stroną (HTML + <nazwa>_files), plikiem HAR i zrzutem ekranu reklamy (dowolny podzbiór).
Wynik: input.json, mapping.json, provenance.json i fixtures/ dla trybu offline. Stron docelowych nie pobiera.
--lookups: pasywne zapytania o domeny stron docelowych (DNS, RDAP przez rdap.org, ASN przez Team Cymru).
--ct: dodatkowo crt.sh (wolne, bywa niedostępne).
Dalej: bun run ingest -- --input <out>/input.json --mapping <out>/mapping.json --out <out>/items.json --base-dir <out>
       bun run enrich -- --items <out>/items.json --out <out>/enriched.json --offline --fixtures <out>/fixtures --archive <out>/archive [--ocr] [--clip]
       bun run build-graph -- --enriched <out>/enriched.json --graph <out>/graph.json --campaigns <out>/campaigns.json`,
);

void main(async () => {
  if (!args.cases || !args.out) throw new Error("wymagane: --cases i --out (zob. --help)");
  const res = await importCases({
    casesDir: args.cases,
    outDir: args.out,
    lookups: args.lookups || args.ct ? liveLookups(!!args.ct) : undefined,
    log: (m) => console.log(m),
  });
  for (const s of res.skipped) console.warn(`[${s.id}] pominięta: ${s.reason}`);
  if (res.failedLookups.length) console.warn(`[import-cases] bez odpowiedzi (uruchom ponownie, gotowe pliki są pomijane): ${res.failedLookups.join(", ")}`);
  console.log(`[import-cases] spraw: ${res.cases.length}, pominiętych: ${res.skipped.length}, odpowiedzi HTTP w fixtures: ${res.httpEntries} -> ${args.out}`);
});
