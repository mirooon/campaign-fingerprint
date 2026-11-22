/**
 * bun run adlib -- search --platform <meta|google|tiktok|x|all> [--keyword] [--advertiser] [--from] [--to] [--country PL] [--limit N] [--personas plik.json] --out <katalog spraw>
 * bun run adlib -- get --platform <p> --id <adId> --out <katalog spraw>
 * bun run adlib -- expand --campaign <id kampanii> [--data <katalog przebiegu>] --out <katalog spraw>
 * Wyszukiwanie w publicznych bibliotekach reklam (DSA) i zapis wyników jako sprawy dla `analyze-material --cases`.
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
  `Użycie: bun run adlib -- search --platform <meta|google|tiktok|x|all> [--keyword fraza] [--advertiser nazwa|AR…] [--from RRRR-MM-DD] [--to RRRR-MM-DD] [--country PL] [--limit N] [--personas plik.json] [--x-file eksport.csv] --out <katalog spraw>
        bun run adlib -- get --platform <meta|google|tiktok|x> --id <identyfikator reklamy> --out <katalog spraw>
        bun run adlib -- expand --campaign <id kampanii> [--data <katalog przebiegu>] --out <katalog spraw>
expand: dla kampanii z przebiegu (--data, domyślnie VIEWER_DATA_DIR albo data/) szuka w bibliotekach po jej domenach (Google: tylko z ADLIB_GOOGLE_RPC=1, nieoficjalne RPC) i po kontach reklamodawców z bibliotek reklam.
search: bez --keyword i --advertiser szuka domyślnych fraz i nazwisk osób z listy (--personas albo PERSONAS) w bibliotekach, w których fraza pasuje do treści reklamy (nie w Google: tam zapytanie zużywa limit BigQuery).
--x-file (albo X_ADS_FILE): eksport CSV z repozytorium reklam X pobrany przez użytkownika; program go nie pobiera.
Wynik: katalog spraw (jedna reklama = jedna sprawa) do: bun run analyze-material -- --cases <katalog>.
Źródło bez dostępu jest wypisane z powodem i instrukcją; kod wyjścia 0. Google: ADLIB_BQ_MAX_BYTES (limit bajtów zapytania, domyślnie 10GiB), ADLIB_PYTHON.`,
);

/** Platforms named by --platform ("all" = every one); throws for an unknown name. */
function platformsOf(value: string | undefined): AdPlatform[] {
  if (!value) throw new Error("podaj --platform (meta, google, tiktok, x albo all)");
  if (value === "all") return [...AD_PLATFORMS];
  if (!(AD_PLATFORMS as readonly string[]).includes(value)) throw new Error(`nieznana platforma „${value}” (meta, google, tiktok, x, all)`);
  return [value as AdPlatform];
}

void main(async () => {
  if (!command || !COMMANDS.includes(command)) throw new Error("podaj polecenie: search, get albo expand (zob. --help)");
  if (!args.out) throw new Error("podaj --out <katalog spraw>");
  const out = path.resolve(args.out);
  const sources = createSources({ onNote: (m) => console.warn(`UWAGA: ${m}`), creatives: command === "get", xFile: args["x-file"] });

  if (command === "expand") {
    if (!args.campaign) throw new Error("podaj --campaign <id kampanii>");
    const dataDir = path.resolve(args.data ?? process.env.VIEWER_DATA_DIR ?? "data");
    const graph = JSON.parse(readFileSync(path.join(dataDir, "graph.json"), "utf8")) as EvidenceGraph;
    const campaign = (JSON.parse(readFileSync(path.join(dataDir, "campaigns.json"), "utf8")) as CampaignsFile).campaigns.find((c) => c.id === args.campaign);
    if (!campaign) throw new Error(`brak kampanii ${args.campaign} w ${dataDir}`);
    const queries = expansionQueries(graph, campaign);
    const merged: SearchAllResult = { records: [], skipped: [], errors: [] };
    for (const q of queries) {
      const r = await searchSources(sources, [q.platform], [q.query]);
      console.log(`${q.platform} ${JSON.stringify(q.query)} (${q.reason}): ${r.records.length} reklam`);
      merged.records.push(...r.records);
      merged.skipped.push(...r.skipped.filter((s) => !merged.skipped.some((m) => m.platform === s.platform && m.reason === s.reason)));
      merged.errors.push(...r.errors);
    }
    if (!queries.length) console.log("kampania nie ma domen ani kont reklamodawców z bibliotek reklam");
    await report(merged, [...new Set(queries.map((q) => q.platform))]);
    return;
  }

  const platforms = platformsOf(args.platform);
  if (command === "get") {
    if (!args.id) throw new Error("podaj --id <identyfikator reklamy>");
    if (platforms.length !== 1) throw new Error("get wymaga jednej platformy");
    const source = sources[platforms[0]];
    const access = await source.available();
    if (!access.ok) throw new Error(`${platforms[0]} niedostępne: ${access.reason}${access.howToGetAccess ? `. Jak uzyskać dostęp: ${access.howToGetAccess}` : ""}`);
    const rec = await source.getAd(args.id);
    if (!rec) throw new Error(`${platforms[0]}: brak reklamy ${args.id}`);
    console.log(`zapisano: ${await adRecordToCaseDir(rec, out)}`);
    return;
  }

  const limit = args.limit ? Number(args.limit) : undefined;
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) throw new Error("--limit musi być dodatnią liczbą całkowitą");
  const personasFile = args.personas ?? process.env.PERSONAS;
  if (personasFile && !existsSync(personasFile)) throw new Error(`brak pliku z osobami: ${personasFile}`);
  const base = { country: args.country ?? ADLIB_CONFIG.meta.country, ...(args.keyword ? { keyword: args.keyword } : {}), ...(args.advertiser ? { advertiser: args.advertiser } : {}), ...(args.from ? { from: args.from } : {}), ...(args.to ? { to: args.to } : {}), ...(limit ? { limit } : {}) };
  const isDefault = !args.keyword && !args.advertiser;
  const names = isDefault && personasFile ? loadWatchlist(personasFile).map((p) => p.name) : [];
  const result = await searchSources(sources, platforms, defaultQueries(base, ADLIB_CONFIG.defaultKeywords, names), { defaultQueries: isDefault });

  await report(result, platforms);

  /** Writes the case folders and prints what each platform gave, which sources were unavailable (and why) and which failed. */
  async function report(found: SearchAllResult, asked: AdPlatform[]): Promise<void> {
    for (const rec of found.records) await adRecordToCaseDir(rec, out);
    for (const p of asked) console.log(`${p}: ${found.records.filter((r) => r.platform === p).length} reklam`);
    for (const s of found.skipped) console.log(`NIEDOSTĘPNE ${s.platform}: ${s.reason}${s.howToGetAccess ? `\n  jak uzyskać dostęp: ${s.howToGetAccess}` : ""}`);
    for (const e of found.errors) console.error(`BŁĄD ${e.platform}: ${e.message}`);
    console.log(`zapisano ${found.records.length} spraw w ${out}${found.records.length ? `\nanaliza: bun run analyze-material -- --cases ${out}` : ""}`);
    // one platform asked for by name: its failure is the result of the command
    if (asked.length === 1 && found.errors.length) process.exit(1);
  }
});
