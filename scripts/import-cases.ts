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
  `Usage: bun run import-cases -- --cases <folder of cases> --out <work folder> [--lookups] [--ct]
Each case is a subfolder with a saved page (HTML + <name>_files), a HAR file and a screenshot of the ad (any subset).
Result: input.json, mapping.json, provenance.json and fixtures/ for the offline mode. It does not fetch the landing pages.
--lookups: passive queries about the domains of the landing pages (DNS, RDAP through rdap.org, ASN through Team Cymru).
--ct: crt.sh as well (slow, sometimes unavailable).
Next: bun run ingest -- --input <out>/input.json --mapping <out>/mapping.json --out <out>/items.json --base-dir <out>
       bun run enrich -- --items <out>/items.json --out <out>/enriched.json --offline --fixtures <out>/fixtures --archive <out>/archive [--ocr] [--clip]
       bun run build-graph -- --enriched <out>/enriched.json --graph <out>/graph.json --campaigns <out>/campaigns.json`,
);

void main(async () => {
  if (!args.cases || !args.out) throw new Error("required: --cases and --out (see --help)");
  const res = await importCases({
    casesDir: args.cases,
    outDir: args.out,
    lookups: args.lookups || args.ct ? liveLookups(!!args.ct) : undefined,
    log: (m) => console.log(m),
  });
  for (const s of res.skipped) console.warn(`[${s.id}] skipped: ${s.reason}`);
  if (res.failedLookups.length) console.warn(`[import-cases] no answer (run again, finished files are skipped): ${res.failedLookups.join(", ")}`);
  console.log(`[import-cases] cases: ${res.cases.length}, skipped: ${res.skipped.length}, HTTP responses in fixtures: ${res.httpEntries} -> ${args.out}`);
});
