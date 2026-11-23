/**
 * bun run analyze-material -- (--case <case folder> | --cases <folder of cases> [--each-file] | --dataset <file> [--mapping m.json] | --url <link> | --text <text>)
 *   [--data <run folder>] [--csv result.csv] [--json result.json] [--live] [--archive] [--asr] [--audio] [--clip] [--speaker] [--faces [--verify-person <person id>]] [--ad-library] [--add-to-base [--force]]
 * Analysis of a new sample (one case or a batch of cases) against an existing run (graph.json, campaigns.json, enriched.json).
 */
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { addToBase } from "../lib/pipeline/addToBase";
import { analyzeMaterial, type AnalyzedMaterial } from "../lib/pipeline/analyzeMaterial";
import { batchCaseDirs } from "../lib/pipeline/caseBatch";
import { materialCsv, skippedCsvRows } from "../lib/pipeline/materialCsv";
import { liveSources } from "../lib/pipeline/sources";
import { archiveStepOptions } from "../lib/pipeline/archiveContext";
import { loadLinkConfig } from "../lib/pipeline/steps";
import { compileWatchlist, loadWatchlist, PUBLIC_PERSONS_FILE } from "../lib/text/persona";
import { cli, main } from "./_cli";

const args = cli(
  {
    case: { type: "string" },
    cases: { type: "string" },
    "each-file": { type: "boolean" },
    dataset: { type: "string" },
    mapping: { type: "string" },
    url: { type: "string" },
    text: { type: "string" },
    data: { type: "string" },
    work: { type: "string" },
    config: { type: "string" },
    personas: { type: "string" },
    live: { type: "boolean" },
    archive: { type: "boolean" },
    asr: { type: "boolean" },
    audio: { type: "boolean" },
    clip: { type: "boolean" },
    speaker: { type: "boolean" },
    faces: { type: "boolean" },
    "verify-person": { type: "string" },
    "ad-library": { type: "boolean" },
    "add-to-base": { type: "boolean" },
    force: { type: "boolean" },
    csv: { type: "string" },
    json: { type: "string" },
    out: { type: "string" },
    fixtures: { type: "string" },
  } as const,
  `Usage: bun run analyze-material -- (--case <case folder> | --cases <folder of cases> [--each-file] | --dataset <file.csv|.json|.jsonl> [--mapping m.json] | --url <link> | --text <text>) [--data <run folder>] [--csv result.csv] [--json result.json] [--live] [--archive] [--asr] [--audio] [--clip] [--speaker] [--faces [--verify-person <person id>]] [--ad-library] [--add-to-base [--force]]
--cases: every subfolder is a case; all go through one import and one graph. --each-file: every loose file in the folder is a case of its own.
--dataset: every row of the dataset file is a sample (column mapping as in bun run ingest; --mapping as there). Image paths are relative to the folder of the file.
--csv: batch result, one row per record (material_id, case, verdict, campaign_id, similar_campaigns, new_campaign_id, duplicate_of, confidence, score, top_premise, missing_data, near_misses).
--json: full result (MaterialResult) to a file; "-" = to standard output. --out: the same to a file (used by the viewer).
--data: folder with graph.json, campaigns.json and enriched.json (default VIEWER_DATA_DIR or data/).
--live: passive DNS, RDAP and ASN plus one GET of a page that is not in the sample. Without it, only the sample.
--archive: for a page that does not respond (or shows a block page), looks for a public copy in urlscan.io and the Internet Archive (Wayback); the copy enters the sample with its source, URL and date, and a copy from before the domain was registered is rejected. Passive: it requests and saves nothing. Sources: ARCHIVE_SOURCES (default urlscan,wayback); optional urlscan key: URLSCAN_API_KEY. With ANALYZE_OFFLINE=1 or without a network the step is skipped with the reason in the "archive" step.
--data from a non-public pack has paths relative to the cases: point CASES_DIR at your own copy of the cases (without it the image comparison with the base is skipped, with the reason in the notes).
--add-to-base: after the analysis adds the samples to the base in --data (records and comparison data, graph and campaigns rebuilt offline; campaigns keep their numbers), then lists what was added, what was not and why. A duplicate is not added, "insufficient data" only with --force. Earlier base files: <base>/historia/<time>/, entries: <base>/dodane.jsonl.
--config / --personas: weight configuration and list of people (default <data>/linking.json and <data>/personas.json or the folder above, and for people finally data/osoby-publiczne.json).`,
);

