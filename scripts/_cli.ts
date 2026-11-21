/** Tiny CLI helpers shared by the bun scripts (node:util parseArgs, no deps). */
import { parseArgs, type ParseArgsConfig } from "node:util";

export function cli<T extends NonNullable<ParseArgsConfig["options"]>>(options: T, usage: string) {
  try {
    const { values } = parseArgs({ options: { ...options, help: { type: "boolean", short: "h" } }, allowPositionals: false, strict: true });
    if ((values as { help?: boolean }).help) {
      console.log(usage);
      process.exit(0);
    }
    return values as { [K in keyof T]?: T[K]["type"] extends "boolean" ? boolean : string };
  } catch (e) {
    console.error(`${(e as Error).message}\n\n${usage}`);
    process.exit(2);
  }
}

export async function main(fn: () => Promise<void> | void): Promise<void> {
  const started = Date.now();
  try {
    await fn();
    console.log(`(gotowe w ${((Date.now() - started) / 1000).toFixed(1)} s)`);
  } catch (e) {
    console.error(`BŁĄD: ${(e as Error)?.stack ?? String(e)}`);
    process.exit(1);
  }
}
