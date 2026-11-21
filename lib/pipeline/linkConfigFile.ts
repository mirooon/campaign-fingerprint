/**
 * Which linking-weights file to use. Pure (the caller passes `exists`), so the choice can be tested.
 */
import path from "node:path";
import { DEFAULTS } from "./steps";

export interface LinkConfigChoice {
  /** File given on the command line. */
  explicit?: string;
  /** Value of LINK_CONFIG. */
  env?: string;
  /** Directory of the run (graph.json, campaigns.json) the config belongs to. */
  dataDir: string;
  /** Config of the bundled sample; pass it only when `dataDir` is the sample run itself. */
  sampleConfig?: string;
  exists: (file: string) => boolean;
}

/**
 * Picks the weights file: explicit, LINK_CONFIG, `<data>/linking.json`, `<data>/../linking-default.json`,
 * and the sample's file only when the caller marks the data as the sample. Returns null when none applies,
 * which means the built-in defaults (`DEFAULT_LINK_CONFIG`). Why: the sample file carries a fictional
 * shortener and the generator's marker, so data from outside the sample must not inherit it silently.
 */
export function resolveLinkConfigFile(c: LinkConfigChoice): string | null {
  if (c.explicit) return c.explicit;
  if (c.env) return c.env;
  const candidates = [path.join(c.dataDir, "linking.json"), path.join(c.dataDir, "..", "linking-default.json"), ...(c.sampleConfig ? [c.sampleConfig] : [])];
  return candidates.find((f) => c.exists(f)) ?? null;
}

/**
 * Weights file for `build-graph`: the explicit one, or the sample's only when the input is the sample's
 * own work file (`DEFAULTS.enriched`). Any other enriched file gets the built-in defaults (undefined).
 */
export function buildGraphConfigFile(explicit: string | undefined, enriched: string): string | undefined {
  if (explicit) return explicit;
  return enriched === DEFAULTS.enriched ? DEFAULTS.config : undefined;
}
