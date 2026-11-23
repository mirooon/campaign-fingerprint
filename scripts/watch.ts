/**
 * bun run watch -- --data <base> [--every 30m] [--sources ct,adlibrary,urlscan,certlist] [--recipes recipes.json] [--once]
 *   [--replay file.jsonl] [--offline] [--file data/watch.jsonl] [--add-to-base [--add-verdicts known_campaign]]
 * Scan schedule: every cycle asks public sources for new addresses, runs each through the analysis against the base
 * and appends a row to data/watch.jsonl. A source without a network or a key is skipped with the reason.
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
  `Usage: bun run watch -- --data <base> [--every ${WATCH_CONFIG.defaultEvery}] [--sources ${WATCH_CONFIG.sources.join(",")}] [--recipes recipes.json] [--once]
  [--replay file.jsonl] [--offline] [--file ${WATCH_CONFIG.file}] [--add-to-base [--add-verdicts ${WATCH_CONFIG.addVerdicts.join(",")}]]
Every cycle asks the sources (CT logs, ad libraries, urlscan, CERT Warning List) for new addresses; each goes to the analysis against the base (--data),
and the result { ts, source, url, verdict, campaign } to a JSONL file (append only; the same address is not analyzed twice).
--recipes: search recipes (JSON; also WATCH_RECIPES); format and example: data/examples/watch-przepisy.example.json.
--replay: replays saved CertStream messages instead of the stream (offline demo; implies --offline: the other sources are skipped).
--offline: no network (also ANALYZE_OFFLINE=1): network sources are skipped with the reason, the analysis uses only the sample.
--seed-recipes <file>: instead of scanning, writes recipes made from the base (strong features of each campaign: an IP address outside a CDN, a file, a path ID); the file holds values of real campaigns, so save it outside the repository.
--once: one cycle and stop (exit code 0, also when sources were skipped).
--add-to-base: hits with a verdict from --add-verdicts (default ${WATCH_CONFIG.addVerdicts.join(",")}) are added to the base (campaigns keep their numbers; a copy of the earlier files in <base>/historia/).
urlscan key (optional, gives the DOM): URLSCAN_API_KEY. CT stream: --url or CT_STREAM_URL (default the local certstream-server-go, then the public one).`,
);

/** Names from `--sources`, validated against the sources the scheduler knows. */
function sourceNames(text: string | undefined): WatchSourceName[] {
  const names = (text ?? WATCH_CONFIG.sources.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const bad = names.filter((n) => !(WATCH_CONFIG.sources as readonly string[]).includes(n));
  if (bad.length) throw new Error(`unknown source: ${bad.join(", ")} (known: ${WATCH_CONFIG.sources.join(", ")})`);
  return names as WatchSourceName[];
}

/** Verdicts of `--add-verdicts`, validated. */
function addVerdicts(text: string | undefined): MaterialVerdict[] {
  if (!text) return WATCH_CONFIG.addVerdicts;
  const list = text.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = list.filter((v) => !(VERDICTS as string[]).includes(v));
  if (bad.length) throw new Error(`unknown verdict: ${bad.join(", ")} (known: ${VERDICTS.join(", ")})`);
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
    console.log(`[watch] recipes from the base: ${recipes.length} → ${args["seed-recipes"]}`);
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
  const offReason = "offline mode: no network queries";

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
          if (res.status === "unavailable") return { events, skipped: `no CT stream responds (${res.attempts.map((a) => `${a.url}: ${a.outcome}`).join("; ")}); run: docker compose --profile ct up -d certstream` };
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
          if (!res.ok) return { error: `CERT Warning List: HTTP ${res.status}` };
          return { domains: parseCertlist(await res.text()) };
        } catch (e) {
          return { error: `CERT Warning List unavailable (${(e as Error).message})` };
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
    log("\n[watch] stopping after the current hit…");
    ac.abort();
  });
  log(`[watch] base ${dataDir}; rows: ${file}; sources: ${sources.map((s) => s.name).join(", ")}; recipes: ${recipes.length}${args.once ? " · one cycle" : ` · every ${args.every ?? WATCH_CONFIG.defaultEvery}`}${args["add-to-base"] ? ` · adding to the base: ${verdicts.join(", ")}` : ""}`);
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
        for (const a of added.added) log(`[watch] added to the base: ${a.id} (${a.verdict}${a.campaign ? `, campaign ${a.campaign}` : ""})`);
      },
    });
    for (const r of res.report) log(`[watch] ${r.source}: ${r.status}${r.reason ? ` (${r.reason})` : ""}, new hits: ${r.hits}`);
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});
