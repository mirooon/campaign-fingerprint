/**
 * Words of "Add to base" (B-284): why the bundled sample base cannot grow and the sentences of the outcome.
 * Pure functions, safe for the browser.
 */
import type { AddToBaseResult } from "../pipeline/addToBase";
import { count } from "./format";

const SAMPLE: [string, string, string] = ["sample", "samples", "samples"];

/**
 * Why the base cannot grow, or null when it can: the bundled sample is read-only, so it never gets written, and the
 * result of "Load example" is synthetic, so it does not belong in a base of real campaigns.
 */
export function addToBaseRefusal(sampleBase: boolean, example = false): string | null {
  if (example) return "This is the result of the example (synthetic data), so it does not go into the base.";
  return sampleBase ? "The sample base is read-only. To add samples, copy it to a folder of your own and start the viewer with VIEWER_DATA_DIR pointing at that copy." : null;
}

/** Sentences of the outcome: what was added (with its campaign), then each material that was not and why. */
export function addMessages(res: AddToBaseResult): string[] {
  const created = new Set(res.createdCampaigns);
  const where = (a: AddToBaseResult["added"][number]) => (a.campaign ? ` (${created.has(a.campaign) ? "new campaign" : "campaign"} ${a.campaign})` : "");
  const head = res.added.length ? `Added ${count(res.added.length, SAMPLE)} to the base: ${res.added.map((a) => `${a.id}${where(a)}`).join(", ")}.` : "Nothing was added to the base.";
  return [head, ...res.skipped.map((s) => `Not added ${s.id}: ${s.reason}${s.duplicateOf ? ` (duplicate of sample ${s.duplicateOf})` : ""}.`)];
}
