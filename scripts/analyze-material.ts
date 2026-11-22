/**
 * bun run analyze-material -- (--case <katalog sprawy> | --cases <katalog spraw> [--each-file] | --dataset <plik> [--mapping m.json] | --url <link> | --text <treść>)
 *   [--data <katalog przebiegu>] [--csv wynik.csv] [--json wynik.json] [--live] [--archive] [--asr] [--audio] [--clip] [--speaker] [--faces [--verify-person <id osoby>]] [--ad-library] [--add-to-base [--force]]
 * Analiza nowego materiału (jednej sprawy albo partii spraw) względem istniejącego przebiegu (graph.json, campaigns.json, enriched.json).
 */
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { addToBase } from "../lib/pipeline/addToBase";
import { analyzeMaterial, type AnalyzedMaterial } from "../lib/pipeline/analyzeMaterial";
import { batchCaseDirs } from "../lib/pipeline/caseBatch";
import { materialCsv } from "../lib/pipeline/materialCsv";
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
  `Użycie: bun run analyze-material -- (--case <katalog sprawy> | --cases <katalog spraw> [--each-file] | --dataset <plik.csv|.json|.jsonl> [--mapping m.json] | --url <link> | --text <treść>) [--data <katalog przebiegu>] [--csv wynik.csv] [--json wynik.json] [--live] [--archive] [--asr] [--audio] [--clip] [--speaker] [--faces [--verify-person <id osoby>]] [--ad-library] [--add-to-base [--force]]
--cases: każdy podkatalog to sprawa; wszystkie idą przez jeden import i jeden graf. --each-file: każdy luźny plik w katalogu to osobna sprawa.
--dataset: każdy wiersz pliku zbioru to materiał (mapowanie kolumn jak w bun run ingest; --mapping jak tam). Ścieżki obrazów względem katalogu pliku.
--csv: wynik partii, wiersz na rekord (material_id, case, verdict, campaign_id, similar_campaigns, new_campaign_id, duplicate_of, confidence, score, top_premise, missing_data).
--json: pełny wynik (MaterialResult) do pliku; "-" = na standardowe wyjście. --out: to samo do pliku (używa przeglądarka).
--data: katalog z graph.json, campaigns.json i enriched.json (domyślnie VIEWER_DATA_DIR albo data/).
--live: pasywne DNS, RDAP i ASN oraz jeden GET strony, której nie ma w materiale. Bez tego tylko materiał.
--archive: dla strony, która nie odpowiada (albo pokazuje planszę blokady), szuka publicznej kopii w urlscan.io i Internet Archive (Wayback); kopia wchodzi do materiału z podanym źródłem, adresem i datą, a kopia sprzed rejestracji domeny jest odrzucana. Pasywnie: nic nie zleca ani nie zapisuje. Źródła: ARCHIVE_SOURCES (domyślnie urlscan,wayback); opcjonalny klucz urlscan: URLSCAN_API_KEY. Przy ANALYZE_OFFLINE=1 albo bez sieci krok jest pomijany z powodem w kroku "archive".
--data z paczki niepublicznej ma ścieżki względne do spraw: wskaż własną kopię spraw w CASES_DIR (bez niej porównanie obrazów z bazą jest pomijane, z powodem w notatkach).
--add-to-base: po analizie dopisuje materiały do bazy w --data (rekordy i dane z porównania, graf i kampanie przebudowane offline; kampanie zachowują numery), a potem wypisuje, co dodano, a czego nie i dlaczego. Duplikat nie jest dopisywany, "za mało danych" tylko z --force. Poprzednie pliki bazy: <baza>/historia/<czas>/, wpisy: <baza>/dodane.jsonl.
--config / --personas: konfiguracja wag i lista osób (domyślnie <data>/linking.json i <data>/personas.json albo katalog wyżej, a dla osób na końcu data/osoby-publiczne.json).`,
);

void main(async () => {
  if (!args.case && !args.cases && !args.dataset && !args.url && !args.text) throw new Error("podaj --case, --cases, --dataset, --url albo --text (zob. --help)");
  const dataDir = path.resolve(args.data ?? process.env.VIEWER_DATA_DIR ?? "data");
  const workDir = path.resolve(args.work ?? mkdtempSync(path.join(os.tmpdir(), "analiza-")));
  const pick = (...files: string[]) => files.find((f) => existsSync(f));
  const configFile = args.config ?? process.env.LINK_CONFIG ?? pick(path.join(dataDir, "linking.json"), path.join(dataDir, "..", "linking-default.json"));
  // the closed list of public figures (also the face reference) is the fallback of the text persona
  const personasFile = args.personas ?? process.env.PERSONAS ?? pick(path.join(dataDir, "personas.json"), path.join(dataDir, "..", "personas.json"), path.join(process.cwd(), PUBLIC_PERSONS_FILE));
  const log = (m: string) => console.error(`[analiza] ${m}`);
  const caseDirs = args.cases ? batchCaseDirs(args.cases, { eachFile: !!args["each-file"], scratchDir: workDir }) : undefined;
  if (caseDirs && !caseDirs.length) throw new Error(`brak spraw w ${args.cases} (podkatalogi albo --each-file dla luźnych plików)`);
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
    log(`CSV: ${args.csv} (${res.items.length} wierszy)`);
  }
  if (args.json === "-") {
    process.stdout.write(JSON.stringify(res));
    return;
  }
  if (args.json) writeFileSync(args.json, JSON.stringify(res, null, 1));
  for (const n of res.notes) log(n);
  const counts = new Map<string, number>();
  for (const it of res.items) counts.set(it.verdict, (counts.get(it.verdict) ?? 0) + 1);
  log(`werdykty: ${[...counts.entries()].map(([k, v]) => `${k} ${v}`).join(", ")}${res.newCampaigns?.length ? ` | nowe kampanie: ${res.newCampaigns.length}` : ""}`);
  if (args["add-to-base"] && captured) {
    const added = await addToBase(dataDir, { result: res, captured }, { source: "cli", force: !!args.force, log });
    for (const a of added.added) log(`dodano do bazy: ${a.id} (${a.verdict}${a.campaign ? `, kampania ${a.campaign}` : ""})`);
    for (const s of added.skipped) log(`nie dodano: ${s.id}: ${s.reason}${s.duplicateOf ? ` (${s.duplicateOf})` : ""}`);
    if (added.createdCampaigns.length) log(`nowe kampanie w bazie: ${added.createdCampaigns.join(", ")}`);
  }
  if (args.csv || args.json) return;
  for (const it of res.items) {
    console.log(`\n${it.id}${it.caseId && it.caseId !== it.id ? ` [${it.caseId}]` : ""}: ${it.verdictText}`);
    for (const [k, v] of Object.entries(it.features)) if (!["ocrText", "asrText"].includes(k)) console.log(`   ${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
    for (const l of it.links.slice(0, 5)) {
      console.log(`   ↔ ${l.other} (${l.otherCampaign ?? "-"}) wynik ${l.score.toFixed(2)}${l.strong ? " SILNE" : ""} [${l.rule}]`);
      for (const e of l.evidence.slice(0, 3)) console.log(`        ${e.weight.toFixed(2)} ${e.evidence.slice(0, 120)}`);
    }
  }
});
