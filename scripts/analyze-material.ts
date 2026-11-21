/**
 * bun run analyze-material -- (--case <katalog sprawy> | --url <link> | --text <treść>) [--data <katalog przebiegu>] [--live] [--asr] [--audio] [--clip] [--speaker] [--ad-library] [--json]
 * Analiza nowego materiału względem istniejącego przebiegu (graph.json, campaigns.json, enriched.json).
 */
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeMaterial } from "../lib/pipeline/analyzeMaterial";
import { liveSources } from "../lib/pipeline/sources";
import { loadLinkConfig } from "../lib/pipeline/steps";
import { compileWatchlist, loadWatchlist } from "../lib/text/persona";
import { cli, main } from "./_cli";

const args = cli(
  {
    case: { type: "string" },
    url: { type: "string" },
    text: { type: "string" },
    data: { type: "string" },
    work: { type: "string" },
    config: { type: "string" },
    personas: { type: "string" },
    live: { type: "boolean" },
    asr: { type: "boolean" },
    audio: { type: "boolean" },
    clip: { type: "boolean" },
    speaker: { type: "boolean" },
    "ad-library": { type: "boolean" },
    json: { type: "boolean" },
    out: { type: "string" },
    fixtures: { type: "string" },
  } as const,
  `Użycie: bun run analyze-material -- (--case <katalog sprawy> | --url <link> | --text <treść>) [--data <katalog przebiegu>] [--live] [--asr] [--audio] [--clip] [--speaker] [--ad-library] [--json]
--data: katalog z graph.json, campaigns.json i enriched.json (domyślnie VIEWER_DATA_DIR albo data/).
--live: pasywne DNS, RDAP i ASN oraz jeden GET strony, której nie ma w materiale. Bez tego tylko materiał.
--config / --personas: konfiguracja wag i lista osób (domyślnie <data>/linking.json i <data>/personas.json albo katalog wyżej).`,
);

void main(async () => {
  if (!args.case && !args.url && !args.text) throw new Error("podaj --case, --url albo --text (zob. --help)");
  const dataDir = path.resolve(args.data ?? process.env.VIEWER_DATA_DIR ?? "data");
  const pick = (...files: string[]) => files.find((f) => existsSync(f));
  const configFile = args.config ?? process.env.LINK_CONFIG ?? pick(path.join(dataDir, "linking.json"), path.join(dataDir, "..", "linking-default.json"));
  const personasFile = args.personas ?? process.env.PERSONAS ?? pick(path.join(dataDir, "personas.json"), path.join(dataDir, "..", "personas.json"));
  const log = (m: string) => console.error(`[analiza] ${m}`);
  const res = await analyzeMaterial(
    { caseDir: args.case ? path.resolve(args.case) : undefined, url: args.url, text: args.text },
    {
      dataDir,
      workDir: path.resolve(args.work ?? mkdtempSync(path.join(os.tmpdir(), "analiza-"))),
      fixtures: args.fixtures,
      live: args.live ? liveSources({ skipCt: true }) : null,
      config: loadLinkConfig(configFile),
      personas: personasFile ? compileWatchlist(loadWatchlist(personasFile)) : null,
      media: { ocr: true, asr: !!args.asr, audio: !!args.audio, clip: !!args.clip, speaker: !!args.speaker, adLibrary: !!args["ad-library"] },
      log,
    },
  );
  if (args.out) writeFileSync(args.out, JSON.stringify(res));
  if (args.json) {
    process.stdout.write(JSON.stringify(res));
    return;
  }
  for (const n of res.notes) log(n);
  for (const it of res.items) {
    console.log(`\n${it.id}: ${it.verdictText}`);
    for (const [k, v] of Object.entries(it.features)) if (!["ocrText", "asrText"].includes(k)) console.log(`   ${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
    for (const l of it.links.slice(0, 5)) {
      console.log(`   ↔ ${l.other} (${l.otherCampaign ?? "-"}) wynik ${l.score.toFixed(2)}${l.strong ? " SILNE" : ""} [${l.rule}]`);
      for (const e of l.evidence.slice(0, 3)) console.log(`        ${e.weight.toFixed(2)} ${e.evidence.slice(0, 120)}`);
    }
  }
});
