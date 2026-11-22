/**
 * Words of "Dodaj do bazy" (B-284): why the bundled sample base cannot grow and the sentences of the outcome.
 * Pure functions, safe for the browser.
 */
import type { AddToBaseResult } from "../pipeline/addToBase";
import { count, MATERIAL } from "./format";

/**
 * Why the base cannot grow, or null when it can: the bundled sample is read-only, so it never gets written, and the
 * result of "Wczytaj przykład" is synthetic, so it does not belong in a base of real campaigns.
 */
export function addToBaseRefusal(sampleBase: boolean, example = false): string | null {
  if (example) return "To wynik przykładu (dane syntetyczne), więc nie trafia do bazy.";
  return sampleBase ? "Baza przykładowa jest tylko do odczytu. Żeby dopisywać materiały, skopiuj ją do własnego katalogu i uruchom podgląd z VIEWER_DATA_DIR wskazującym na tę kopię." : null;
}

/** Sentences of the outcome: what was added (with its campaign), then each material that was not and why. */
export function addMessages(res: AddToBaseResult): string[] {
  const created = new Set(res.createdCampaigns);
  const where = (a: AddToBaseResult["added"][number]) => (a.campaign ? ` (${created.has(a.campaign) ? "nowa kampania" : "kampania"} ${a.campaign})` : "");
  const head = res.added.length ? `Dodano do bazy ${count(res.added.length, MATERIAL)}: ${res.added.map((a) => `${a.id}${where(a)}`).join(", ")}.` : "Nic nie dodano do bazy.";
  return [head, ...res.skipped.map((s) => `Nie dodano ${s.id}: ${s.reason}${s.duplicateOf ? ` (duplikat materiału ${s.duplicateOf})` : ""}.`)];
}
