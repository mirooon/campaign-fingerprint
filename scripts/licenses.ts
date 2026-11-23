/** bun run licenses [-- --write LICENCJE.md]: licenses of production npm packages (from node_modules). */
import fs from "node:fs";
import path from "node:path";
import { renderLicenseTable, replaceBetweenMarkers, resolveProductionPackages, type PackageJson } from "../lib/licenses";
import { cli, main } from "./_cli";

const args = cli(
  { write: { type: "string" } } as const,
  `Usage: bun run licenses [-- --write LICENCJE.md]
Reads the license field of node_modules/<package>/package.json for the production packages (dependencies of package.json and their dependencies).
Without --write prints a Markdown table. With --write replaces the content between the <!-- npm:start --> and <!-- npm:end --> markers in the given file.
Needs the dependencies installed (bun install).`,
);

/** Reads the installed package.json of a package from the flat node_modules, null when it is not installed. */
function readInstalled(name: string): PackageJson | null {
  const file = path.resolve("node_modules", name, "package.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as PackageJson;
}

void main(() => {
  const root = JSON.parse(fs.readFileSync("package.json", "utf8")) as PackageJson;
  const rows = resolveProductionPackages(Object.keys(root.dependencies ?? {}), readInstalled);
  const table = renderLicenseTable(rows);
  if (!args.write) {
    console.log(table);
    return;
  }
  fs.writeFileSync(args.write, replaceBetweenMarkers(fs.readFileSync(args.write, "utf8"), "npm", table));
  console.log(`[licenses] ${rows.length} ${rows.length === 1 ? "package" : "packages"} -> ${args.write}`);
});
