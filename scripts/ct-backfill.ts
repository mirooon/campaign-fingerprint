/**
 * bun run ct:backfill [--pattern 'zwrot%,finance%.sbs'] [--since 7]
 * Backfill for the CT watcher: recent certificates from crt.sh (identity search with %
 * wildcards, shared retry logic and cache) go through the same matcher and feed as the live
 * stream. Without --pattern the patterns come from the campaigns' domain-name templates.
 */
import { createCache, TTL } from "../lib/cache";
import { DEFAULT_FEED_FILE } from "../lib/ct/feed";
import { backfillPatterns } from "../lib/ct/fingerprint";
import { CtWatcher, runBackfill } from "../lib/ct/watch";
import { searchCt } from "../lib/osint/ct";
import { fixtureSources, liveSources } from "../lib/pipeline/sources";
import { DEFAULTS } from "../lib/pipeline/steps";
import { loadFingerprints, printFingerprints } from "./_ct";
import { cli, main } from "./_cli";

const args = cli(
  {
    campaigns: { type: "string" },
    graph: { type: "string" },
    lexicon: { type: "string" },
    config: { type: "string" },
    feed: { type: "string" },
    pattern: { type: "string" },
    since: { type: "string" },
    threshold: { type: "string" },
    "include-expired": { type: "boolean" },
    "no-enrich": { type: "boolean" },
    "fetch-page": { type: "boolean" },
    offline: { type: "boolean" },
    "dry-run": { type: "boolean" },
  } as const,
  `Usage: bun run ct:backfill [--pattern 'zwrot%,finance%.sbs'] [--since 7] [--campaigns data/campaigns.json]
  [--lexicon data/sample/ct-lexicon.json] [--threshold 0.6] [--feed data/ct-watch.jsonl] [--include-expired]
  [--no-enrich] [--fetch-page] [--offline] [--dry-run]
crt.sh patterns: letters, digits, ".", "-" and "%" (any string); without --pattern the patterns come from the name templates of the campaigns.
crt.sh can be slow: anchor the pattern with a prefix or a suffix.`,
);

void main(async () => {
  const set = loadFingerprints(args);
  printFingerprints(set);
  const patterns = args.pattern ? args.pattern.split(",").map((p) => p.trim()).filter(Boolean) : backfillPatterns(set);
  if (!patterns.length) throw new Error("no patterns: give --pattern or build campaigns with domains that share a name template");
  const sinceDays = Number(args.since ?? 7);
  const feedFile = args["dry-run"] ? null : (args.feed ?? process.env.CT_FEED_FILE ?? DEFAULT_FEED_FILE);
  const sources = args.offline ? fixtureSources(DEFAULTS.fixtures) : liveSources();
  const cache = createCache({ namespace: "ct-search", defaultTtlMs: TTL.hour });
  const watcher = new CtWatcher({
    set,
    feedFile,
    source: "crtsh-backfill",
    stream: patterns.join(","),
    enrich: args["no-enrich"] ? null : { sources, fetchPage: Boolean(args["fetch-page"]) },
    log: (m) => console.log(m),
  });
  console.log(`[ct] backfill from crt.sh: ${patterns.join(", ")} (last ${sinceDays} ${sinceDays === 1 ? "day" : "days"})`);
  const res = await runBackfill({
    watcher,
    patterns,
    sinceDays,
    search: (p) => searchCt(p, { cache, excludeExpired: !args["include-expired"], retries: 2 }),
    log: (m) => console.log(m),
  });
  for (const p of res.patterns) {
    console.log(`  ${p.pattern}: ${p.status}${p.status === "ok" ? `, certificates ${p.certificates}, from the last ${sinceDays} ${sinceDays === 1 ? "day" : "days"} ${p.recent}` : p.error ? ` (${p.error})` : ""}`);
  }
  console.log(`[ct] new domains ${watcher.stats.domains}, candidates ${res.candidates}; feed: ${feedFile ?? "(dry run — nothing written)"}`);
  if (res.patterns.every((p) => p.status !== "ok")) process.exitCode = 2;
});
