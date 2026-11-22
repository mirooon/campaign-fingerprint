/**
 * Enriched dataset of a run as one row per material (JSON and CSV), for further analysis outside the tool.
 * Pure functions: the script reads graph.json and campaigns.json and writes the files. Only what the graph
 * holds as a fact or a premise leaves: no voice, face or image vectors (biometric data), only the persona
 * and the deepfake score from the input.
 */
import { adLibraryUrl } from "../osint/adLibrary";
import type { CampaignsFile, EvidenceGraph } from "../graph/model";
import { cell } from "./materialCsv";

/** How many premises (shared pivots and similarities with other members of the campaign) go into `top_premises`. */
export const EXPORT_TOP_PREMISES = 3;

export const EXPORT_COLUMNS = ["material_id", "campaign_id", "family_id", "features", "top_premises", "ad_library_url", "basis", "persona", "deepfake_score"] as const;

export interface ExportRow {
  material_id: string;
  /** Campaign of the material; "" when it belongs to none. */
  campaign_id: string;
  /** Group of similar campaigns; "" when none. */
  family_id: string;
  /** Number of distinct graph entities of each type the material is attached to (tracker, domain, ip, ...). */
  features: Record<string, number>;
  /** The strongest premises (weight, descending) that tie the material to other members of its campaign. */
  top_premises: string[];
  /** Link to the Meta Ad Library entry of the material; "" when the ID is unknown. */
  ad_library_url: string;
  /** What the campaign stands on: content, infrastructure or mixed ("" when unknown). */
  basis: string;
  /** Impersonated people found in the material (names). */
  persona: string[];
  /** Deepfake score from the input data, 0..1 (a model output, not a fact); null when none. */
  deepfake_score: number | null;
}

/**
 * Counts the distinct entities of each type reachable from an item along the graph edges (the item
 * points at its URL, the URL at its host, the host at its IP and so on), the item itself left out:
 * the traits the material rests on, not only its direct neighbours.
 */
function featureCounts(start: string, out: Map<string, string[]>, nodeType: Map<string, string>): Record<string, number> {
  const seen = new Set<string>([start]);
  const queue = [start];
  const counts: Record<string, number> = {};
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    for (const next of out.get(id) ?? []) {
      const type = nodeType.get(next);
      if (seen.has(next) || !type || type === "item") continue;
      seen.add(next);
      queue.push(next);
      counts[type] = (counts[type] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Builds the rows from the evidence graph and the campaigns of one run, in the order of the item nodes.
 * `features` counts entities by type; `top_premises` takes the evidence text of the links to the other
 * members of the campaign (a singleton has none).
 */
export function exportDataset(graph: EvidenceGraph, campaigns: CampaignsFile): ExportRow[] {
  const nodeType = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const byId = new Map(campaigns.campaigns.map((c) => [c.id, c]));
  const out = new Map<string, string[]>();
  for (const e of graph.edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  return graph.nodes
    .filter((n) => n.type === "item")
    .map((n) => {
      const campaignId = campaigns.assignments[n.key] ?? null;
      const campaign = campaignId ? byId.get(campaignId) : undefined;
      const members = new Set(campaign?.members ?? []);
      const premises = graph.links
        .filter((l) => (l.a === n.key && members.has(l.b)) || (l.b === n.key && members.has(l.a)))
        .flatMap((l) => l.evidence)
        .sort((x, y) => y.weight - x.weight);
      // the ID read from a screenshot or the input, else the one of a record fetched from the library
      const libraryId = (n.data.adLibraryIds as string[] | undefined)?.[0] ?? (n.data.adLibrary as Array<{ id: string }> | undefined)?.[0]?.id;
      const score = n.data.deepfakeScore;
      return {
        material_id: n.key,
        campaign_id: campaignId ?? "",
        family_id: campaign?.familyId ?? "",
        features: featureCounts(n.id, out, nodeType),
        top_premises: [...new Set(premises.map((p) => p.evidence))].slice(0, EXPORT_TOP_PREMISES),
        ad_library_url: libraryId ? adLibraryUrl(libraryId) : "",
        basis: campaign?.attributes.basis ?? "",
        persona: (n.data.personas as string[] | undefined) ?? [],
        deepfake_score: typeof score === "number" ? score : null,
      };
    });
}

/** CSV of the rows in the fixed column order; lists are joined (features as `type=n;...`, premises with " | ", persons with ";"). */
export function exportRowsCsv(rows: ExportRow[]): string {
  /** One CSV row of a dataset row, in the order of EXPORT_COLUMNS. */
  const line = (r: ExportRow): string[] => [
    r.material_id,
    r.campaign_id,
    r.family_id,
    Object.entries(r.features)
      .map(([t, n]) => `${t}=${n}`)
      .join(";"),
    r.top_premises.join(" | "),
    r.ad_library_url,
    r.basis,
    r.persona.join(";"),
    r.deepfake_score === null ? "" : String(r.deepfake_score),
  ];
  return `${[[...EXPORT_COLUMNS], ...rows.map(line)].map((r) => r.map(cell).join(",")).join("\n")}\n`;
}
