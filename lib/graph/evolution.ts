/**
 * Stable and changing traits of a campaign (`Campaign.evolution`), for the "campaign evolution" view:
 * what the operator kept (tracker, backend) and what it rotated over time (domains, personas), with the
 * date each new value first appeared. Computed once at build time so the viewer does not have to.
 */
import type { ItemPivot } from "./link";
import type { CampaignEvolution, CampaignTraitGroup, CampaignTraitValue, EntityType } from "./model";

/**
 * Traits of the members of one campaign split into stable and changing ones (see CampaignEvolution).
 * `pivots`: each member's graph pivots (buildEvidenceGraph with includeItemPivots); only direct
 * relations count, because an outbound link or a parked page names someone else's site, not a trait
 * of the campaign. `firstSeen`: date of each member (ISO, null when unknown); `label`: node label of a
 * pivot id. Types and values are ordered by name and by first appearance (undated last).
 */
export function campaignEvolution(
  members: string[],
  pivots: Record<string, ItemPivot[]>,
  firstSeen: Record<string, string | null>,
  label: (pivotId: string) => string,
): CampaignEvolution {
  const byType = new Map<EntityType, Map<string, Set<string>>>();
  for (const m of members) {
    for (const f of pivots[m] ?? []) {
      if (f.relation < 1) continue;
      const values = byType.get(f.type) ?? new Map<string, Set<string>>();
      values.set(f.pivot, (values.get(f.pivot) ?? new Set<string>()).add(m));
      byType.set(f.type, values);
    }
  }
  const earliest = (holders: Set<string>) => [...holders].map((m) => firstSeen[m] ?? null).filter((d): d is string => !!d).sort()[0] ?? null;
  const order = (a: CampaignTraitValue, b: CampaignTraitValue) => (a.firstSeen ?? "￿").localeCompare(b.firstSeen ?? "￿") || a.label.localeCompare(b.label);
  const stable: CampaignTraitGroup[] = [];
  const changing: CampaignTraitGroup[] = [];
  for (const type of [...byType.keys()].sort()) {
    const values = [...byType.get(type)!].map(([id, holders]): CampaignTraitValue & { all: boolean } => ({ id, label: label(id), firstSeen: earliest(holders), items: holders.size, all: holders.size === members.length }));
    const strip = (v: CampaignTraitValue & { all: boolean }): CampaignTraitValue => ({ id: v.id, label: v.label, firstSeen: v.firstSeen, items: v.items });
    const shared = values.filter((v) => v.all);
    if (shared.length) stable.push({ type, values: shared.map(strip).sort(order) });
    if (shared.length < values.length) changing.push({ type, values: values.map(strip).sort(order) });
  }
  return { stable, changing };
}
