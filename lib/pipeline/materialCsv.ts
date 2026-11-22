/**
 * Batch result of the material analysis as one CSV row per record. The viewer exports the same
 * format, so the column names and their order are fixed.
 */
import type { MaterialItemResult, MaterialLink, MaterialResult } from "./analyzeMaterial";

export const MATERIAL_CSV_COLUMNS = [
  "material_id",
  "case",
  "verdict",
  "campaign_id",
  "similar_campaigns",
  "new_campaign_id",
  "duplicate_of",
  "confidence",
  "score",
  "top_premise",
  "missing_data",
  "blisko_bez_polaczenia",
] as const;

export type MaterialConfidence = "certain" | "likely" | "uncertain";

/** A premise of high strength: strong (merging) evidence, or a weight at the strong threshold. */
export const HIGH_PREMISE_WEIGHT = 0.7;
/** Link score from which an assignment is "likely". */
export const LIKELY_LINK_SCORE = 0.5;

/** Best link behind the verdict: to the record's campaign, or to one of the similar campaigns. */
export function bestCampaignLink(item: MaterialItemResult): MaterialLink | null {
  const targets = item.campaign ? [item.campaign] : item.verdict === "similar_campaigns" ? item.similarCampaigns : [];
  const links = item.links.filter((l) => l.otherCampaign && targets.includes(l.otherCampaign));
  return links.sort((a, b) => Number(b.strong) - Number(a.strong) || b.score - a.score)[0] ?? null;
}

/**
 * certain: the best link to the campaign has a premise of high strength (a duplicate counts as one:
 * it is the same ad); likely: that link scores at least 0.5; uncertain: the rest (also no campaign).
 * A record placed in its campaign as a creative variant (`campaignBasis: "content_variant"`, also a
 * duplicate of such a record) is at most likely: it has no infrastructure of its own, so the
 * campaign rests on the creative alone, however strong that premise is.
 */
export function materialConfidence(item: MaterialItemResult): MaterialConfidence {
  const raw = rawConfidence(item);
  return item.campaignBasis === "content_variant" && raw === "certain" ? "likely" : raw;
}

/** Confidence from the verdict and the best link alone (see materialConfidence). */
function rawConfidence(item: MaterialItemResult): MaterialConfidence {
  if (item.verdict === "duplicate" && (item.campaign || item.newCampaign)) return "certain";
  const best = bestCampaignLink(item);
  if (!best) return "uncertain";
  if (best.strong || best.evidence.some((e) => e.strong || e.weight >= HIGH_PREMISE_WEIGHT)) return "certain";
  return best.score >= LIKELY_LINK_SCORE ? "likely" : "uncertain";
}

/** One CSV cell: quoted when it holds a comma, quote or line break; null and undefined are an empty cell. */
export function cell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Cell "blisko_bez_polaczenia": the known campaigns the record came close to and the rule that kept it out, e.g. "K03: account-conflict; K07: family-only-kind". */
function nearMissCell(item: MaterialItemResult): string {
  return (item.nearMisses ?? []).map((n) => `${n.campaign}: ${n.rule}`).join("; ");
}

export function materialCsvRow(item: MaterialItemResult): string[] {
  const best = bestCampaignLink(item);
  const premise = item.verdict === "duplicate" && item.duplicateOf ? `duplikat ${item.duplicateOf.id}: ${item.duplicateOf.reason}` : (best?.evidence[0]?.evidence ?? "");
  return [
    item.id,
    item.caseId ?? item.id,
    item.verdict,
    item.campaign ?? "",
    item.similarCampaigns.join(";"),
    item.newCampaign ?? "",
    item.duplicateOf?.id ?? "",
    materialConfidence(item),
    best ? best.score.toFixed(4) : "",
    premise,
    (item.missing ?? []).join("; "),
    nearMissCell(item),
  ];
}

export function materialCsv(result: Pick<MaterialResult, "items">): string {
  const rows = [MATERIAL_CSV_COLUMNS as readonly string[], ...result.items.map(materialCsvRow)];
  return `${rows.map((r) => r.map(cell).join(",")).join("\n")}\n`;
}
