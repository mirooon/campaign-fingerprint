/**
 * bun run sensitivity -- --enriched <file> [--labels <labels.json>] [--config <linking.json>] [--runs 50]
 *   [--spread 0.1,0.2,0.3] [--seed 1] [--one-at-a-time 0.7,1.3] [--thresholds 0.8,0.9,1.1,1.2] --out <folder>
 * bun run sensitivity -- --dump-config <file> --spread 0.2 [--seed 1] [--config <linking.json>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { perturbWeights } from "../lib/graph/sensitivity";
import { buildGraphConfigFile } from "../lib/pipeline/linkConfigFile";
import { truthFromLabels } from "../lib/pipeline/materialEval";
import { runSensitivity } from "../lib/pipeline/sensitivity";
import { DEFAULTS, loadLinkConfig } from "../lib/pipeline/steps";
import { cli, main } from "./_cli";

const args = cli(
  {
    enriched: { type: "string" },
    labels: { type: "string" },
    config: { type: "string" },
    runs: { type: "string" },
    spread: { type: "string" },
    seed: { type: "string" },
    "one-at-a-time": { type: "string" },
    thresholds: { type: "string" },
    out: { type: "string" },
    text: { type: "string" },
    "dump-config": { type: "string" },
  } as const,
  `Usage: bun run sensitivity -- --enriched <file> [--labels <labels.json>] [--config linking.json] [--runs 50] [--spread 0.1,0.2,0.3]
         [--seed 1] [--one-at-a-time 0.7,1.3] [--thresholds 0.8,0.9,1.1,1.2] --out <folder> [--text tfidf|embedding|none]
Measures how much the result depends on the exact weights (tunes nothing): (A) random perturbation of all weights at once by ±spread,
(B) each weight on its own × factors, (C) each threshold on its own × factors. Weights and thresholds are found by the field names of the configuration.
Base configuration as in build-graph (--config, otherwise the built-in weights). Result: <out>/sensitivity.json and sensitivity.md.
Truth labels: the label field of the ads from enriched; a --labels file ({"label": ["case", …]} or {"case": "label"}) fills them in and overrides them.
       bun run sensitivity -- --dump-config <file> --spread 0.2 [--seed 1] [--config linking.json]
writes one perturbed configuration (complete, to use as --config) and stops.`,
);

/** Comma-separated numbers ("0.1,0.2") → list; throws on anything that is not a finite number. */
function numbers(flag: string, text: string | undefined, fallback: number[]): number[] {
  if (text === undefined) return fallback;
  const out = text.split(",").map((s) => Number(s.trim()));
  if (!out.length || out.some((n) => !Number.isFinite(n))) throw new Error(`--${flag}: expected comma-separated numbers, got “${text}”`);
  return out;
}

/** A whole number from a flag, or the fallback; throws when the value is not an integer. */
function integer(flag: string, text: string | undefined, fallback: number): number {
  if (text === undefined) return fallback;
  const n = Number(text);
  if (!Number.isInteger(n)) throw new Error(`--${flag}: expected an integer, got “${text}”`);
  return n;
}

void main(async () => {
  const seed = integer("seed", args.seed, 1);
  const enriched = args.enriched ?? DEFAULTS.enriched;
  const config = buildGraphConfigFile(args.config, enriched);
  const dump = args["dump-config"];
  if (dump) {
    const [spread] = numbers("spread", args.spread, [0.2]);
    writeFileSync(dump, `${JSON.stringify({ ...perturbWeights(loadLinkConfig(config), { spread, seed }), replaceLists: true }, null, 2)}\n`, "utf8");
    console.log(`[sensitivity] perturbed configuration (±${spread}, seed ${seed}) written to ${dump}`);
    return;
  }
  if (!args.out) throw new Error("no --out <folder>");
  const text = (args.text ?? process.env.TEXT_SIMILARITY ?? "tfidf") as "tfidf" | "embedding" | "none";
  if (!["tfidf", "embedding", "none"].includes(text)) throw new Error(`--text: unknown method ${text}`);
  const result = await runSensitivity({
    enriched,
    config,
    labels: args.labels ? truthFromLabels(JSON.parse(readFileSync(args.labels, "utf8"))) : undefined,
    runs: integer("runs", args.runs, 50),
    spreads: numbers("spread", args.spread, [0.1, 0.2, 0.3]),
    seed,
    factors: numbers("one-at-a-time", args["one-at-a-time"], [0.7, 1.3]),
    thresholdFactors: numbers("thresholds", args.thresholds, [0.8, 0.9, 1.1, 1.2]),
    text,
    outDir: args.out,
  });
  console.log(`[sensitivity] wrote ${args.out}/sensitivity.json and sensitivity.md (base: pair F1 ${result.base.f1.toFixed(4)}, campaigns ${result.base.clusters})`);
});
