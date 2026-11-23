/**
 * Sentences for the fields the backend added after the first GUI: the source of the platform account,
 * the creative-file node, faces and voices, narrative, the bridge and weakest-link notes of a campaign,
 * the age of a domain against the ad and the recognised brand. Pure functions: each turns a field into
 * a plain sentence (or null when the field is absent), so the components only draw the result.
 */
import { ENTITY_LABELS_PL, type Campaign, type EntityType } from "@/lib/graph/model";
import type { FaceHit } from "@/lib/media/face";
import type { VoiceSpan } from "@/lib/media/speaker";
import type { MaterialNarrative, NarrativeSummary } from "@/lib/text/narrative";
import { count, fmtNum } from "./format";
import { ruleText } from "./strength";

const DAY: [string, string, string] = ["day", "days", "days"];
const FACE: [string, string, string] = ["face", "faces", "faces"];
const LINK: [string, string, string] = ["link", "links", "links"];
const GROUP: [string, string, string] = ["group", "groups", "groups"];

/** Topics of a narrative in words of the interface (ids from `NarrativeConfig.topics`). */
export const NARRATIVE_TOPIC_LABEL: Record<string, string> = {
  investment: "investment",
  subsidy: "subsidies and benefits",
  health: "health",
  gambling: "gambling",
  elections: "elections",
  ai_trading: "AI trading",
  gold_reserve: "gold reserves",
  commodities_war: "commodities and war",
  leaked_secret: "“forbidden secret”",
  testimonial_small_win: "quick-profit story",
  recovery: "fund recovery",
  sport_event: "sports event",
  inauguration: "inauguration",
  state_investment: "state investment",
  adult_phishing: "18+ content",
  urgent_notice: "urgent notice",
  petition: "petition",
};

const SUBTOPIC_LABEL: Record<string, string> = {
  joints: "joints",
  weight_loss: "weight loss",
  hypertension: "hypertension",
  vision: "eyesight",
  hearing: "hearing",
  diabetes: "diabetes",
  miracle_cure: "miracle cure",
};

/** Form of the hook (what the ad pretends to be). */
export const NARRATIVE_HOOK_LABEL: Record<string, string> = {
  sensation: "sensation",
  endorsement: "endorsement by a famous person",
  fake_interview: "fake interview",
};

const BRAND_KIND_LABEL: Record<string, string> = { media: "news site", bank: "bank", institution: "institution" };

/** Title-cases an id such as "monika-olejnik" for display when no name list is at hand. */
export function humanizeId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Sentences about the platform account of a sample: the warning when the tenant of the page differs
 * from the account (so the trace may come from a shared library, not one operator), then where the
 * account was read from. Takes `MaterialItemResult.features`; returns no sentences when it has neither field.
 */
export function platformAccountLines(features: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const warning = features.platformAccountWarning;
  if (typeof warning === "string" && warning) lines.push(`Warning: ${warning}. The trace may come from a shared library, not from one operator.`);
  const source = features.platformAccountSource;
  const bySource: Record<string, string> = {
    owner_uuid: "The platform account was read from the owner ID in the page code.",
    "tenant→owner_uuid": "The platform account was found from the page tenant and assigned to the owner known from another page.",
    tenant: "The platform account was found only from the tenant in file addresses (no page code with the owner): a weaker basis.",
    launcher: "The platform account was read from the launcher link.",
  };
  if (typeof source === "string" && bySource[source]) lines.push(bySource[source]);
  return lines;
}

/** Label of an image-hash node that stands for the very same creative file (SHA-256), not a similar picture; null for an ordinary image hash. */
export function exactFileLabel(nodeData: Record<string, unknown>): string | null {
  return nodeData.exactFile ? "the same ad file" : null;
}

/**
 * Sentences about faces found in a sample: one per person from the closed list with the best
 * similarity ("Face similar to X (0.57)"), then the number of faces found. It never says "this is X":
 * a similarity is a lead for a human to check, not an identification. `nameOf` turns the persona id into a name.
 */
export function faceLines(faces: FaceHit[] | undefined, nameOf: (id: string) => string = humanizeId): string[] {
  if (!faces?.length) return [];
  const best = new Map<string, number>();
  for (const f of faces) if (f.persona) best.set(f.persona, Math.max(best.get(f.persona) ?? 0, f.similarity ?? 0));
  const lines = [...best.entries()].sort((a, b) => b[1] - a[1]).map(([id, s]) => `Face similar to ${nameOf(id)} (${fmtNum(s)}), for a human to check.`);
  lines.push(best.size ? `Faces in the sample: ${faces.length}.` : `Found ${count(faces.length, FACE)}, none similar to a person on the list.`);
  return lines;
}

/** Sentences about stretches of speech similar to a person of the closed list ("Voice similar to X (0.70) at seconds 3–11"); never "this is the voice of X". */
export function voiceLines(voices: VoiceSpan[] | undefined, nameOf: (id: string) => string = humanizeId): string[] {
  return (voices ?? [])
    .filter((v) => v.persona)
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .map((v) => `Voice similar to ${nameOf(v.persona!)} (${fmtNum(v.similarity ?? 0)}) at seconds ${Math.round(v.start)}–${Math.round(v.end)}, for a human to check.`);
}