void main(async () => {
  if (!args.case && !args.cases && !args.dataset && !args.url && !args.text) throw new Error("give --case, --cases, --dataset, --url or --text (see --help)");
  const dataDir = path.resolve(args.data ?? process.env.VIEWER_DATA_DIR ?? "data");
  const workDir = path.resolve(args.work ?? mkdtempSync(path.join(os.tmpdir(), "analiza-")));
  const pick = (...files: string[]) => files.find((f) => existsSync(f));
  const configFile = args.config ?? process.env.LINK_CONFIG ?? pick(path.join(dataDir, "linking.json"), path.join(dataDir, "..", "linking-default.json"));
  // the closed list of public figures (also the face reference) is the fallback of the text persona
  const personasFile = args.personas ?? process.env.PERSONAS ?? pick(path.join(dataDir, "personas.json"), path.join(dataDir, "..", "personas.json"), path.join(process.cwd(), PUBLIC_PERSONS_FILE));
  const log = (m: string) => console.error(`[analysis] ${m}`);
  const caseDirs = args.cases ? batchCaseDirs(args.cases, { eachFile: !!args["each-file"], scratchDir: workDir }) : undefined;
  if (caseDirs && !caseDirs.length) throw new Error(`no cases in ${args.cases} (subfolders, or --each-file for loose files)`);
  let captured: AnalyzedMaterial | undefined;
  const res = await analyzeMaterial(
    { caseDir: args.case ? path.resolve(args.case) : undefined, caseDirs, datasetFile: args.dataset, datasetMapping: args.mapping, url: args.url, text: args.text },
    {
      dataDir,
      workDir,
      fixtures: args.fixtures,
      casesDir: process.env.CASES_DIR || undefined,
      live: args.live ? liveSources({ skipCt: true }) : null,
      archive: archiveStepOptions({ enabled: !!args.archive, screenshotDir: path.join(workDir, "archiwum") }),
      config: loadLinkConfig(configFile),
      personas: personasFile ? compileWatchlist(loadWatchlist(personasFile)) : null,
      media: { ocr: true, asr: !!args.asr, audio: !!args.audio, clip: !!args.clip, speaker: !!args.speaker, faces: !!args.faces, facesOnly: args["verify-person"], adLibrary: !!args["ad-library"] },
      log,
      onAnalyzed: (a) => (captured = a),
    },
  );
  if (args.out) writeFileSync(args.out, JSON.stringify(res));
  if (args.csv) {
    writeFileSync(args.csv, materialCsv(res));
    const noRecord = skippedCsvRows(res).length;
    log(`CSV: ${args.csv} (${res.items.length + noRecord} ${res.items.length + noRecord === 1 ? "row" : "rows"}${noRecord ? `, including ${noRecord} ${noRecord === 1 ? "case" : "cases"} without a record from the import as insufficient` : ""})`);
  }
  if (args.json === "-") {
    process.stdout.write(JSON.stringify(res));
    return;
  }
  if (args.json) writeFileSync(args.json, JSON.stringify(res, null, 1));
  for (const n of res.notes) log(n);
  const counts = new Map<string, number>();
  for (const it of res.items) counts.set(it.verdict, (counts.get(it.verdict) ?? 0) + 1);
  log(`verdicts: ${[...counts.entries()].map(([k, v]) => `${k} ${v}`).join(", ")}${res.newCampaigns?.length ? ` | new campaigns: ${res.newCampaigns.length}` : ""}`);
  if (args["add-to-base"] && captured) {
    const added = await addToBase(dataDir, { result: res, captured }, { source: "cli", force: !!args.force, log });
    for (const a of added.added) log(`added to the base: ${a.id} (${a.verdict}${a.campaign ? `, campaign ${a.campaign}` : ""})`);
    for (const s of added.skipped) log(`not added: ${s.id}: ${s.reason}${s.duplicateOf ? ` (${s.duplicateOf})` : ""}`);
    if (added.createdCampaigns.length) log(`new campaigns in the base: ${added.createdCampaigns.join(", ")}`);
  }
  if (args.csv || args.json) return;
  for (const it of res.items) {
    console.log(`\n${it.id}${it.caseId && it.caseId !== it.id ? ` [${it.caseId}]` : ""}: ${it.verdictText}`);
    for (const [k, v] of Object.entries(it.features)) if (!["ocrText", "asrText"].includes(k)) console.log(`   ${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
    for (const l of it.links.slice(0, 5)) {
      console.log(`   ↔ ${l.other} (${l.otherCampaign ?? "-"}) score ${l.score.toFixed(2)}${l.strong ? " STRONG" : ""} [${l.rule}]`);
      for (const e of l.evidence.slice(0, 3)) console.log(`        ${e.weight.toFixed(2)} ${e.evidence.slice(0, 120)}`);
    }
  }
});
