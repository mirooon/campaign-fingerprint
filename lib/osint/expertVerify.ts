/**
 * Optional expert verification (B-314): checks whether a "doctor" named in an ad exists in a register of
 * physicians. A LABEL only ("probably invented doctor"), never an input of the graph's weights. OFF by
 * default and no network in this module: the lookup is injected. The shipped lookup reads RECORDED answers
 * from a JSON file ({"jan testowy": true|false}); a live lookup (the NIL central register) would send a
 * name from the case data outside, so it needs the mentor's consent and is deliberately not built in.
 */
import { readFileSync } from "node:fs";
import { foldDiacritics } from "../text/normalize";

export interface ExpertCheck {
  /** Name as written in the ad. */
  name: string;
  /** True when the register has the person, false when it has not; names without an answer are left out. */
  registered: boolean;
}

/** A register lookup: true = found, false = not found, null = no answer (offline, error). */
export type ExpertLookup = (name: string) => Promise<boolean | null>;

/** Folded lookup key of a name ("Jan Testowy" -> "jan testowy"). */
export function expertKey(name: string): string {
  return foldDiacritics(name.toLowerCase()).replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * A lookup over recorded answers in a JSON file (name -> boolean); unknown names and an unreadable file
 * give null, so nothing is labelled without an answer.
 */
export function recordedExpertLookup(file: string): ExpertLookup {
  let table: Record<string, boolean> = {};
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) if (typeof v === "boolean") table[expertKey(k)] = v;
  } catch {
    table = {};
  }
  return async (name) => table[expertKey(name)] ?? null;
}

/**
 * Looks the names up when the plugin is `enabled` (otherwise returns [] without calling `lookup`). A lookup
 * that throws or answers null leaves that name unlabelled: no network means no label, the result is unchanged.
 */
export async function verifyExperts(names: readonly string[], opts: { enabled: boolean; lookup: ExpertLookup | null }): Promise<ExpertCheck[]> {
  if (!opts.enabled || !opts.lookup) return [];
  const out: ExpertCheck[] = [];
  for (const name of names) {
    try {
      const found = await opts.lookup(name);
      if (found !== null) out.push({ name, registered: found });
    } catch {
      // no answer: no label
    }
  }
  return out;
}
