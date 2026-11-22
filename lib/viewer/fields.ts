/**
 * Sentences for the fields the backend added after the first GUI: the source of the platform account,
 * the creative-file node, faces and voices, narrative, the bridge and weakest-link notes of a campaign,
 * the age of a domain against the ad and the recognised brand. Pure functions: each turns a field into
 * a plain Polish sentence (or null when the field is absent), so the components only draw the result.
 */
import { ENTITY_LABELS_PL, type Campaign, type EntityType } from "@/lib/graph/model";
import type { FaceHit } from "@/lib/media/face";
import type { VoiceSpan } from "@/lib/media/speaker";
import type { MaterialNarrative, NarrativeSummary } from "@/lib/text/narrative";
import { count, fmtNum } from "./format";
import { ruleText } from "./strength";

const DAY: [string, string, string] = ["dzień", "dni", "dni"];
const FACE: [string, string, string] = ["twarz", "twarze", "twarzy"];
const LINK: [string, string, string] = ["powiązanie", "powiązania", "powiązań"];
const GROUP: [string, string, string] = ["grupa", "grupy", "grup"];

/** Topics of a narrative in words of the interface (ids from `NarrativeConfig.topics`). */
export const NARRATIVE_TOPIC_LABEL: Record<string, string> = {
  investment: "inwestycje",
  subsidy: "dotacje i świadczenia",
  health: "zdrowie",
  gambling: "hazard",
  elections: "wybory",
  ai_trading: "handel z użyciem AI",
  gold_reserve: "rezerwy złota",
  commodities_war: "surowce i wojna",
  leaked_secret: "„zakazana tajemnica”",
  testimonial_small_win: "historia szybkiego zysku",
  recovery: "odzyskiwanie środków",
  sport_event: "wydarzenie sportowe",
  inauguration: "zaprzysiężenie",
  state_investment: "inwestycje państwowe",
  adult_phishing: "treści 18+",
  urgent_notice: "pilne wezwanie",
  petition: "petycja",
};

const SUBTOPIC_LABEL: Record<string, string> = {
  joints: "stawy",
  weight_loss: "odchudzanie",
  hypertension: "nadciśnienie",
  vision: "wzrok",
  hearing: "słuch",
  diabetes: "cukrzyca",
  miracle_cure: "cudowny lek",
};

/** Form of the hook (what the ad pretends to be). */
export const NARRATIVE_HOOK_LABEL: Record<string, string> = {
  sensation: "sensacja",
  endorsement: "polecenie przez znaną osobę",
  fake_interview: "fałszywy wywiad",
};

const BRAND_KIND_LABEL: Record<string, string> = { media: "portal informacyjny", bank: "bank", institution: "instytucja" };

/** Title-cases an id such as "monika-olejnik" for display when no name list is at hand. */
export function humanizeId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Sentences about the platform account of a material: the warning when the tenant of the page differs
 * from the account (so the trace may come from a shared library, not one operator), then where the
 * account was read from. Takes `MaterialItemResult.features`; returns no sentences when it has neither field.
 */
export function platformAccountLines(features: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const warning = features.platformAccountWarning;
  if (typeof warning === "string" && warning) lines.push(`Uwaga: ${warning}. Ślad może pochodzić ze wspólnej biblioteki, nie od jednego operatora.`);
  const source = features.platformAccountSource;
  const bySource: Record<string, string> = {
    owner_uuid: "Konto platformy odczytano z identyfikatora właściciela w kodzie strony.",
    "tenant→owner_uuid": "Konto platformy ustalono po najemcy strony i przypisano do właściciela znanego z innej strony.",
    tenant: "Konto platformy ustalono tylko po najemcy w adresach plików (bez kodu strony z właścicielem): słabsza podstawa.",
    launcher: "Konto platformy odczytano z linku launchera.",
  };
  if (typeof source === "string" && bySource[source]) lines.push(bySource[source]);
  return lines;
}

/** Label of an image-hash node that stands for the very same creative file (SHA-256), not a similar picture; null for an ordinary image hash. */
export function exactFileLabel(nodeData: Record<string, unknown>): string | null {
  return nodeData.exactFile ? "ten sam plik reklamy" : null;
}

/**
 * Sentences about faces found in a material: one per person from the closed list with the best
 * similarity ("Podobna twarz do X (0,57)"), then the number of faces found. It never says "to jest X":
 * a similarity is a lead for a human to check, not an identification. `nameOf` turns the persona id into a name.
 */
export function faceLines(faces: FaceHit[] | undefined, nameOf: (id: string) => string = humanizeId): string[] {
  if (!faces?.length) return [];
  const best = new Map<string, number>();
  for (const f of faces) if (f.persona) best.set(f.persona, Math.max(best.get(f.persona) ?? 0, f.similarity ?? 0));
  const lines = [...best.entries()].sort((a, b) => b[1] - a[1]).map(([id, s]) => `Podobna twarz do ${nameOf(id)} (${fmtNum(s)}), do sprawdzenia przez człowieka.`);
  lines.push(best.size ? `Twarzy na materiale: ${count(faces.length, FACE)}.` : `Znaleziono ${count(faces.length, FACE)}, żadna nie jest podobna do osoby z listy.`);
  return lines;
}

/** Sentences about stretches of speech similar to a person of the closed list ("Głos podobny do X (0,70) w sekundach 3–11"); never "to głos X". */
export function voiceLines(voices: VoiceSpan[] | undefined, nameOf: (id: string) => string = humanizeId): string[] {
  return (voices ?? [])
    .filter((v) => v.persona)
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .map((v) => `Głos podobny do ${nameOf(v.persona!)} (${fmtNum(v.similarity ?? 0)}) w sekundach ${Math.round(v.start)}–${Math.round(v.end)}, do sprawdzenia przez człowieka.`);
}

