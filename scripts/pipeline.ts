/**
 * bun run pipeline --offline        # sample dataset, recorded fixtures, zero network
 * bun run pipeline -- --input dane.csv --mapping mapping.json   # live passive enrichment
 */
import { existsSync } from "node:fs";
import { formatEval } from "../lib/graph/eval";
import { DEFAULTS, runBuildGraph, runEnrich, runEvaluate, runIngest } from "../lib/pipeline/steps";
import { cli, main } from "./_cli";

const args = cli(
  {
    input: { type: "string" },
    mapping: { type: "string" },
    offline: { type: "boolean" },
    fixtures: { type: "string" },
    config: { type: "string" },
    text: { type: "string" },
    concurrency: { type: "string" },
    skip: { type: "string" },
    personas: { type: "string" },
    ner: { type: "boolean" },
    cloaking: { type: "boolean" },
    ocr: { type: "boolean" },
    asr: { type: "boolean" },
    audio: { type: "boolean" },
    clip: { type: "boolean" },
    speaker: { type: "boolean" },
    faces: { type: "boolean" },
    "verify-person": { type: "string" },
    "ad-library": { type: "boolean" },
    "company-registry": { type: "boolean" },
    "archive-lookup": { type: "boolean" },
  } as const,
  `Usage: bun run pipeline [--offline] [--input file] [--mapping mapping.json] [--fixtures dir] [--config linking.json] [--text tfidf|embedding|none] [--skip ct,...]
  [--personas list.json] [--ner] [--cloaking] [--ocr] [--asr] [--audio] [--clip] [--speaker] [--faces [--verify-person <person id>]] [--ad-library] [--company-registry] [--archive-lookup]
Steps: ingest -> enrich -> build-graph -> evaluate (if there are labels).`,
);

void main(async () => {
  const usingSample = !args.input;
  runIngest({
    input: args.input ?? DEFAULTS.input,
    mapping: args.mapping ?? (usingSample ? DEFAULTS.mapping : undefined),
    out: DEFAULTS.items,
  });
  await runEnrich({
    items: DEFAULTS.items,
    out: DEFAULTS.enriched,
    offline: !!args.offline,
    fixtures: args.fixtures ?? DEFAULTS.fixtures,
    concurrency: args.concurrency ? Number(args.concurrency) : undefined,
    skip: args.skip ? args.skip.split(",") : [],
    personas: args.personas ?? (usingSample ? DEFAULTS.personas : undefined),
    ner: !!args.ner,
    cloaking: !!args.cloaking,
    ocr: !!args.ocr,
    asr: !!args.asr,
    audio: !!args.audio,
    clip: !!args.clip,
    speaker: !!args.speaker,
    faces: !!args.faces,
    facesOnly: args["verify-person"],
    adLibrary: !!args["ad-library"],
    companyRegistry: !!args["company-registry"],
    archiveLookup: !!args["archive-lookup"],
  });
  const config = args.config ?? (usingSample && existsSync(DEFAULTS.config) ? DEFAULTS.config : undefined);
  const text = (args.text ?? process.env.TEXT_SIMILARITY ?? "tfidf") as "tfidf" | "embedding" | "none";
  await runBuildGraph({ enriched: DEFAULTS.enriched, graph: DEFAULTS.graph, campaigns: DEFAULTS.campaigns, config, text });
  const { result } = runEvaluate({ graph: DEFAULTS.graph, campaigns: DEFAULTS.campaigns });
  if (result) console.log(`\n[evaluate]\n${formatEval(result)}`);
});
