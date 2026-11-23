/**
 * Analysis of one scheduler hit against the base: a link goes in as `{ url }`, an ad-library record as a case folder
 * (so the analysis reads the record, not the landing page). The analysis itself (`analyzeMaterial`) and the folder
 * writer are passed in, so the translation of a hit into an input and of a result into a row is testable alone.
 */
import type { MaterialInput, MaterialResult } from "../pipeline/analyzeMaterial";
import type { WatchAnalysis, WatchHit } from "./schedule";

export interface HitAnalyzerOptions {
  run: (input: MaterialInput) => Promise<MaterialResult>;
  /** Writes the case folder of an ad-library record and returns its path. */
  caseDirOf: (hit: WatchHit) => Promise<string>;
  /** Told the full result of each analysis (for `--add-to-base`, which needs more than the row holds). */
  onResult?: (hit: WatchHit, result: MaterialResult) => void;
}

/**
 * Builds the `analyze` function of the scheduler. A hit with an ad record is analysed as a case folder, any other
 * as its address. The verdict of the first record is the hit's verdict; a result without records (the material
 * could not be read) is an error with the reasons the analysis gave, never a silent "nothing".
 */
export function createHitAnalyzer(o: HitAnalyzerOptions): (hit: WatchHit) => Promise<WatchAnalysis> {
  return async (hit) => {
    const input: MaterialInput = hit.adRecord ? { caseDir: await o.caseDirOf(hit) } : { url: hit.url };
    const result = await o.run(input);
    o.onResult?.(hit, result);
    const item = result.items[0];
    if (!item) throw new Error(result.skipped.map((s) => s.reason).join("; ") || "the analysis returned no record");
    return { verdict: item.verdict, campaign: item.campaign, itemId: item.id };
  };
}
