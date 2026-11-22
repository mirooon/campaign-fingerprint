/** bun run contract-schema -- [--out docs/schema]: zapisuje schematy JSON kontraktu integracji. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CONTRACT_SCHEMAS, contractJsonSchema } from "../lib/pipeline/contract";
import { cli, main } from "./_cli";

const args = cli({ out: { type: "string" } } as const, "Użycie: bun run contract-schema -- [--out docs/schema]\nZapisuje schematy JSON (wejście: input-file, wyjście: material-result) z lib/pipeline/contract.ts.");

void main(() => {
  const out = path.resolve(args.out ?? "docs/schema");
  mkdirSync(out, { recursive: true });
  for (const name of Object.keys(CONTRACT_SCHEMAS) as Array<keyof typeof CONTRACT_SCHEMAS>) {
    writeFileSync(path.join(out, name), `${JSON.stringify(contractJsonSchema(name), null, 2)}\n`, "utf8");
    console.log(`[contract-schema] ${path.join(out, name)}`);
  }
});
