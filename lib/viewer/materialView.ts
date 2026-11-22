/**
 * Logic of the batch result view: funnel numbers, filters, confidence of a verdict and export rows.
 * Pure functions over `MaterialResult`; the GUI only draws what they return.
 */
import type { MaterialItemResult, MaterialResult } from "@/lib/pipeline/analyzeMaterial";
import { bestCampaignLink, MATERIAL_CSV_COLUMNS, materialConfidence, materialCsvRow } from "@/lib/pipeline/materialCsv";
import type { Confidence } from "./strength";

/** Filter of the result table: a verdict group (`fresh` = new campaign, also the one similar to known ones), or `uncertain` = verdicts the tool is unsure of (to check by hand). */
export type ResultFilter = "all" | "known" | "fresh" | "duplicate" | "insufficient" | "similar" | "new" | "uncertain";

export interface BatchSummary {
  files: number;
  materials: number;
  duplicates: number;
  /** Materials linked to the base: a known campaign or a new one similar to known ones. */
  linkedToBase: number;
  known: number;
  /** New campaigns: similar to known ones or entirely new. */
  fresh: number;
  similar: number;
  brandNew: number;
  insufficient: number;
  /** Materials with an error reported by the analysis. */
  withErrors: number;
}

/**
 * Numbers of the funnel Pliki → Materiały → Duplikaty → Powiązania z bazą → Znane / Nowe / Za mało danych.
 * They add up: materials = duplicates + known + fresh + insufficient. `files` is the number of uploaded files.
 */
export function batchSummary(result: Pick<MaterialResult, "items">, files: number): BatchSummary {
  const count = (v: MaterialItemResult["verdict"]) => result.items.filter((i) => i.verdict === v).length;
  const similar = count("similar_campaigns");
  const brandNew = count("new_campaign");
  const known = count("known_campaign");
  return {
    files,
    materials: result.items.length,
    duplicates: count("duplicate"),
    linkedToBase: known + similar,
    known,
    fresh: similar + brandNew,
    similar,
    brandNew,
    insufficient: count("insufficient"),
    withErrors: result.items.filter((i) => i.errors.length > 0).length,
  };
}

/** Items of one filter group of the result table. `uncertain` cuts across verdicts: those whose confidence is "niepewne" (never "za mało danych", which has none). */
export function filterItems(items: MaterialItemResult[], filter: ResultFilter): MaterialItemResult[] {
  if (filter === "uncertain") return items.filter((i) => resultConfidence(i) === "uncertain");
  const verdicts: Record<Exclude<ResultFilter, "all" | "uncertain">, MaterialItemResult["verdict"][]> = {
    known: ["known_campaign"],
    fresh: ["similar_campaigns", "new_campaign"],
    similar: ["similar_campaigns"],
    new: ["new_campaign"],
    duplicate: ["duplicate"],
    insufficient: ["insufficient"],
  };
  return filter === "all" ? items : items.filter((i) => verdicts[filter].includes(i.verdict));
}

/**
 * Confidence of the verdict, or null when there is none to give ("za mało danych"). A material that
 * joined its campaign only by a near-identical creative (variant) is never "pewne": it has no own
 * infrastructure, so the assignment stands on the picture alone.
 */
export function resultConfidence(item: MaterialItemResult): Confidence | null {
  if (item.verdict === "insufficient") return null;
  const c = materialConfidence(item);
  return item.campaignBasis === "content_variant" && c === "certain" ? "likely" : c;
}

/** Note for a variant assigned by the creative ("wariant: przypisanie po kreacji, niższa pewność") with the material it resembles; null otherwise. */
export function variantNote(item: MaterialItemResult): string | null {
  if (item.campaignBasis !== "content_variant") return null;
  const like = item.links.find((l) => l.variant)?.other ?? bestCampaignLink(item)?.other ?? null;
  return `wariant: przypisanie po kreacji, niższa pewność${like ? `. Kreacja jest podobna do materiału ${like}` : ""}`;
}

/** Export rows (CSV and JSON): the columns and their order are shared with `bun run analyze-material --csv`. */
export function resultRows(result: Pick<MaterialResult, "items">): Array<Record<(typeof MATERIAL_CSV_COLUMNS)[number], string>> {
  return result.items.map((item) => {
    const cells = materialCsvRow(item);
    return Object.fromEntries(MATERIAL_CSV_COLUMNS.map((c, i) => [c, cells[i]])) as Record<(typeof MATERIAL_CSV_COLUMNS)[number], string>;
  });
}
