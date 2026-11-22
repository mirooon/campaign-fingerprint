/**
 * bun run watch -- --data <baza> [--every 30m] [--sources ct,adlibrary,urlscan,certlist] [--recipes przepisy.json] [--once]
 *   [--replay plik.jsonl] [--offline] [--file data/watch.jsonl] [--add-to-base [--add-verdicts known_campaign]]
 * Harmonogram skanów: co cykl pyta publiczne źródła o nowe adresy, każdy przepuszcza przez analizę względem bazy
 * i dopisuje wiersz do data/watch.jsonl. Źródło bez sieci albo klucza jest pomijane z powodem.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { adRecordToCaseDir, createSources } from "../lib/adlib";
import { replayCertstream, runCtStream, type CtStreamEvent } from "../lib/ct/stream";
import { createUrlscanSource } from "../lib/osint/archive/urlscan";
import { addToBase } from "../lib/pipeline/addToBase";
import { analyzeMaterial, type AnalyzedMaterial, type MaterialResult, type MaterialVerdict } from "../lib/pipeline/analyzeMaterial";
import { fixtureSources, liveSources } from "../lib/pipeline/sources";
import type { CampaignsFile, EvidenceGraph } from "../lib/graph/model";
import { DEFAULTS, loadLinkConfig, readJson, writeJson } from "../lib/pipeline/steps";
import { createHitAnalyzer } from "../lib/watch/analyze";
import { parseCertlist } from "../lib/watch/certlist";
import { WATCH_CONFIG } from "../lib/watch/config";
import { seedRecipes } from "../lib/watch/seed";
import { loadRecipes } from "../lib/watch/recipes";
import { parseEvery, runWatch, type WatchSource, type WatchSourceName } from "../lib/watch/schedule";
import { createAdlibWatchSource, createCertlistWatchSource, createCtWatchSource, createUrlscanWatchSource } from "../lib/watch/sources";
import { LOCAL_STREAM, PUBLIC_STREAM, loadCampaignInfra, loadFingerprints } from "./_ct";
import { cli, main } from "./_cli";

const VERDICTS: MaterialVerdict[] = ["known_campaign", "similar_campaigns", "new_campaign", "duplicate", "insufficient"];

const args = cli(
  {
    data: { type: "string" },
    every: { type: "string" },
    sources: { type: "string" },
    recipes: { type: "string" },
    once: { type: "boolean" },
    replay: { type: "string" },
    offline: { type: "boolean" },
    file: { type: "string" },
    "add-to-base": { type: "boolean" },
    "add-verdicts": { type: "string" },
    url: { type: "string" },
    "seed-recipes": { type: "string" },
  } as const,
  `Użycie: bun run watch -- --data <baza> [--every ${WATCH_CONFIG.defaultEvery}] [--sources ${WATCH_CONFIG.sources.join(",")}] [--recipes przepisy.json] [--once]
  [--replay plik.jsonl] [--offline] [--file ${WATCH_CONFIG.file}] [--add-to-base [--add-verdicts ${WATCH_CONFIG.addVerdicts.join(",")}]]
Co cykl pyta źródła (logi CT, biblioteki reklam, urlscan, Lista Ostrzeżeń CERT) o nowe adresy; każdy trafia do analizy względem bazy (--data),
a wynik { ts, source, url, verdict, campaign } do pliku JSONL (tylko dopisywanie; ten sam adres nie jest analizowany drugi raz).
--recipes: przepisy wyszukiwania (JSON; także WATCH_RECIPES); format i przykład: data/examples/watch-przepisy.example.json.
--replay: odtwarza zapisane wiadomości CertStream zamiast strumienia (demo offline; implikuje --offline: pozostałe źródła są pomijane).
--offline: bez sieci (także ANALYZE_OFFLINE=1): źródła sieciowe są pomijane z powodem, analiza tylko z materiału.
--seed-recipes <plik>: zamiast skanować zapisuje przepisy zrobione z bazy (silne cechy każdej kampanii: adres IP spoza CDN, plik, identyfikator ścieżki); plik zawiera wartości prawdziwych kampanii, więc zapisz go poza repozytorium.
--once: jeden cykl i koniec (kod 0, także gdy źródła zostały pominięte).
--add-to-base: trafienia z werdyktem z --add-verdicts (domyślnie ${WATCH_CONFIG.addVerdicts.join(",")}) są dopisywane do bazy (kampanie zachowują numery; kopia poprzednich plików w <baza>/historia/).
Klucz urlscan (opcjonalny, daje DOM): URLSCAN_API_KEY. Strumień CT: --url albo CT_STREAM_URL (domyślnie lokalny certstream-server-go, potem publiczny).`,
);

/** Names from `--sources`, validated against the sources the scheduler knows. */
function sourceNames(text: string | undefined): WatchSourceName[] {
  const names = (text ?? WATCH_CONFIG.sources.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const bad = names.filter((n) => !(WATCH_CONFIG.sources as readonly string[]).includes(n));
  if (bad.length) throw new Error(`nieznane źródło: ${bad.join(", ")} (są: ${WATCH_CONFIG.sources.join(", ")})`);
  return names as WatchSourceName[];
}

/** Verdicts of `--add-verdicts`, validated. */
function addVerdicts(text: string | undefined): MaterialVerdict[] {
  if (!text) return WATCH_CONFIG.addVerdicts;
  const list = text.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = list.filter((v) => !(VERDICTS as string[]).includes(v));
  if (bad.length) throw new Error(`nieznany werdykt: ${bad.join(", ")} (są: ${VERDICTS.join(", ")})`);
  return list as MaterialVerdict[];
}

/** A source that is switched off with the reason (the offline mode): it keeps its place in the report. */
const switchedOff = (name: WatchSourceName, reason: string): WatchSource => ({ name, poll: async () => ({ hits: [], skipped: reason }) });

void main(async () => {
  const dataDir = path.resolve(args.data ?? process.env.VIEWER_DATA_DIR ?? "data");
  const file = path.resolve(args.file || process.env.WATCH_FILE || WATCH_CONFIG.file);
  if (args["seed-recipes"]) {
    const recipes = seedRecipes(readJson<EvidenceGraph>(path.join(dataDir, "graph.json")), readJson<CampaignsFile>(path.join(dataDir, "campaigns.json")));
    writeJson(args["seed-recipes"], { version: 1, recipes });
    console.log(`[watch] przepisy z bazy: ${recipes.length} → ${args["seed-recipes"]}`);
    return;
  }
  const recipesFile = args.recipes ?? process.env.WATCH_RECIPES;
  const recipes = recipesFile ? loadRecipes(recipesFile) : [];
  const offline = !!(args.offline || args.replay || process.env.ANALYZE_OFFLINE === "1");
  const everyMs = parseEvery(args.every ?? WATCH_CONFIG.defaultEvery);
  const verdicts = addVerdicts(args["add-verdicts"]);
  /** Progress line of the scheduler on the standard output. */
  const log = (m: string) => console.log(m);
  const baseConfigFile = path.join(dataDir, "linking.json");
  const live = offline ? null : liveSources({ skipCt: true });
  const offReason = "tryb offline: bez zapytań sieciowych";

  /** The source of the given name, wired to the real network parts (or switched off in the offline mode). */
  const build = (name: WatchSourceName): WatchSource => {
    if (name === "ct") {
      const set = loadFingerprints({ campaigns: path.join(dataDir, "campaigns.json"), graph: path.join(dataDir, "graph.json"), config: baseConfigFile });
      const urls = (args.url ?? process.env.CT_STREAM_URL ?? `${LOCAL_STREAM},${PUBLIC_STREAM}`).split(",").map((u) => u.trim()).filter(Boolean);
      return createCtWatchSource({
        set,
        infra: loadCampaignInfra(dataDir, path.join(dataDir, "campaigns.json")),
        // a replay never touches the network: the enrichment answers come from the sample fixtures, as in ct:watch --replay
        enrich: { sources: offline ? fixtureSources(DEFAULTS.fixtures) : live! },
        source: args.replay ? "replay" : "certstream",
        collect: async () => {
          const events: CtStreamEvent[] = [];
          if (args.replay) {
            replayCertstream(readFileSync(args.replay, "utf8").split("\n"), (e) => events.push(e));
            return { events };
          }
          if (offline) return { events, skipped: offReason };
          const res = await runCtStream({ urls, onEvent: (e) => events.push(e), durationMs: WATCH_CONFIG.ctWindowSeconds * 1000 });
          if (res.status === "unavailable") return { events, skipped: `żaden strumień CT nie odpowiada (${res.attempts.map((a) => `${a.url}: ${a.outcome}`).join("; ")}); uruchom: docker compose --profile ct up -d certstream` };
          return { events };
        },
      });
    }
    if (offline) return switchedOff(name, offReason);
    if (name === "urlscan") return createUrlscanWatchSource({ searcher: createUrlscanSource() });
    if (name === "adlibrary") return createAdlibWatchSource({ sources: createSources({ onNote: log }) });
    const snapshotFile = path.join(path.dirname(file), WATCH_CONFIG.certlistSnapshotName);
    return createCertlistWatchSource({
      fetchList: async () => {
        try {
          const res = await fetch(WATCH_CONFIG.certlistUrl, { signal: AbortSignal.timeout(WATCH_CONFIG.certlistTimeoutMs) });
          if (!res.ok) return { error: `Lista Ostrzeżeń CERT: HTTP ${res.status}` };
          return { domains: parseCertlist(await res.text()) };
        } catch (e) {
          return { error: `Lista Ostrzeżeń CERT niedostępna (${(e as Error).message})` };
        }
      },
      snapshot: {
        load: async () => {
          try {
            return new Set(JSON.parse(readFileSync(snapshotFile, "utf8")) as string[]);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw e;
          }
        },
        save: async (domains) => {
          mkdirSync(path.dirname(snapshotFile), { recursive: true });
          writeFileSync(snapshotFile, JSON.stringify([...domains]));
        },
      },
      facts: async (domain) => {
        const [rdap, dns] = await Promise.all([live!.rdap(domain), live!.dns(domain, ["NS"])]);
        return rdap || dns.ns.length ? { registrar: rdap?.registrar ?? null, created: rdap?.created ?? null, nameservers: dns.ns.length ? dns.ns : (rdap?.nameservers ?? []) } : null;
      },
    });
  };
  const sources = sourceNames(args.sources).map(build);

  // Analysis of one hit: a fresh scratch folder per hit (the previous one is removed), the full result kept for --add-to-base.
  const scratchRoot = mkdtempSync(path.join(os.tmpdir(), "watch-"));
  let counter = 0;
  let last: { result: MaterialResult; captured: AnalyzedMaterial } | null = null;
  let captured: AnalyzedMaterial | undefined;
  const config = loadLinkConfig(process.env.LINK_CONFIG ?? baseConfigFile);
  const analyze = createHitAnalyzer({
    run: (input) => {
      const work = path.join(scratchRoot, `hit-${++counter}`);
      rmSync(path.join(scratchRoot, `hit-${counter - 1}`), { recursive: true, force: true });
      captured = undefined;
      return analyzeMaterial(input, {
        dataDir,
        workDir: work,
        fixtures: offline ? DEFAULTS.fixtures : undefined,
        live,
        config,
        media: { ocr: true },
        onAnalyzed: (a) => (captured = a),
      });
    },
    caseDirOf: async (hit) => adRecordToCaseDir(hit.adRecord!, path.join(scratchRoot, "reklamy")),
    onResult: (_hit, result) => {
      last = captured ? { result, captured } : null;
    },
  });

  const ac = new AbortController();
  process.once("SIGINT", () => {
    log("\n[watch] zatrzymywanie po bieżącym trafieniu…");
    ac.abort();
  });
  log(`[watch] baza ${dataDir}; wiersze: ${file}; źródła: ${sources.map((s) => s.name).join(", ")}; przepisy: ${recipes.length}${args.once ? " · jeden cykl" : ` · co ${args.every ?? WATCH_CONFIG.defaultEvery}`}${args["add-to-base"] ? ` · dopisywanie do bazy: ${verdicts.join(", ")}` : ""}`);
  try {
    const res = await runWatch({
      sources,
      recipes,
      analyze,
      file,
      everyMs,
      once: !!args.once,
      clock: { now: () => new Date(), sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)) },
      signal: ac.signal,
      log,
      onAnalyzed: async (_hit, analysis) => {
        if (!args["add-to-base"] || !last || analysis.verdict === "error") return;
        const added = await addToBase(dataDir, last, { source: "watch", verdicts, log });
        for (const a of added.added) log(`[watch] dodano do bazy: ${a.id} (${a.verdict}${a.campaign ? `, kampania ${a.campaign}` : ""})`);
      },
    });
    for (const r of res.report) log(`[watch] ${r.source}: ${r.status}${r.reason ? ` (${r.reason})` : ""}, nowe trafienia: ${r.hits}`);
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});