/** Name of a narrative topic with its subcategory in brackets ("health (joints)"). */
export function topicName(id: string, subtopics?: string[]): string {
  const base = NARRATIVE_TOPIC_LABEL[id] ?? id;
  const subs = (subtopics ?? []).map((s) => SUBTOPIC_LABEL[s] ?? s);
  return subs.length ? `${base} (${subs.join(", ")})` : base;
}

/** "Narrative: investment; form: fake interview." for the narrative of one sample (its two best topics); null without a narrative. A description, never evidence. */
export function narrativeLine(n: MaterialNarrative | null | undefined): string | null {
  if (!n || !n.topics.length) return null;
  const topics = n.topics.slice(0, 2).map((t) => topicName(t.id, t.subtopics)).join(", ");
  const hooks = n.hooks.map((h) => NARRATIVE_HOOK_LABEL[h] ?? h).join(", ");
  return `Narrative: ${topics}${hooks ? `; form: ${hooks}` : ""}.`;
}

/** "Narrative: investment (5), health (2)." for a campaign or a group; null without topics. */
export function narrativeSummaryLine(s: NarrativeSummary | null | undefined): string | null {
  if (!s || !s.topics.length) return null;
  return `Narrative: ${s.topics.map((t) => `${topicName(t.id, t.subtopics)} (${t.count})`).join(", ")}.`;
}

/** Topic switches within one campaign as "Same operator, two narratives: A, then B (within 3 days)." */
export function narrativeSwitchLines(s: NarrativeSummary | null | undefined): string[] {
  return (s?.switches ?? []).map((w) => `Same operator, two narratives: ${NARRATIVE_TOPIC_LABEL[w.from] ?? w.from}, then ${NARRATIVE_TOPIC_LABEL[w.to] ?? w.to} (within ${count(w.days, DAY)}).`);
}

/**
 * Note of a campaign held together by one trace: several subgroups with no
 * other shared evidence between them. It tells why it matters: when that trace is shared by many unrelated
 * pages, the campaign is too wide. Null when the campaign has no bridge.
 */
export function bridgeNote(c: Campaign): string | null {
  if (!c.bridge) return null;
  const sizes = c.bridge.parts.map((p) => p.length).join(" and ");
  return `Campaign held together by one trace: ${c.bridge.label}. It joins ${count(c.bridge.parts.length, GROUP)} of ${sizes} samples; when the trace is shared by many sites, the campaign is too wide.`;
}

/** The loosest member of a campaign: its best joining link against the link threshold, i.e. how close to splitting off it hangs; null when the field is absent (one member). */
export function weakestLinkNote(c: Campaign, minLinkScore: number): string | null {
  if (c.minInternalScore === undefined || !c.weakestMember) return null;
  return `Weakest link: ${c.weakestMember.id}, best link ${fmtNum(c.minInternalScore)} (linking threshold ${fmtNum(minLinkScore)}), ${count(c.weakestMember.links, LINK)}.`;
}

/**
 * Age of a domain (RDAP) or of its first certificate against the first appearance of the ad, in whole
 * days: "domain registered 2 days before the ad was first shown". A negative age means the registration is dated after the
 * ad (the domain may have been registered again). Null without data. A description, not a risk score.
 */
export function domainAgeNote(days: number | null | undefined, kind: "domain" | "cert"): string | null {
  if (days === null || days === undefined || !Number.isFinite(days)) return null;
  const subject = kind === "domain" ? "domain registered" : "first certificate issued";
  if (days === 0) return `${subject} on the day the ad was first shown`;
  if (days > 0) return `${subject} ${count(days, DAY)} before the ad was first shown`;
  return `${subject} ${count(-days, DAY)} after the ad was first shown${kind === "domain" ? " (possibly registered again)" : ""}`;
}

/** Brand recognised on the creative (CLIP zero-shot): "Imitated brand: X (news site), recognised on the creative (0.81)." It says whom the ad imitates; null without a brand. */
export function brandNote(b: { name: string; kind: string; probability: number } | null | undefined): string | null {
  if (!b) return null;
  return `Imitated brand: ${b.name} (${BRAND_KIND_LABEL[b.kind] ?? b.kind}), recognised on the creative (${fmtNum(b.probability)}).`;
}

/**
 * Short label of a link between a new sample and a known one. A link marked `variant` is the creative the
 * sample joined its campaign by: it must not carry the pair rule's wording ("one kind of evidence: similar at
 * most"), which would read as contradicting the verdict "known campaign".
 */
export function linkRuleLabel(link: { rule: string; variant?: boolean }): string {
  if (link.variant) return "variant: assigned by the creative, lower confidence";
  const labels: Record<string, string> = {
    campaign: "links into a campaign",
    single_kind: "one kind of evidence: similar at most",
    account_conflict: "different platform accounts: similar at most",
    below: "too weak",
  };
  return labels[link.rule] ?? ruleText(link.rule, 0);
}

/** Name of a graph node's type for the interface: the creative-file node is "the same ad file", the rest use the type's display name. */
export function nodeTypeLabel(node: { type: EntityType; data: Record<string, unknown> }): string {
  return exactFileLabel(node.data) ?? ENTITY_LABELS_PL[node.type];
}
