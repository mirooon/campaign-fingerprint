/** bun run features:catalog: writes docs/CECHY.md from the code registries (pivot types, attributes, techniques, narrative). */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_LINK_CONFIG } from "../lib/graph/config";
import { collectCatalog, renderCatalog } from "../lib/docs/featuresCatalog";
import { cli, main } from "./_cli";

const USAGE = "Użycie: bun run features:catalog [--out docs/CECHY.md]\nGeneruje katalog cech z rejestrów w kodzie.";

/** Short hash of HEAD, or "unknown" outside a git checkout. */
function gitCommit(root: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

void main(() => {
  const values = cli({ out: { type: "string" } }, USAGE);
  const root = path.resolve(import.meta.dirname, "..");
  const out = path.resolve(root, values.out ?? "docs/CECHY.md");
  const data = collectCatalog(root);
  const md = renderCatalog(data, DEFAULT_LINK_CONFIG, new Date().toISOString().slice(0, 10), gitCommit(root));
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, md);
  console.log(`${path.relative(root, out)}: ${data.pivots.length} śladów, ${data.attributes.length} atrybutów, ${data.techniques.length} technik, ${data.topics.length} tematów, ${data.hooks.length} haczyków, ${data.undescribed.length} bez opisu`);
});