/** Name of a narrative topic with its subcategory in brackets ("zdrowie (stawy)"). */
export function topicName(id: string, subtopics?: string[]): string {
  const base = NARRATIVE_TOPIC_LABEL[id] ?? id;
  const subs = (subtopics ?? []).map((s) => SUBTOPIC_LABEL[s] ?? s);
  return subs.length ? `${base} (${subs.join(", ")})` : base;
}

/** "Narracja: inwestycje; forma: fałszywy wywiad." for the narrative of one material (its two best topics); null without a narrative. A description, never evidence. */
export function narrativeLine(n: MaterialNarrative | null | undefined): string | null {
  if (!n || !n.topics.length) return null;
  const topics = n.topics.slice(0, 2).map((t) => topicName(t.id, t.subtopics)).join(", ");
  const hooks = n.hooks.map((h) => NARRATIVE_HOOK_LABEL[h] ?? h).join(", ");
  return `Narracja: ${topics}${hooks ? `; forma: ${hooks}` : ""}.`;
}

/** "Narracja kampanii: inwestycje (5), zdrowie (2)." for a campaign or a group; null without topics. */
export function narrativeSummaryLine(s: NarrativeSummary | null | undefined): string | null {
  if (!s || !s.topics.length) return null;
  return `Narracja: ${s.topics.map((t) => `${topicName(t.id, t.subtopics)} (${t.count})`).join(", ")}.`;
}

/** Topic switches within one campaign as "Ten sam operator, dwie narracje: A, potem B (w ciągu 3 dni)." */
export function narrativeSwitchLines(s: NarrativeSummary | null | undefined): string[] {
  return (s?.switches ?? []).map((w) => `Ten sam operator, dwie narracje: ${NARRATIVE_TOPIC_LABEL[w.from] ?? w.from}, potem ${NARRATIVE_TOPIC_LABEL[w.to] ?? w.to} (w ciągu ${count(w.days, DAY)}).`);
}

/**
 * Note of a campaign held together by one trace ("sklejona jednym śladem"): several subgroups with no
 * other shared evidence between them. It tells why it matters: when that trace is shared by many unrelated
 * pages, the campaign is too wide. Null when the campaign has no bridge.
 */
export function bridgeNote(c: Campaign): string | null {
  if (!c.bridge) return null;
  const sizes = c.bridge.parts.map((p) => p.length).join(" i ");
  return `Kampania sklejona jednym śladem: ${c.bridge.label}. Łączy ${count(c.bridge.parts.length, GROUP)}, w nich materiałów: ${sizes}; gdy ślad jest wspólny dla wielu stron, kampania jest za szeroka.`;
}

/** The loosest member of a campaign: its best joining link against the link threshold, i.e. how close to splitting off it hangs; null when the field is absent (one member). */
export function weakestLinkNote(c: Campaign, minLinkScore: number): string | null {
  if (c.minInternalScore === undefined || !c.weakestMember) return null;
  return `Najsłabsze ogniwo: ${c.weakestMember.id}, najlepsze powiązanie ${fmtNum(c.minInternalScore)} (próg łączenia ${fmtNum(minLinkScore)}), ${count(c.weakestMember.links, LINK)}.`;
}

/**
 * Age of a domain (RDAP) or of its first certificate against the first appearance of the ad, in whole
 * days: "domena zarejestrowana 2 dni przed emisją". A negative age means the registration is dated after the
 * ad (the domain may have been registered again). Null without data. A description, not a risk score.
 */
export function domainAgeNote(days: number | null | undefined, kind: "domain" | "cert"): string | null {
  if (days === null || days === undefined || !Number.isFinite(days)) return null;
  const subject = kind === "domain" ? "domena zarejestrowana" : "pierwszy certyfikat wystawiono";
  if (days === 0) return `${subject} w dniu emisji`;
  if (days > 0) return `${subject} ${count(days, DAY)} przed emisją`;
  return `${subject} ${count(-days, DAY)} po emisji${kind === "domain" ? " (możliwa ponowna rejestracja)" : ""}`;
}

/** Brand recognised on the creative (CLIP zero-shot): "Podrabiana marka: X (portal informacyjny), rozpoznana na kreacji (0,81)." It says whom the ad imitates; null without a brand. */
export function brandNote(b: { name: string; kind: string; probability: number } | null | undefined): string | null {
  if (!b) return null;
  return `Podrabiana marka: ${b.name} (${BRAND_KIND_LABEL[b.kind] ?? b.kind}), rozpoznana na kreacji (${fmtNum(b.probability)}).`;
}

/**
 * Short label of a link between a new material and a known one. A link marked `variant` is the creative the
 * material joined its campaign by: it must not carry the pair rule's wording ("jeden rodzaj dowodu: najwyżej
 * podobne"), which would read as contradicting the verdict "known campaign".
 */
export function linkRuleLabel(link: { rule: string; variant?: boolean }): string {
  if (link.variant) return "wariant: przypisanie po kreacji, niższa pewność";
  const labels: Record<string, string> = {
    campaign: "łączy w kampanię",
    single_kind: "jeden rodzaj dowodu: najwyżej podobne",
    account_conflict: "różne konta platformy: najwyżej podobne",
    below: "za słabe",
  };
  return labels[link.rule] ?? ruleText(link.rule, 0);
}

/** Name of a graph node's type for the interface: the creative-file node is "ten sam plik reklamy", the rest use the type's Polish name. */
export function nodeTypeLabel(node: { type: EntityType; data: Record<string, unknown> }): string {
  return exactFileLabel(node.data) ?? ENTITY_LABELS_PL[node.type];
}
