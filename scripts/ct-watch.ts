/**
 * bun run ct:watch [--campaigns data/campaigns.json] [--duration 300] [--url ws://127.0.0.1:8181/]
 * Live Certificate Transparency watcher: new certificate names are matched against campaign
 * fingerprints; matches are enriched passively (DNS, RDAP, crt.sh) and appended to
 * data/ct-watch.jsonl as candidates. No page is fetched unless --fetch-page is given.
 */
import { readFileSync } from "node:fs";
import { DEFAULT_FEED_FILE } from "../lib/ct/feed";
import { replayCertstream, runCtStream } from "../lib/ct/stream";
import { CtWatcher } from "../lib/ct/watch";
import { fixtureSources, liveSources } from "../lib/pipeline/sources";
import { DEFAULTS } from "../lib/pipeline/steps";
import { loadFingerprints, printFingerprints } from "./_ct";
import { cli, main } from "./_cli";

const LOCAL_STREAM = "ws://127.0.0.1:8181/";
const PUBLIC_STREAM = "wss://certstream.calidog.io/";

const args = cli(
  {
    campaigns: { type: "string" },
    graph: { type: "string" },
    lexicon: { type: "string" },
    config: { type: "string" },
    feed: { type: "string" },
    url: { type: "string" },
    duration: { type: "string" },
    threshold: { type: "string" },
    replay: { type: "string" },
    "no-enrich": { type: "boolean" },
    "fetch-page": { type: "boolean" },
    offline: { type: "boolean" },
    "dry-run": { type: "boolean" },
    "max-enrich-per-min": { type: "string" },
  } as const,
  `Użycie: bun run ct:watch [--campaigns data/campaigns.json] [--graph data/graph.json] [--lexicon data/sample/ct-lexicon.json]
  [--url ws://127.0.0.1:8181/,wss://certstream.calidog.io/] [--duration 300] [--threshold 0.6] [--feed data/ct-watch.jsonl]
  [--no-enrich] [--fetch-page] [--offline] [--dry-run] [--max-enrich-per-min 30]
  [--replay data/sample/ct-stream.jsonl]   demo offline: odtworzenie zapisanych wiadomości CertStream (bez sieci)
Strumień CT: lokalny certstream-server-go (docker compose --profile ct up -d certstream), potem publiczny CertStream.
Dopasowania (kandydaci) trafiają do pliku JSONL (tylko dopisywanie). Stronę pobiera tylko --fetch-page (jeden GET).`,
);

void main(async () => {
  const set = loadFingerprints(args);
  printFingerprints(set);
  const feedFile = args["dry-run"] ? null : (args.feed ?? process.env.CT_FEED_FILE ?? DEFAULT_FEED_FILE);
  // Replays never touch the network: enrichment answers come from the sample fixtures.
  const offline = Boolean(args.offline || args.replay);
  const sources = offline ? fixtureSources(DEFAULTS.fixtures) : liveSources();
  const maxPerMinute = Number(args["max-enrich-per-min"] ?? 30);
  const urls = (args.url ?? process.env.CT_STREAM_URL ?? `${LOCAL_STREAM},${PUBLIC_STREAM}`).split(",").map((u) => u.trim()).filter(Boolean);
  const watcher = new CtWatcher({
    set,
    feedFile,
    source: args.replay ? "replay" : "certstream",
    stream: args.replay ?? null,
    enrich: args["no-enrich"] ? null : { sources, fetchPage: Boolean(args["fetch-page"]), maxPerMinute },
    log: (m) => console.log(m),
  });
  const statsLine = () =>
    `zdarzenia ${watcher.stats.events}, nazwy ${watcher.stats.names}, nowe domeny ${watcher.stats.domains}, kandydaci ${watcher.stats.candidates}` +
    (watcher.stats.enrichSkipped ? `, bez wzbogacenia (limit) ${watcher.stats.enrichSkipped}` : "");

  if (args.replay) {
    const r = replayCertstream(readFileSync(args.replay, "utf8").split("\n"), (e) => watcher.handle(e));
    await watcher.flush();
    console.log(`[ct] odtworzono ${r.messages} wiadomości (${r.events} z nazwami domen): ${statsLine()}`);
    console.log(`[ct] feed: ${feedFile ?? "(dry run — nic nie zapisano)"}`);
    return;
  }

  const ac = new AbortController();
  process.once("SIGINT", () => {
    console.log("\n[ct] zatrzymywanie…");
    ac.abort();
  });
  const durationMs = args.duration ? Number(args.duration) * 1000 : null;
  console.log(`[ct] strumienie (w kolejności): ${urls.join(", ")}${durationMs ? ` · czas: ${args.duration} s` : " · Ctrl+C kończy"}`);
  const started = Date.now();
  const timer = setInterval(() => console.log(`[ct] ${Math.round((Date.now() - started) / 1000)} s: ${statsLine()}`), 30_000);
  const res = await runCtStream({ urls, onEvent: (e) => watcher.handle(e), log: (m) => console.log(m), durationMs, signal: ac.signal });
  clearInterval(timer);
  await watcher.flush();
  console.log(`[ct] status: ${res.status}${res.url ? ` (${res.url})` : ""}; wiadomości ${res.messages}; ${statsLine()}`);
  console.log(`[ct] feed: ${feedFile ?? "(dry run — nic nie zapisano)"}`);
  if (res.status === "unavailable") {
    for (const a of res.attempts) console.log(`  - ${a.url}: ${a.outcome}`);
    console.log(
      "[ct] Żaden strumień CT nie przysłał danych. Uruchom lokalny serwer: docker compose --profile ct up -d certstream\n" +
        "     albo użyj trybu backfill (crt.sh): bun run ct:backfill -- --pattern 'zwrot%'\n" +
        "     albo demo offline: bun run ct:watch -- --replay data/sample/ct-stream.jsonl",
    );
    process.exitCode = 2;
  }
});
