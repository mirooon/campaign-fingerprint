/** bun run cache:freeze -- --out <katalog fixtures> [--cache .cache] */
import path from "node:path";
import { freezeEntries, readCacheDump } from "../lib/pipeline/freeze";
import { defaultCacheDir } from "../lib/cache";
import { writeJson } from "../lib/pipeline/steps";
import { cli, main } from "./_cli";

const args = cli(
  { out: { type: "string" }, cache: { type: "string" } } as const,
  `Użycie: bun run cache:freeze -- --out <katalog fixtures> [--cache .cache]
Zapisuje odpowiedzi z przebiegu z siecią (strony, favicony i obrazy po adresie, DNS, RDAP, crt.sh, ASN z cache) jako <out>/frozen.json.
Powtórzenie przebiegu bez sieci: bun run enrich -- --offline --fixtures <out> (albo --fixtures <out> w analyze-material).
Obrazy z plików na dysku nie wymagają zamrażania. Wpisy cache starszego przebiegu bez odpowiedzi binarnych (przed tą wersją) nie mają faviconów.`,
);

void main(async () => {
  if (!args.out) throw new Error("wymagane: --out (zob. --help)");
  const frozen = freezeEntries(await readCacheDump(path.resolve(args.cache ?? defaultCacheDir())));
  writeJson(path.join(args.out, "frozen.json"), frozen, false);
  console.log(`[cache:freeze] strony: ${Object.keys(frozen.pages).length}, pliki: ${Object.keys(frozen.binaries).length}, DNS: ${Object.keys(frozen.dns).length}, RDAP: ${Object.keys(frozen.rdap).length}, crt.sh: ${Object.keys(frozen.ct).length}, ASN: ${Object.keys(frozen.asn).length} -> ${path.join(args.out, "frozen.json")}`);
});
