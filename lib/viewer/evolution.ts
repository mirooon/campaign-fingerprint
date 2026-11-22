/**
 * Campaign card logic (§8.2, B-036): "evolution" of a campaign material by material (what changed against
 * the earlier ones and what stayed), the timeline of domain registrations, certificates and ad appearances,
 * and the matrix of shared traits. Pure functions over `graph.json` (nodes and directed edges); the backend's
 * `Campaign.evolution` is an aggregate per type, this one answers per material.
 */
import type { EntityType, EvidenceGraph, GraphNode } from "@/lib/graph/model";
import { NARRATIVE_TOPIC_LABEL, domainAgeNote } from "./fields";

type Graph = Pick<EvidenceGraph, "nodes" | "edges">;

/** A kind of trait the evolution view follows: its name in the interface and the graph node types it covers (none: read from the item itself). */
interface TraitKind {
  label: string;
  types: EntityType[];
}

/** Kinds of traits in the order the sentence lists them: what an operator rotates (domain, person, narrative, creative) first, then what it tends to keep. */
export const TRAIT_KINDS: TraitKind[] = [
  { label: "domena", types: ["domain"] },
  { label: "osoba", types: ["persona"] },
  { label: "narracja", types: [] },
  { label: "kreacja", types: ["imagehash"] },
  { label: "reklamodawca", types: ["advertiser"] },
  { label: "tracker", types: ["tracker"] },
  { label: "konto platformy", types: ["platform_account", "path_id"] },
  { label: "serwer", types: ["endpoint", "click_server", "ip"] },
];

/** Edge that points at somebody else's site (an outbound link), so it says nothing about the campaign's own traits. */
const OUTBOUND_EDGE = "links_to";

/** Node types left out of the shared-trait matrix: addresses of single pages and network numbers are too fine or too coarse to read as "a trace". */
export const MATRIX_SKIP_TYPES = new Set<EntityType>(["item", "url", "host", "asn"]);

/** Columns of the shared-trait matrix shown by default. */
export const MATRIX_MAX_COLUMNS = 12;

export interface TraitChange {
  kind: string;
  /** Values this material brings that no earlier material of the campaign had. */
  added: string[];
}

export interface EvolutionRow {
  id: string;
  /** First appearance of the material (ISO), null when unknown. */
  date: string | null;
  /** The first material of the campaign: there is nothing to compare it with. */
  first: boolean;
  changed: TraitChange[];
  /** Kinds of traits whose values were all seen on earlier materials. */
  kept: string[];
}

/** Directed adjacency of the graph without outbound links. */
export function adjacency(graph: Graph): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.type === OUTBOUND_EDGE) continue;
    const list = out.get(e.source);
    if (list) list.push(e.target);
    else out.set(e.source, [e.target]);
  }
  return out;
}

