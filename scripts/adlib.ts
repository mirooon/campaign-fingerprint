/**
 * bun run adlib -- search --platform <meta|google|tiktok|x|all> [--keyword] [--advertiser] [--from] [--to] [--country PL] [--limit N] [--personas file.json] --out <folder of cases>
 * bun run adlib -- get --platform <p> --id <adId> --out <folder of cases>
 * bun run adlib -- expand --campaign <campaign id> [--data <run folder>] --out <folder of cases>
 * Search of the public ad libraries (DSA) and saving of the results as cases for `analyze-material --cases`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ADLIB_CONFIG } from "../lib/adlib/config";
import { expansionQueries } from "../lib/adlib/expand";
import { adRecordToCaseDir, createSources, defaultQueries, searchSources, type SearchAllResult } from "../lib/adlib/index";
import { AD_PLATFORMS, type AdPlatform } from "../lib/adlib/types";
import type { CampaignsFile, EvidenceGraph } from "../lib/graph/model";
import { loadWatchlist } from "../lib/text/persona";
import { cli, main } from "./_cli";

const COMMANDS = ["search", "get", "expand"];
const command = process.argv[2];
if (command && COMMANDS.includes(command)) process.argv.splice(2, 1);

const args = cli(
  {
    platform: { type: "string" },
    keyword: { type: "string" },
    advertiser: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    country: { type: "string" },
    limit: { type: "string" },
    personas: { type: "string" },
    id: { type: "string" },
    campaign: { type: "string" },
    "x-file": { type: "string" },
    data: { type: "string" },
    out: { type: "string" },
  } as const,
  `Usage: bun run adlib -- search --platform <meta|google|tiktok|x|all> [--keyword phrase] [--advertiser name|AR…] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--country PL] [--limit N] [--personas file.json] [--x-file export.csv] --out <folder of cases>
        bun run adlib -- get --platform <meta|google|tiktok|x> --id <ad ID> --out <folder of cases>
        bun run adlib -- expand --campaign <campaign id> [--data <run folder>] --out <folder of cases>
expand: for a campaign of the run (--data, default VIEWER_DATA_DIR or data/) searches the libraries by its domains (Google: only with ADLIB_GOOGLE_RPC=1, unofficial RPC) and by the advertiser accounts from the ad libraries.
search: without --keyword and --advertiser searches the default phrases and the names of people on the list (--personas or PERSONAS) in the libraries where a phrase matches the ad content (not in Google: there a query uses up the BigQuery quota).
--x-file (or X_ADS_FILE): CSV export from the X ad repository downloaded by the user; the program does not download it.
Result: a folder of cases (one ad = one case) for: bun run analyze-material -- --cases <folder>.
A source without access is listed with the reason and instructions; exit code 0. Google: ADLIB_BQ_MAX_BYTES (byte limit of a query, default 10GiB), ADLIB_PYTHON.`,
);

/** Platforms named by --platform ("all" = every one); throws for an unknown name. */
function platformsOf(value: string | undefined): AdPlatform[] {
  if (!value) throw new Error("give --platform (meta, google, tiktok, x or all)");
  if (value === "all") return [...AD_PLATFORMS];
  if (!(AD_PLATFORMS as readonly string[]).includes(value)) throw new Error(`unknown platform “${value}” (meta, google, tiktok, x, all)`);
  return [value as AdPlatform];
}

