/**
 * Quality of the data of the whole base (B-032): for every material the five checks of the completeness list
 * (zrzut, strona, HAR, adres, wideo) with the reason and the effect of a gap, and counts per check ("ile spraw bez
 * HAR"). Built from `provenance.json` of the base when it exists, else from the data of the graph's item nodes.
 * Pure functions.
 */
import type { GraphNode } from "@/lib/graph/model";
import { completeness, type CaseProvenance, type CheckItem } from "./completeness";

/** Checks shown as the five icons of a row, in this order. */
export const QUALITY_CHECKS = ["screenshot", "page", "har", "address", "video"] as const;
export type QualityCheck = (typeof QUALITY_CHECKS)[number];

export const QUALITY_LABEL: Record<QualityCheck, string> = { screenshot: "Zrzut", page: "Strona", har: "HAR", address: "Adres", video: "Wideo" };

export interface QualityCell {
  check: QualityCheck;
  /** "unknown": the base does not record this (no provenance.json), so nothing can be said. */
  status: "ok" | "warn" | "missing" | "unknown";
  /** Tooltip: the reason and its effect on the comparison ("Brak zapisanej strony: nie porównamy szablonu …"). */
  text: string;
  /** A gap that does not hurt the comparison by itself (e.g. no HAR when the page is saved). */
  optional: boolean;
}

export interface QualityRow {
  id: string;
  campaign: string | null;
  cells: QualityCell[];
  /** No gap that matters. */
  complete: boolean;
}

export interface QualityCount {
  check: QualityCheck;
  missing: number;
  warn: number;
}

export interface BaseQuality {
  total: number;
  counts: QualityCount[];
  /** Materials with a gap first. */
  rows: QualityRow[];
  /** Why the picture is partial (no provenance.json); null when it is full. */
  note: string | null;
}

/** One cell from the check item the completeness list produced for it. */
function cell(check: QualityCheck, items: CheckItem[], known: boolean): QualityCell {
  const it = items.find((i) => i.id === check);
  if (!it) return { check, status: known ? "ok" : "unknown", text: known ? "" : "Baza nie zapisuje tej informacji (brak provenance.json).", optional: false };
  return { check, status: it.status, text: [it.label, it.effect].filter(Boolean).join(" · "), optional: !!it.optional };
}

/**
 * Quality table of the base: `provenance` are the case records of its import (null when the base has none),
 * `nodes` the graph's nodes (item nodes give the campaign and, without provenance, the features). A material with
 * no case record is judged by its own data; the HAR cell is then "unknown".
 */
export function baseQuality(input: { provenance: CaseProvenance[] | null; nodes: GraphNode[] }): BaseQuality {
  const byId = new Map((input.provenance ?? []).flatMap((p) => [p.id, p.caseId].filter((k): k is string => !!k).map((k) => [k, p] as const)));
  const rows: QualityRow[] = input.nodes
    .filter((n) => n.type === "item")
    .map((n) => {
      const p = byId.get(n.key) ?? null;
      const c = completeness({ provenance: p, features: n.data });
      const cells = QUALITY_CHECKS.map((check) => cell(check, c.items, check === "har" ? !!p : true));
      return { id: n.key, campaign: n.campaignId, cells, complete: c.complete };
    })
    .sort((a, b) => Number(a.complete) - Number(b.complete) || a.id.localeCompare(b.id));
  const counts = QUALITY_CHECKS.map((check) => ({
    check,
    missing: rows.filter((r) => r.cells.find((c) => c.check === check)?.status === "missing").length,
    warn: rows.filter((r) => r.cells.find((c) => c.check === check)?.status === "warn").length,
  }));
  return { total: rows.length, counts, rows, note: input.provenance ? null : "Baza nie ma provenance.json (zapisu, skąd pochodzi każdy plik), więc HAR i część braków są nieznane: ocena opiera się na danych materiałów." };
}
