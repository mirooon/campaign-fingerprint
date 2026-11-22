/**
 * Stable campaign ids across a rebuild of the base. The clustering numbers campaigns afresh on every run, so
 * adding one material could renumber all of them; a case file, a report or a link to "K07" would point elsewhere.
 * `keepCampaignIds` gives each new cluster the id of the old campaign it shares the most records with, and a new id
 * to the clusters that match none. Pure: no files.
 */
import type { CampaignsFile, EvidenceGraph } from "./model";

/** Old ids and their member sets against new ids and theirs. */
type MemberSets = Map<string, Set<string>>;

/**
 * Mapping new id → final id. Pairs are taken by the largest overlap of members first (ties: the lower old id, then the
 * lower new id), each old id at most once; the rest get fresh ids numbered after the highest old one, in the order of
 * `fresh` (the new ids as listed by the clustering). Returns the mapping and the fresh ids.
 */
function matchIds(prev: MemberSets, next: MemberSets, fresh: string[]): { map: Map<string, string>; created: string[] } {
  const pairs: Array<{ oldId: string; newId: string; overlap: number }> = [];
  for (const [newId, nm] of next) {
    for (const [oldId, om] of prev) {
      let overlap = 0;
      for (const m of nm) if (om.has(m)) overlap++;
      if (overlap) pairs.push({ oldId, newId, overlap });
    }
  }
  pairs.sort((a, b) => b.overlap - a.overlap || a.oldId.localeCompare(b.oldId) || a.newId.localeCompare(b.newId));
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const p of pairs) {
    if (map.has(p.newId) || used.has(p.oldId)) continue;
    map.set(p.newId, p.oldId);
    used.add(p.oldId);
  }
  const shape = [...prev.keys(), ...fresh][0]?.match(/^(\D*)(\d+)$/);
  const prefix = shape?.[1] ?? "K";
  const width = shape?.[2].length ?? 2;
  let n = Math.max(0, ...[...prev.keys()].map((id) => Number(/(\d+)$/.exec(id)?.[1] ?? 0)));
  const created: string[] = [];
  for (const newId of fresh) {
    if (map.has(newId)) continue;
    const id = `${prefix}${String(++n).padStart(width, "0")}`;
    map.set(newId, id);
    created.push(id);
  }
  return { map, created };
}

/**
 * The campaigns of `next` (a fresh clustering of the grown base) under the ids of `prev` (the clustering before),
 * for campaigns, groups of similar campaigns (`families`), `assignments`, `familyId` and the `campaignId` of the
 * item nodes of the graph. `prev` null (a base without campaigns) leaves `next` as it is. `created` lists the ids
 * given to campaigns that had no predecessor.
 */
export function keepCampaignIds(prev: CampaignsFile | null, next: CampaignsFile, graph: EvidenceGraph): { campaigns: CampaignsFile; graph: EvidenceGraph; created: string[] } {
  if (!prev) return { campaigns: next, graph, created: [] };
  /** Member sets by id, the shape `matchIds` compares. */
  const sets = (list: Array<{ id: string; members: string[] }>): MemberSets => new Map(list.map((x) => [x.id, new Set(x.members)]));
  const camp = matchIds(sets(prev.campaigns), sets(next.campaigns), next.campaigns.map((c) => c.id));
  const fam = matchIds(sets(prev.families ?? []), sets(next.families ?? []), (next.families ?? []).map((f) => f.id));
  /** Final id of a campaign of `next`. */
  const cid = (id: string) => camp.map.get(id) ?? id;
  /** Final id of a group of similar campaigns of `next`; null/undefined stay as they are. */
  const fid = (id: string | null | undefined) => (id ? (fam.map.get(id) ?? id) : (id ?? null));
  const campaigns: CampaignsFile = {
    ...next,
    campaigns: next.campaigns.map((c) => ({ ...c, id: cid(c.id), ...(c.familyId !== undefined ? { familyId: fid(c.familyId) } : {}) })),
    ...(next.families ? { families: next.families.map((f) => ({ ...f, id: fid(f.id) ?? f.id, campaigns: f.campaigns.map(cid).sort() })) } : {}),
    assignments: Object.fromEntries(Object.entries(next.assignments).map(([item, c]) => [item, cid(c)])),
  };
  const renamed: EvidenceGraph = { ...graph, nodes: graph.nodes.map((n) => (n.type === "item" && n.campaignId ? { ...n, campaignId: cid(n.campaignId) } : n)) };
  return { campaigns, graph: renamed, created: camp.created };
}