void main(async () => {
  if (!command || !COMMANDS.includes(command)) throw new Error("give a command: search, get or expand (see --help)");
  if (!args.out) throw new Error("give --out <folder of cases>");
  const out = path.resolve(args.out);
  const sources = createSources({ onNote: (m) => console.warn(`NOTE: ${m}`), creatives: command === "get", xFile: args["x-file"] });

  if (command === "expand") {
    if (!args.campaign) throw new Error("give --campaign <campaign id>");
    const dataDir = path.resolve(args.data ?? process.env.VIEWER_DATA_DIR ?? "data");
    const graph = JSON.parse(readFileSync(path.join(dataDir, "graph.json"), "utf8")) as EvidenceGraph;
    const campaign = (JSON.parse(readFileSync(path.join(dataDir, "campaigns.json"), "utf8")) as CampaignsFile).campaigns.find((c) => c.id === args.campaign);
    if (!campaign) throw new Error(`no campaign ${args.campaign} in ${dataDir}`);
    const queries = expansionQueries(graph, campaign);
    const merged: SearchAllResult = { records: [], skipped: [], errors: [] };
    for (const q of queries) {
      const r = await searchSources(sources, [q.platform], [q.query]);
      console.log(`${q.platform} ${JSON.stringify(q.query)} (${q.reason}): ${r.records.length} ${r.records.length === 1 ? "ad" : "ads"}`);
      merged.records.push(...r.records);
      merged.skipped.push(...r.skipped.filter((s) => !merged.skipped.some((m) => m.platform === s.platform && m.reason === s.reason)));
      merged.errors.push(...r.errors);
    }
    if (!queries.length) console.log("the campaign has no domains and no advertiser accounts from the ad libraries");
    await report(merged, [...new Set(queries.map((q) => q.platform))]);
    return;
  }

  const platforms = platformsOf(args.platform);
  if (command === "get") {
    if (!args.id) throw new Error("give --id <ad ID>");
    if (platforms.length !== 1) throw new Error("get needs one platform");
    const source = sources[platforms[0]];
    const access = await source.available();
    if (!access.ok) throw new Error(`${platforms[0]} unavailable: ${access.reason}${access.howToGetAccess ? `. How to get access: ${access.howToGetAccess}` : ""}`);
    const rec = await source.getAd(args.id);
    if (!rec) throw new Error(`${platforms[0]}: no ad ${args.id}`);
    console.log(`saved: ${await adRecordToCaseDir(rec, out)}`);
    return;
  }

  const limit = args.limit ? Number(args.limit) : undefined;
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) throw new Error("--limit must be a positive integer");
  const personasFile = args.personas ?? process.env.PERSONAS;
  if (personasFile && !existsSync(personasFile)) throw new Error(`no file of people: ${personasFile}`);
  const base = { country: args.country ?? ADLIB_CONFIG.meta.country, ...(args.keyword ? { keyword: args.keyword } : {}), ...(args.advertiser ? { advertiser: args.advertiser } : {}), ...(args.from ? { from: args.from } : {}), ...(args.to ? { to: args.to } : {}), ...(limit ? { limit } : {}) };
  const isDefault = !args.keyword && !args.advertiser;
  const names = isDefault && personasFile ? loadWatchlist(personasFile).map((p) => p.name) : [];
  const result = await searchSources(sources, platforms, defaultQueries(base, ADLIB_CONFIG.defaultKeywords, names), { defaultQueries: isDefault });

  await report(result, platforms);

  /** Writes the case folders and prints what each platform gave, which sources were unavailable (and why) and which failed. */
  async function report(found: SearchAllResult, asked: AdPlatform[]): Promise<void> {
    for (const rec of found.records) await adRecordToCaseDir(rec, out);
    for (const p of asked) console.log(`${p}: ${found.records.filter((r) => r.platform === p).length} ads`);
    for (const s of found.skipped) console.log(`UNAVAILABLE ${s.platform}: ${s.reason}${s.howToGetAccess ? `\n  how to get access: ${s.howToGetAccess}` : ""}`);
    for (const e of found.errors) console.error(`ERROR ${e.platform}: ${e.message}`);
    console.log(`saved ${found.records.length} ${found.records.length === 1 ? "case" : "cases"} in ${out}${found.records.length ? `\nanalysis: bun run analyze-material -- --cases ${out}` : ""}`);
    // one platform asked for by name: its failure is the result of the command
    if (asked.length === 1 && found.errors.length) process.exit(1);
  }
});
