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
  `Usage: bun run base -- --cases <folder of cases> [--out <base folder>] [--offline | --lookups] [--labels labels.json] [--config linking.json]
Builds a base of known campaigns from cases (subfolders with a saved page, a HAR, a screenshot or a video): import-cases -> ingest -> enrich -> build-graph.
--out: default VIEWER_DATA_DIR (where the GUI and analyze-material --data read from), and without it data/.
--offline: no DNS, RDAP or ASN queries; only what the saved samples hold. On by default when ANALYZE_OFFLINE=1 (container).
--lookups: forces passive DNS, RDAP and ASN queries for the domains of the pages (network), also with ANALYZE_OFFLINE=1.
--labels: optional reference labels {"<campaign>": ["<case id>", ...]} (only for evaluate; the base does not need them).
--config: linking weights; without it the built-in weights (not the sample configuration).
Missing tools and models (OCR, ASR, audio fingerprint, CLIP) give a "skipped" step with the reason in <out>/base.json.`,
);

void main(async () => {
  if (!args.cases) throw new Error("required: --cases (see --help)");
  await runBase({
    casesDir: path.resolve(args.cases),
    outDir: path.resolve(args.out ?? process.env.VIEWER_DATA_DIR ?? "data"),
    offline: !args.lookups && (!!args.offline || process.env.ANALYZE_OFFLINE === "1"),
    labels: args.labels,
    config: args.config,
  });
});
