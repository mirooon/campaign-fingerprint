/** bun run cache:freeze -- --out <katalog fixtures> [--cache .cache] */
import path from "node:path";
import { freezeEntries, readCacheDump } from "../lib/pipeline/freeze";
import { defaultCacheDir } from "../lib/cache";
import { writeJson } from "../lib/pipeline/steps";
import { cli, main } from "./_cli";

const args = cli(
  { out: { type: "string" }, cache: { type: "string" } } as const,
  `Usage: bun run cache:freeze -- --out <fixtures folder> [--cache .cache]
Saves the responses of a run with a network (pages, favicons and images by URL, DNS, RDAP, crt.sh, ASN from the cache) as <out>/frozen.json.
Repeat the run without a network: bun run enrich -- --offline --fixtures <out> (or --fixtures <out> in analyze-material).
Images from files on disk need no freezing. Cache entries of an older run without binary responses (before this version) have no favicons.`,
);

void main(async () => {
  if (!args.out) throw new Error("required: --out (see --help)");
  const frozen = freezeEntries(await readCacheDump(path.resolve(args.cache ?? defaultCacheDir())));
  writeJson(path.join(args.out, "frozen.json"), frozen, false);
  console.log(`[cache:freeze] pages: ${Object.keys(frozen.pages).length}, files: ${Object.keys(frozen.binaries).length}, DNS: ${Object.keys(frozen.dns).length}, RDAP: ${Object.keys(frozen.rdap).length}, crt.sh: ${Object.keys(frozen.ct).length}, ASN: ${Object.keys(frozen.asn).length} -> ${path.join(args.out, "frozen.json")}`);
});
