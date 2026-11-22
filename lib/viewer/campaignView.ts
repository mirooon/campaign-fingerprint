/**
 * Campaign list logic (§8.2): descriptive name, plain label of the link strength, the note for a
 * campaign made of content only, and the split into groups of similar campaigns, single campaigns
 * and materials without links. Pure functions.
 */
import type { Campaign, CampaignFamily } from "@/lib/graph/model";
import { NARRATIVE_TOPIC_LABEL, topicName } from "./fields";
import { fmtNum } from "./format";

/** Mean link strength inside a campaign from which it is called "wysoka" / "średnia". */
export const COHESION_HIGH = 0.7;
export const COHESION_MEDIUM = 0.4;

/** "Adam Testowy · inwestycje · przyklad.test · K03": the impersonated person, the main narrative, the main domain, then the id. */
export function campaignTitle(c: Campaign): string {
  const topic = c.attributes.narrative?.topics[0];
  const parts = [c.attributes.personas[0]?.name, topic ? topicName(topic.id, topic.subtopics) : undefined, c.domains[0], c.id].filter((p): p is string => !!p);
  return parts.join(" · ");
}

/** Strength of the links inside a campaign in words with the number: "wysoka (0,82)". */
export function cohesionLabel(cohesion: number): string {
  const word = cohesion >= COHESION_HIGH ? "wysoka" : cohesion >= COHESION_MEDIUM ? "średnia" : "niska";
  return `${word} (${fmtNum(cohesion)})`;
}

/** Weaker basis of a campaign made of content only (basis "content"); null for infrastructure or mixed. */
export function basisNote(c: Campaign): string | null {
  return c.attributes.basis === "content" ? "kampania z treści, bez infrastruktury" : null;
}

export interface FamilyGroup {
  family: CampaignFamily;
  campaigns: Campaign[];
}

export interface GroupedCampaigns {
  families: FamilyGroup[];
  /** Campaigns of two or more materials outside any group. */
  alone: Campaign[];
  /** Materials left alone (campaigns of one material) outside any group, folded in the list. */
  singletons: Campaign[];
}

/** Splits the campaigns for the list: groups of similar campaigns in frames, the rest by size. */
export function groupCampaigns(campaigns: Campaign[], families: CampaignFamily[]): GroupedCampaigns {
  const byId = new Map(campaigns.map((c) => [c.id, c]));
  const inFamily = new Set<string>();
  const groups: FamilyGroup[] = [];
  for (const f of families) {
    const members = f.campaigns.map((id) => byId.get(id)).filter((c): c is Campaign => !!c);
    if (!members.length) continue;
    members.forEach((c) => inFamily.add(c.id));
    groups.push({ family: f, campaigns: members });
  }
  const rest = campaigns.filter((c) => !inFamily.has(c.id));
  return { families: groups, alone: rest.filter((c) => c.size > 1), singletons: rest.filter((c) => c.size <= 1) };
}

export interface BaseCounts {
  /** Campaigns of two or more materials. */
  campaigns: number;
  /** Materials left alone (campaigns of one material, each with its own K number), in a group frame or not. */
  singles: number;
  /** Of `singles`, the ones shown inside a frame of a group of similar campaigns. */
  singlesInFamilies: number;
  families: number;
}

/**
 * Counts for the header of the base: campaigns of two or more materials, materials left alone and groups of
 * similar campaigns. Campaigns plus singles give every K number, so the header agrees with the highest K number;
 * singles minus `singlesInFamilies` is the folded section of single materials in the Kampanie tab.
 */
export function baseCounts(campaigns: Campaign[], families: CampaignFamily[]): BaseCounts {
  const inFamily = new Set(families.flatMap((f) => f.campaigns));
  const singles = campaigns.filter((c) => c.size <= 1);
  return { campaigns: campaigns.length - singles.length, singles: singles.length, singlesInFamilies: singles.filter((c) => inFamily.has(c.id)).length, families: families.length };
}

/** Materials left alone that stand in group frames of the grouped list (not in the folded section). */
export function singlesInFamilyFrames(grouped: GroupedCampaigns): number {
  return grouped.families.reduce((n, g) => n + g.campaigns.filter((c) => c.size <= 1).length, 0);
}

/**
 * The material left alone to reveal in the folded section: the open campaign (`?k=`) when it is one of the
 * listed singletons, otherwise null. A campaign of one material inside a group frame is visible anyway.
 */
export function singleToReveal(singletons: Campaign[], openId: string | null): string | null {
  return openId && singletons.some((c) => c.id === openId) ? openId : null;
}

/** The campaign whose number the search names exactly ("K50", "k50 "), or null; then its card opens. */
export function campaignIdInQuery(campaigns: Campaign[], query: string): string | null {
  const q = query.trim().toUpperCase();
  return q ? (campaigns.find((c) => c.id.toUpperCase() === q)?.id ?? null) : null;
}

/** Element id of a campaign card, the target of scrolling to it. */
export function campaignAnchorId(id: string): string {
  return `kampania-${id}`;
}

export interface CampaignFilter {
  /** Main narrative topic id (`attributes.narrative.topics[].id`). */
  topic?: string;
  /** Page platform id (`attributes.platforms[].id`). */
  platform?: string;
  /** ISO date or date-time: only campaigns active on or after it (last ad not earlier). */
  from?: string;
  /** Only campaigns that started on or before it (first ad not later). */
  to?: string;
}

/** Narrative topics present among the campaigns for a filter list, most campaigns first. */
export function narrativeOptions(campaigns: Campaign[]): Array<{ id: string; label: string; campaigns: number }> {
  const counts = new Map<string, number>();
  for (const c of campaigns) for (const t of c.attributes.narrative?.topics ?? []) counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
  return [...counts].map(([id, n]) => ({ id, label: NARRATIVE_TOPIC_LABEL[id] ?? id, campaigns: n })).sort((a, b) => b.campaigns - a.campaigns || a.label.localeCompare(b.label, "pl"));
}

/** Page platforms (page builders, tracker products) present among the campaigns for a filter list, most campaigns first. */
export function platformOptions(campaigns: Campaign[]): Array<{ id: string; campaigns: number }> {
  const counts = new Map<string, number>();
  for (const c of campaigns) for (const p of c.attributes.platforms ?? []) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  return [...counts].map(([id, n]) => ({ id, campaigns: n })).sort((a, b) => b.campaigns - a.campaigns || a.id.localeCompare(b.id));
}

/** Whether a campaign passes the narrative, platform and period filter; an empty filter passes all. A campaign without dates fails a date filter. */
export function campaignMatchesFilter(c: Campaign, f: CampaignFilter): boolean {
  if (f.topic && !(c.attributes.narrative?.topics ?? []).some((t) => t.id === f.topic)) return false;
  if (f.platform && !(c.attributes.platforms ?? []).some((p) => p.id === f.platform)) return false;
  if (f.from && !(c.lastSeen && c.lastSeen >= f.from)) return false;
  if (f.to && !(c.firstSeen && c.firstSeen.slice(0, f.to.length) <= f.to)) return false;
  return true;
}