/** Ids of the nodes reachable from an item node along its own edges (item → page → host → domain …), the item itself excluded. */
export function reachable(itemId: string, out: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [itemId];
  while (stack.length) {
    for (const next of out.get(stack.pop()!) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return seen;
}

/** Main narrative topic of an item node in words of the interface; null without a narrative. */
function narrativeTopic(item: GraphNode | undefined): string | null {
  const topics = (item?.data.narrative as { topics?: Array<{ id: string }> } | undefined)?.topics;
  const id = topics?.[0]?.id;
  return id ? (NARRATIVE_TOPIC_LABEL[id] ?? id) : null;
}

/** Date of a node's field (ISO) or null. */
function dateOf(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** Members of a campaign in order of first appearance, those without a date last (ties keep the campaign's order). */
function byDate(members: string[], nodes: Map<string, GraphNode>): string[] {
  const date = (id: string) => dateOf(nodes.get(`item:${id}`)?.data.firstSeen);
  return members
    .map((id, i) => ({ id, i, d: date(id) }))
    .sort((a, b) => (a.d ?? "￿").localeCompare(b.d ?? "￿") || a.i - b.i)
    .map((x) => x.id);
}

/**
 * Per material of a campaign: what changed against ALL earlier materials (a value never seen before) and
 * what stayed (every value seen before). Values are compared per kind of trait (`TRAIT_KINDS`); a kind the
 * material does not have is left out of both lists. The first material is the start of the campaign.
 */
export function evolutionRows(campaign: { members: string[] }, graph: Graph): EvolutionRow[] {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = adjacency(graph);
  const seen = new Map<string, Set<string>>(TRAIT_KINDS.map((k) => [k.label, new Set<string>()]));
  return byDate(campaign.members, nodes).map((id, index) => {
    const itemNode = nodes.get(`item:${id}`);
    const reach = reachable(`item:${id}`, out);
    const changed: TraitChange[] = [];
    const kept: string[] = [];
    for (const kind of TRAIT_KINDS) {
      const values = new Map<string, string>();
      for (const nid of reach) {
        const n = nodes.get(nid);
        if (n && kind.types.includes(n.type)) values.set(n.id, n.label);
      }
      const topic = kind.label === "narracja" ? narrativeTopic(itemNode) : null;
      if (topic) values.set(`narrative:${topic}`, topic);
      if (!values.size) continue;
      const before = seen.get(kind.label)!;
      const added = [...values].filter(([key]) => !before.has(key)).map(([, label]) => label);
      if (index > 0) {
        if (added.length) changed.push({ kind: kind.label, added });
        else kept.push(kind.label);
      }
      for (const key of values.keys()) before.add(key);
    }
    return { id, date: dateOf(itemNode?.data.firstSeen), first: index === 0, changed, kept };
  });
}

/** One sentence of a row: "zmieniło się: domena, osoba; zostało: tracker", "bez zmian; zostało: …" or "początek kampanii". */
export function evolutionSentence(row: EvolutionRow): string {
  if (row.first) return "początek kampanii";
  const changed = row.changed.length ? `zmieniło się: ${row.changed.map((c) => c.kind).join(", ")}` : "bez zmian";
  return row.kept.length ? `${changed}; zostało: ${row.kept.join(", ")}` : changed;
}

export interface TimelineEvent {
  date: string;
  kind: "registered" | "cert" | "ad";
  text: string;
}

/** Order of events that share a moment: a registration or a certificate comes before the ad it served. */
const KIND_ORDER: Record<TimelineEvent["kind"], number> = { registered: 0, cert: 1, ad: 2 };

/**
 * Timeline of a campaign: the first appearance of each ad, the registration of each domain of the
 * campaign (with how many days before its first ad it happened: "domena ożyła przed reklamą") and the
 * certificates of those domains. Events without a date are left out. Sorted by time.
 */
export function campaignTimeline(campaign: { members: string[] }, graph: Graph): TimelineEvent[] {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = adjacency(graph);
  const events: TimelineEvent[] = [];
  const domains = new Set<string>();
  const firstAdOnDomain = new Map<string, string>();
  const certs = new Map<string, GraphNode>();
  for (const id of campaign.members) {
    const date = dateOf(nodes.get(`item:${id}`)?.data.firstSeen);
    if (date) events.push({ date, kind: "ad", text: `pierwsza reklama: materiał ${id}` });
    for (const nid of reachable(`item:${id}`, out)) {
      const n = nodes.get(nid);
      if (n?.type !== "domain") continue;
      domains.add(nid);
      if (date && (firstAdOnDomain.get(nid) ?? "￿") > date) firstAdOnDomain.set(nid, date);
    }
  }
  for (const nid of domains) {
    const domain = nodes.get(nid)!;
    const firstAd = firstAdOnDomain.get(nid);
    const created = dateOf(domain.data.created);
    if (created) {
      const days = firstAd ? Math.floor((Date.parse(firstAd) - Date.parse(created)) / 86_400_000) : null;
      const age = domainAgeNote(days, "domain");
      events.push({ date: created, kind: "registered", text: `${domain.label}: ${age ?? "zarejestrowana"}` });
    }
    for (const cid of out.get(nid) ?? []) {
      const cert = nodes.get(cid);
      if (cert?.type === "cert") certs.set(cid, cert);
    }
  }
  for (const cert of certs.values()) {
    const date = dateOf(cert.data.notBefore);
    if (date) events.push({ date, kind: "cert", text: `certyfikat ${typeof cert.data.issuer === "string" ? cert.data.issuer : ""}`.trim() });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

export interface MatrixColumn {
  id: string;
  type: EntityType;
  label: string;
  weight: number | null;
  strong: boolean;
  /** The backend discounted the trace (shared by many unrelated sites): it does not point at an operator. */
  skipped: boolean;
  /** Materials of the campaign that have the trace. */
  count: number;
}

export interface MatrixRow {
  id: string;
  /** For each column, whether the material has the trace. */
  has: boolean[];
}

export interface TraitMatrix {
  columns: MatrixColumn[];
  rows: MatrixRow[];
  /** Shared traces left out because of the column limit. */
  hidden: number;
}

/**
 * Materials × shared traces of a campaign: columns are the traces held by at least two materials, strongest
 * first (strong, then by weight, then by number of materials); `maxColumns` keeps the matrix readable and
 * `hidden` says how many were cut. It is the main evidence of "why one campaign": a column filled across
 * many rows is a trace they share.
 */
export function traitMatrix(campaign: { members: string[] }, graph: Graph, maxColumns = MATRIX_MAX_COLUMNS): TraitMatrix {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = adjacency(graph);
  const members = byDate(campaign.members, nodes);
  const held = new Map(members.map((id) => [id, reachable(`item:${id}`, out)]));
  const holders = new Map<string, number>();
  for (const set of held.values()) for (const nid of set) holders.set(nid, (holders.get(nid) ?? 0) + 1);
  const all: MatrixColumn[] = [];
  for (const [nid, count] of holders) {
    const n = nodes.get(nid);
    if (!n || count < 2 || MATRIX_SKIP_TYPES.has(n.type)) continue;
    all.push({ id: nid, type: n.type, label: n.label, weight: n.weight, strong: n.strong, skipped: n.discounts.length > 0, count });
  }
  all.sort((a, b) => Number(b.strong) - Number(a.strong) || (b.weight ?? 0) - (a.weight ?? 0) || b.count - a.count || a.label.localeCompare(b.label));
  const columns = all.slice(0, maxColumns);
  return { columns, hidden: all.length - columns.length, rows: members.map((id) => ({ id, has: columns.map((c) => held.get(id)!.has(c.id)) })) };
}
