/** bun run licenses [-- --write LICENCJE.md]: licenses of production npm packages (from node_modules). */
import fs from "node:fs";
import path from "node:path";
import { renderLicenseTable, replaceBetweenMarkers, resolveProductionPackages, type PackageJson } from "../lib/licenses";
import { cli, main } from "./_cli";

const args = cli(
  { write: { type: "string" } } as const,
  `Użycie: bun run licenses [-- --write LICENCJE.md]
Czyta pole license z node_modules/<pakiet>/package.json dla pakietów produkcyjnych (dependencies z package.json i ich zależności).
Bez --write wypisuje tabelę Markdown. Z --write podmienia treść między znacznikami <!-- npm:start --> i <!-- npm:end --> w podanym pliku.
Wymaga zainstalowanych zależności (bun install).`,
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
  console.log(`[licenses] ${rows.length} pakietów -> ${args.write}`);
});
