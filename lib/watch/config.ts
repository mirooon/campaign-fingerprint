/**
 * Defaults of the scan scheduler (`bun run watch`). Intervals, file paths and thresholds live here, not in
 * the logic, so a change of policy is one edit and the tests can name the values they depend on.
 */
import type { MaterialVerdict } from "../pipeline/analyzeMaterial";

export const WATCH_CONFIG = {
  /** Append-only JSONL with one row per analysed hit (in .gitignore). */
  file: "data/watch.jsonl",
  /** Pause between cycles when `--every` is not given. */
  defaultEvery: "30m",
  /** Sources the scheduler can ask. */
  sources: ["ct", "adlibrary", "urlscan", "certlist"] as const,
  /** Verdicts that `--add-to-base` adds automatically; only a hit tied to a known campaign feeds the base without guessing. */
  addVerdicts: ["known_campaign"] as MaterialVerdict[],
  /** Newest hits of one recipe analysed per cycle (a recipe may name its own `limit`). */
  maxHitsPerRecipe: 50,
  /** Cap of the number of domain names of one Lista Ostrzeżeń CERT difference that reach the RDAP filter per cycle. */
  certlistMaxChecks: 200,
  /** How long the CT source listens to the live stream in one cycle, in seconds. */
  ctWindowSeconds: 60,
  /** File (next to watch.jsonl) with the previous Lista Ostrzeżeń CERT: the difference with today's list is what is new. */
  certlistSnapshotName: "watch-certlist.json",
  /** Time limit of the download of the CERT list, ms. */
  certlistTimeoutMs: 60_000,
  /** Address of the daily Lista Ostrzeżeń CERT file (JSON array of domains). */
  certlistUrl: "https://hole.cert.pl/domains/v2/domains.json",
} as const;
