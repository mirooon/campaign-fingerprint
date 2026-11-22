/**
 * Logic of the batch result view: funnel numbers, filters, confidence of a verdict and export rows.
 * Pure functions over `MaterialResult`; the GUI only draws what they return.
 */
import type { MaterialItemResult } from "@/lib/pipeline/analyzeMaterial";
import { bestCampaignLink, MATERIAL_CSV_COLUMNS, materialConfidence, materialCsvRow, skippedCsvRows, unreadCases, type MaterialCsvInput } from "@/lib/pipeline/materialCsv";
import { CONFIDENCE_INFO, type Confidence, type ShownConfidence } from "./strength";

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
  /** "Za mało danych": records with that verdict and the cases the import could not read (`unread`). */
  insufficient: number;
  /** Cases the import could not turn into a material (e.g. a saved page without its address); counted as materials and errors. */
  unread: number;
  /** Materials with an error reported by the analysis, the unread cases included. */
  withErrors: number;
}

/**
 * Numbers of the funnel Pliki → Materiały → Duplikaty → Powiązania z bazą → Znane / Nowe / Za mało danych.
 * They add up: materials = duplicates + known + fresh + insufficient. `files` is the number of uploaded files.
 * A case the import could not read is a material with "za mało danych" and an error, as in the CSV, where it
 * has an `insufficient` row: without it a file would vanish from the counts while the summary said "0 błędów".
 */
export function batchSummary(result: MaterialCsvInput, files: number): BatchSummary {
  const count = (v: MaterialItemResult["verdict"]) => result.items.filter((i) => i.verdict === v).length;
  const similar = count("similar_campaigns");
  const brandNew = count("new_campaign");
  const known = count("known_campaign");
  const unread = unreadCases(result).length;
  return {
    files,
    materials: result.items.length + unread,
    duplicates: count("duplicate"),
    linkedToBase: known + similar,
    known,
    fresh: similar + brandNew,
    similar,
    brandNew,
    insufficient: count("insufficient") + unread,
    unread,
    withErrors: result.items.filter((i) => i.errors.length > 0).length + unread,
  };
}

/** A case of the batch the import could not read, as a row of the result table. */
export interface UnreadMaterial {
  /** Case name: the id of its row in the CSV. */
  id: string;
  /** Reasons of the import, without repeats. */
  reasons: string[];
  /** What to add so the case can be read, one line per kind of gap; empty for a reason without advice. */
  hints: string[];
}

/** Advice for one reason of the import, keyed by the start of the reason the importer writes. */
const UNREAD_HINTS: Array<{ test: RegExp; hints: string[] }> = [
  {
    test: /^brak adresu strony/,
    hints: [
      "Dołącz HAR z wizyty na tej stronie w tej samej sprawie (np. podział „jedna sprawa”): adres strony odczytamy z HAR.",
      "Albo zapisz stronę jako MHTML albo z komentarzem „saved from url” na początku pliku: z nich też odczytamy adres.",
    ],
  },
  { test: /^HAR bez treści dokumentu/, hints: ["Dołącz zapisaną stronę (HTML) albo nagraj HAR z otwartą stroną, tak żeby zawierał jej treść."] },
  { test: /^brak strony, zrzutu ani wideo/, hints: ["Dołącz zrzut reklamy, zapisaną stronę, HAR albo wideo: pliki innego rodzaju analiza pomija."] },
];

/** What to add for the reasons of an unread case, without repeats; empty when no reason has advice. */
export function unreadHints(reasons: string[]): string[] {
  return [...new Set(reasons.flatMap((r) => UNREAD_HINTS.find((h) => h.test.test(r))?.hints ?? []))];
}

/** Cases the import could not read, with the reasons and the advice: the same cases as the `insufficient` rows the CSV adds. */
export function unreadMaterials(result: MaterialCsvInput): UnreadMaterial[] {
  return unreadCases(result).map(({ case: id, reasons }) => ({ id, reasons, hints: unreadHints(reasons) }));
}

/** Unread cases belong to the "za mało danych" group: the table shows them for that filter and for all materials. */
export function unreadVisible(filter: ResultFilter): boolean {
  return filter === "all" || filter === "insufficient";
}

/** Items of one filter group of the result table. `uncertain` cuts across verdicts: those shown as "niepewne" (never "za mało danych" or "brak wspólnych śladów", which have nothing to check). */
export function filterItems(items: MaterialItemResult[], filter: ResultFilter): MaterialItemResult[] {
  if (filter === "uncertain") return items.filter((i) => shownConfidence(i) === "uncertain");
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

/**
 * Confidence as the result table and card show it: `no_traces` for a new material (also one in a group of similar
 * campaigns) without a single link to a known material, where `resultConfidence` and the export say `uncertain`;
 * otherwise the same as `resultConfidence`. Only the label changes: the CSV and JSON keep `uncertain`.
 */
export function shownConfidence(item: MaterialItemResult): ShownConfidence | null {
  const c = resultConfidence(item);
  const fresh = item.verdict === "new_campaign" || item.verdict === "similar_campaigns";
  return c === "uncertain" && fresh && item.links.length === 0 ? "no_traces" : c;
}

const VERDICT_ORDER: MaterialItemResult["verdict"][] = ["known_campaign", "similar_campaigns", "new_campaign", "duplicate", "insufficient"];

/** Rows of the result table in order: by verdict (known campaigns first) or by the shown confidence (pewne first, none last). */
export function sortItems(items: MaterialItemResult[], by: "verdict" | "confidence"): MaterialItemResult[] {
  /** Place of a row on the confidence scale; rows without confidence go last. */
  const rank = (i: MaterialItemResult) => {
    const c = shownConfidence(i);
    return c ? CONFIDENCE_INFO[c].rank : 9;
  };
  return [...items].sort((a, b) => (by === "verdict" ? VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) : rank(a) - rank(b)));
}

/** Note for a variant assigned by the creative ("wariant: przypisanie po kreacji, niższa pewność") with the material it resembles; null otherwise. */
export function variantNote(item: MaterialItemResult): string | null {
  if (item.campaignBasis !== "content_variant") return null;
  const like = item.links.find((l) => l.variant)?.other ?? bestCampaignLink(item)?.other ?? null;
  return `wariant: przypisanie po kreacji, niższa pewność${like ? `. Kreacja jest podobna do materiału ${like}` : ""}`;
}

/**
 * Export rows (JSON): the columns and their order are shared with `bun run analyze-material --csv`, and so are the
 * rows: one per record, then one `insufficient` row per case the import could not read, as in the CSV.
 */
export function resultRows(result: MaterialCsvInput): Array<Record<(typeof MATERIAL_CSV_COLUMNS)[number], string>> {
  return [...result.items.map(materialCsvRow), ...skippedCsvRows(result)].map(
    (cells) => Object.fromEntries(MATERIAL_CSV_COLUMNS.map((c, i) => [c, cells[i]])) as Record<(typeof MATERIAL_CSV_COLUMNS)[number], string>,
  );
}
