/**
 * Evaluation of a material-analysis batch (the CSV of `analyze-material`) against a labels file of
 * one's own: which record belongs to which true campaign. Gives pairwise and B-cubed scores
 * (lib/graph/eval) in one step, so a user with labelled materials can measure the tool on them.
 */
import { evaluateClustering, type EvalResult } from "../graph/eval";

/** Columns of the batch CSV that the evaluation reads (see MATERIAL_CSV_COLUMNS). */
type BatchRow = Record<string, string>;

/**
 * Predicted cluster of every record of a batch: the known campaign (`campaign_id`), else the new
 * campaign it opens with other records (`new_campaign_id`), else the cluster of the record it
 * duplicates (`duplicate_of`), else the record alone (`material:<id>`). "Similar campaigns" do not
 * place a record in a campaign: the tool says only that it resembles them, so it stays alone.
 */
export function materialClusters(rows: BatchRow[]): Record<string, string> {
  const byId = new Map(rows.map((r) => [r.material_id, r]));
  const own = (r: BatchRow): string | null => r.campaign_id || r.new_campaign_id || null;
  const out: Record<string, string> = {};
  for (const r of rows) {
    let cluster = own(r);
    // a duplicate of a duplicate: follow the chain to a record with a campaign (cycles end alone)
    const seen = new Set<string>([r.material_id]);
    for (let d = r.duplicate_of; !cluster && d && !seen.has(d); d = byId.get(d)?.duplicate_of ?? "") {
      seen.add(d);
      const target = byId.get(d);
      cluster = target ? own(target) : null;
      if (!cluster && target && !target.duplicate_of) cluster = `material:${d}`;
    }
    out[r.material_id] = cluster ?? `material:${r.material_id}`;
  }
  return out;
}

/**
 * Case (or record) → true campaign from a labels file in either shape: label → list of cases (the
 * shape of a team's labels file, a case without a pair under its own label) or case → label.
 * Throws on any other shape, so a wrong file does not score as "no labels".
 */
export function truthFromLabels(json: unknown): Record<string, string> {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("plik etykiet: oczekiwano obiektu JSON");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(json)) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) for (const c of v) out[c] = k;
    else throw new Error(`plik etykiet: wartość dla „${k}” nie jest ani etykietą, ani listą spraw`);
  }
  return out;
}

/**
 * Scores a batch against true campaigns. A record is matched to its label by its `case` column,
 * then by `material_id`; records without a label are listed in `unlabeled` and left out of the score.
 * `breakdown`: for every true campaign, how its records were spread over predicted clusters.
 */
export function evaluateMaterialRows(
  rows: BatchRow[],
  truth: Record<string, string>,
): { result: EvalResult; unlabeled: string[]; breakdown: Array<{ label: string; size: number; predicted: Record<string, number> }> } {
  const predicted = materialClusters(rows);
  const gold: Record<string, string> = {};
  const unlabeled: string[] = [];
  for (const r of rows) {
    const label = truth[r.case] ?? truth[r.material_id];
    if (label === undefined) unlabeled.push(r.material_id);
    else gold[r.material_id] = label;
  }
  const byLabel = new Map<string, Record<string, number>>();
  for (const [id, label] of Object.entries(gold)) {
    const m = byLabel.get(label) ?? {};
    m[predicted[id]] = (m[predicted[id]] ?? 0) + 1;
    byLabel.set(label, m);
  }
  const breakdown = [...byLabel.entries()]
    .map(([label, p]) => ({ label, size: Object.values(p).reduce((a, b) => a + b, 0), predicted: p }))
    .sort((a, b) => b.size - a.size || a.label.localeCompare(b.label));
  return { result: evaluateClustering(predicted, gold), unlabeled, breakdown };
}
