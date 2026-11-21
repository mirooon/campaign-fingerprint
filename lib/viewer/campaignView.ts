/**
 * Campaign list logic (§8.2): descriptive name, plain label of the link strength, the note for a
 * campaign made of content only, and the split into groups of similar campaigns, single campaigns
 * and materials without links. Pure functions.
 */
import type { Campaign, CampaignFamily } from "@/lib/graph/model";
import { fmtNum } from "./format";

/** Mean link strength inside a campaign from which it is called "wysoka" / "średnia". */
export const COHESION_HIGH = 0.7;
export const COHESION_MEDIUM = 0.4;

/** "Adam Testowy · przyklad.test · K03": the impersonated person and the main domain, then the id. */
export function campaignTitle(c: Campaign): string {
  const parts = [c.attributes.personas[0]?.name, c.domains[0], c.id].filter((p): p is string => !!p);
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
  /** Materials without links (campaigns of one material), folded in the list. */
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
