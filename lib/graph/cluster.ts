/**
 * Campaign clustering and explanations.
 *
 * 1. Union-find over STRONG pair evidence (tracker ID, wallet, same domain/URL,
 *    contact data, multi-domain certificate ...) -> components that must stay together.
 * 2. Louvain (graphology) over the weighted item graph (pairs with score >= minLinkScore)
 *    -> communities; medium evidence (near-duplicate images, similar text, NS set, IP)
 *    can merge strong components, while discounted infrastructure (shared Cloudflare
 *    IPs etc.) never even enters the clustering graph.
 * 3. Each strong component is assigned wholesale to the community holding most of it.
 *
 * Which non-strong links enter step 2 is decided by `config.campaignRules` (see `campaignLinkVerdict`):
 * corroboration by two kinds of evidence, and no joining of different accounts of one page platform.
 * 4. Families (second level): campaigns tied by the links step 2 left out (a shared kit, template or
 *    narrative under different accounts, one strong-looking similarity) form groups of similar campaigns.
 */
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { DEFAULT_LINK_CONFIG, type LinkConfig } from "./config";
import { combineScores } from "./weights";
import {
  isSimilarityEdge,
  type Campaign,
  type CampaignAttributes,
  type CampaignEvidence,
  type CampaignFamily,
  type CampaignsFile,
  type EntityType,
  type EvidenceGraph,
  type GraphEdge,
  type GraphNode,
  type ItemLink,
  type SimilarityEdgeType,
} from "./model";
import { UnionFind } from "./unionFind";

export { explain, type ExplainStep, type Explanation } from "./explain";

/** Deterministic PRNG (mulberry32) so Louvain results are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ClusterResult {
  campaigns: CampaignsFile;
  /** Copy of the graph with item nodes' campaignId filled in. */
  graph: EvidenceGraph;
}

function itemIdOf(node: GraphNode): string {
  return node.key;
}

export function clusterCampaigns(
  graph: EvidenceGraph,
  options: { config?: LinkConfig; now?: () => Date } = {},
): ClusterResult {
  const config = options.config ?? DEFAULT_LINK_CONFIG;
  const itemNodes = graph.nodes.filter((nd) => nd.type === "item");
  const itemIds = itemNodes.map(itemIdOf).sort();
  const uf = new UnionFind<string>(itemIds);
  for (const link of graph.links) if (link.strong) uf.union(link.a, link.b);

  const accountOf = new Map<string, string>();
  for (const nd of itemNodes) if (typeof nd.data.platformAccount === "string") accountOf.set(nd.key, nd.data.platformAccount);
  const verdicts = new Map<ItemLink, LinkVerdict>();
  for (const link of graph.links) verdicts.set(link, campaignLinkVerdict(link, config, accountOf));

  // Louvain over the weighted graph
  const g = new Graph({ type: "undirected", multi: false, allowSelfLoops: false });
  for (const link of graph.links) {
    if (verdicts.get(link) !== "campaign") continue;
    if (!g.hasNode(link.a)) g.addNode(link.a);
    if (!g.hasNode(link.b)) g.addNode(link.b);
    // Strong links get at least the strong threshold so Louvain respects them.
    const weight = link.strong ? Math.max(link.score, config.strongThreshold) : link.score;
    g.mergeEdge(link.a, link.b, { weight });
  }
  let community: Record<string, number> = {};
  let modularity: number | null = null;
  if (g.size > 0) {
    const detailed = louvain.detailed(g, {
      getEdgeWeight: "weight",
      resolution: config.louvain.resolution,
      rng: mulberry32(config.louvain.seed),
    });
    community = detailed.communities;
    modularity = Math.round(detailed.modularity * 1e4) / 1e4;
  }

  // Assign each strong component to its majority community.
  const groups = new Map<string, string[]>();
  for (const comp of uf.components()) {
    const counts = new Map<string, number>();
    for (const id of comp) {
      const c = id in community ? `L${community[id]}` : `S${uf.find(id)}`;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
    const list = groups.get(best) ?? [];
    list.push(...comp);
    groups.set(best, list);
  }

  const nodeById = new Map(graph.nodes.map((nd) => [nd.id, nd]));
  const edgesBySource = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    const list = edgesBySource.get(e.source) ?? [];
    list.push(e);
    edgesBySource.set(e.source, list);
  }
  const draft = [...groups.values()].map((members) => {
    members.sort();
    const set = new Set(members);
    const internal = graph.links.filter((l) => set.has(l.a) && set.has(l.b));
    const firstSeen = minDate(members.map((m) => str(nodeById.get(`item:${m}`)?.data.firstSeen)));
    const lastSeen = maxDate(
      members.map((m) => {
        const d = nodeById.get(`item:${m}`)?.data;
        return str(d?.lastSeen) ?? str(d?.firstSeen);
      }),
    );
    const strongComponents = new Set(members.map((m) => uf.find(m))).size;
    return { members, internal, firstSeen, lastSeen, strongComponents };
  });
  draft.sort(
    (x, y) =>
      y.members.length - x.members.length ||
      (x.firstSeen ?? "").localeCompare(y.firstSeen ?? "") ||
      x.members[0].localeCompare(y.members[0]),
  );

  const assignments: Record<string, string> = {};
  const campaigns: Campaign[] = draft.map((c, idx) => {
    const id = `K${String(idx + 1).padStart(2, "0")}`;
    for (const m of c.members) assignments[m] = id;
    const domains = new Set<string>();
    const advertisers = new Set<string>();
    for (const m of c.members) {
      for (const e of edgesBySource.get(`item:${m}`) ?? []) {
        if (e.type === "posted_by") advertisers.add(nodeById.get(e.target)?.label ?? "");
      }
    }
    for (const l of c.internal) {
      for (const ev of l.evidence) {
        if (ev.pivotType === "domain" && ev.pivot) domains.add(ev.pivot.slice("domain:".length));
      }
    }
    // Domains of members even when not shared (single-ad domains)
    for (const m of c.members) {
      for (const e of edgesBySource.get(`item:${m}`) ?? []) {
        if (e.type === "landing") {
          const url = nodeById.get(e.target);
          const rd = url?.data.registrableDomain;
          if (typeof rd === "string") domains.add(rd);
        }
      }
    }
    const cohesion = c.internal.length ? avg(c.internal.map((l) => l.score)) : 0;
    return {
      id,
      size: c.members.length,
      members: c.members,
      firstSeen: c.firstSeen,
      lastSeen: c.lastSeen,
      topEvidence: topEvidence(c.internal, nodeById, c.members),
      domains: [...domains].sort(),
      advertisers: [...advertisers].filter(Boolean).sort(),
      cohesion: Math.round(cohesion * 1e4) / 1e4,
      strongComponents: c.strongComponents,
      attributes: campaignAttributes(c.members, nodeById, edgesBySource),
    };
  });

  const families = buildFamilies(graph.links, verdicts, assignments, config, nodeById, accountOf);
  const familyOf = new Map<string, string>();
  for (const f of families) for (const c of f.campaigns) familyOf.set(c, f.id);
  for (const c of campaigns) c.familyId = familyOf.get(c.id) ?? null;

  const outGraph: EvidenceGraph = {
    ...graph,
    nodes: graph.nodes.map((nd) => (nd.type === "item" ? { ...nd, campaignId: assignments[nd.key] ?? null } : nd)),
  };
  return {
    graph: outGraph,
    campaigns: {
      version: 1,
      generatedAt: (options.now?.() ?? new Date()).toISOString(),
      method: {
        unionFind: `silne dowody (waga typu × lista ≥ ${config.strongThreshold})`,
        louvain: { resolution: config.louvain.resolution, seed: config.louvain.seed, modularity },
        minLinkScore: config.minLinkScore,
        rules: [
          `kampania: silny dowód albo wynik pary ≥ ${config.minLinkScore}; sama cecha zestawu stron lub persona (${config.campaignRules.notAloneKinds.join(", ")}) wymaga drugiego rodzaju dowodu albo wyniku ≥ ${config.campaignRules.singleKindMinScore}; dowody zdyskontowane się nie liczą`,
          ...(config.campaignRules.accountConflict ? ["różne konta tej samej platformy stron nie łączą się w kampanię bez silnego dowodu"] : []),
          `grupa podobnych kampanii: pozostałe powiązania między kampaniami o wyniku (bez dowodów zdyskontowanych) ≥ ${config.familyMinScore}`,
        ],
      },
      campaigns,
      families,
      assignments,
    },
  };
}

export type LinkVerdict = "campaign" | "below" | "single_kind" | "account_conflict";

/** Evidence that counts towards corroboration: not negligible, and when discounted, still weighty after the discount. */
function countedEvidence(link: ItemLink, config: LinkConfig) {
  return link.evidence.filter((e) => e.weight >= 0.02 && (!e.discounted || e.weight >= config.campaignRules.discountedMinWeight));
}

/**
 * Whether a link may join two ads into one campaign. Strong links always may. A non-strong link
 * needs the minimum score and must not join two different accounts of one page platform. Then
 * either evidence of `minEvidenceKinds` different kinds, or one kind that may stand alone, or one
 * page-kit kind (or persona) reaching `singleKindMinScore`: a reused kit alone says "similar", not "same".
 */
export function campaignLinkVerdict(link: ItemLink, config: LinkConfig, accountOf: Map<string, string> = new Map()): LinkVerdict {
  if (link.strong) return "campaign";
  if (link.score < config.minLinkScore) return "below";
  const r = config.campaignRules;
  const accA = accountOf.get(link.a);
  const accB = accountOf.get(link.b);
  if (r.accountConflict && accA && accB && accA !== accB) return "account_conflict";
  const counted = countedEvidence(link, config);
  const kinds = new Set(counted.map((e) => e.pivotType ?? e.edgeType ?? e.kind));
  if (kinds.size >= r.minEvidenceKinds) return "campaign";
  if (kinds.size !== 1) return "single_kind";
  const [kind] = kinds;
  if (!r.notAloneKinds.includes(kind)) return "campaign";
  return combineScores(counted.map((e) => e.weight)) >= r.singleKindMinScore ? "campaign" : "single_kind";
}

/** Second level: campaigns tied by links that were not allowed to merge them. */
function buildFamilies(
  links: ItemLink[],
  verdicts: Map<ItemLink, LinkVerdict>,
  assignments: Record<string, string>,
  config: LinkConfig,
  nodeById: Map<string, GraphNode>,
  accountOf: Map<string, string>,
): CampaignFamily[] {
  const campaignIds = [...new Set(Object.values(assignments))].sort();
  const uf = new UnionFind<string>(campaignIds);
  const cross: ItemLink[] = [];
  for (const link of links) {
    const ca = assignments[link.a];
    const cb = assignments[link.b];
    if (!ca || !cb || ca === cb) continue;
    const score = combineScores(countedEvidence(link, config).map((e) => e.weight));
    if (score < config.familyMinScore) continue;
    cross.push(link);
    uf.union(ca, cb);
  }
  const groups = uf.components().filter((c) => c.length > 1);
  const families = groups.map((camps) => {
    const set = new Set(camps);
    const members = Object.keys(assignments).filter((m) => set.has(assignments[m])).sort();
    const own = cross.filter((l) => set.has(assignments[l.a]));
    const apart = new Set<string>();
    for (const l of own) {
      const v = verdicts.get(l);
      if (v === "account_conflict") apart.add(`różne konta na platformie stron (${accountOf.get(l.a)?.slice(0, 8)}…, ${accountOf.get(l.b)?.slice(0, 8)}…)`);
      else if (v === "single_kind") apart.add("łączy je tylko jeden rodzaj dowodu");
    }
    return { camps: camps.sort(), members, own, apart: [...apart].sort() };
  });
  families.sort((x, y) => y.members.length - x.members.length || x.camps[0].localeCompare(y.camps[0]));
  return families.map((f, idx) => ({
    id: `R${String(idx + 1).padStart(2, "0")}`,
    campaigns: f.camps,
    members: f.members,
    size: f.members.length,
    topEvidence: topEvidence(f.own, nodeById, f.members),
    apart: f.apart,
  }));
}

function topEvidence(internal: ItemLink[], nodeById: Map<string, GraphNode>, members: string[]): CampaignEvidence[] {
  const pivotHolders = new Map<string, Set<string>>();
  const pivotWeight = new Map<string, number>();
  const simPairs = new Map<SimilarityEdgeType, { count: number; weight: number }>();
  for (const l of internal) {
    for (const ev of l.evidence) {
      if (ev.kind === "pivot" && ev.pivot) {
        const set = pivotHolders.get(ev.pivot) ?? new Set<string>();
        set.add(l.a);
        set.add(l.b);
        pivotHolders.set(ev.pivot, set);
        pivotWeight.set(ev.pivot, Math.max(pivotWeight.get(ev.pivot) ?? 0, ev.weight));
      } else if (ev.edgeType && isSimilarityEdge(ev.edgeType)) {
        const cur = simPairs.get(ev.edgeType) ?? { count: 0, weight: 0 };
        cur.count++;
        cur.weight = Math.max(cur.weight, ev.weight);
        simPairs.set(ev.edgeType, cur);
      }
    }
  }
  const out: CampaignEvidence[] = [];
  for (const [pivot, holders] of pivotHolders) {
    const node = nodeById.get(pivot);
    if (!node) continue;
    // An apex host duplicates its registrable domain: keep the domain only.
    if (node.type === "host" && pivotHolders.get(`domain:${node.key}`)?.size === holders.size) continue;
    out.push({ key: pivot, type: node.type, label: node.label, count: holders.size, weight: pivotWeight.get(pivot) ?? 0 });
  }
  for (const [type, v] of simPairs) out.push({ key: type, type, label: SIMILARITY_LABELS[type], count: v.count, weight: v.weight });
  const size = Math.max(1, members.length);
  return out
    .sort((x, y) => scoreOf(y, size) - scoreOf(x, size) || x.label.localeCompare(y.label))
    .slice(0, 6);
}

const SIMILARITY_LABELS: Record<SimilarityEdgeType, string> = {
  similar_image: "prawie identyczne kreacje (dHash)",
  similar_image_semantic: "ten sam szablon kreacji (CLIP)",
  similar_text: "podobna treść reklam",
  similar_dom: "ta sama struktura strony (simhash DOM)",
  similar_audio: "ta sama ścieżka dźwiękowa (Chromaprint)",
  similar_voice: "ten sam głos mówcy (SpeechBrain)",
};

function scoreOf(e: CampaignEvidence, size: number): number {
  const coverage = isSimilarityEdge(e.type) ? Math.min(1, e.count / size) : e.count / size;
  return coverage * e.weight;
}

function campaignAttributes(members: string[], nodeById: Map<string, GraphNode>, edgesBySource: Map<string, GraphEdge[]>): CampaignAttributes {
  const personaCount = new Map<string, { id: string; name: string; count: number }>();
  let cyrillic = 0;
  let cloakingSuspected = 0;
  let deepfakeScoreMax: number | null = null;
  for (const m of members) {
    const data = nodeById.get(`item:${m}`)?.data ?? {};
    if (data.cyrillic === true) cyrillic++;
    if (data.cloakingSuspected === true) cloakingSuspected++;
    if (typeof data.deepfakeScore === "number") deepfakeScoreMax = Math.max(deepfakeScoreMax ?? 0, data.deepfakeScore);
    const seen = new Set<string>();
    for (const e of edgesBySource.get(`item:${m}`) ?? []) {
      if (e.type !== "mentions_persona" || seen.has(e.target)) continue;
      seen.add(e.target);
      const node = nodeById.get(e.target);
      if (!node) continue;
      const cur = personaCount.get(node.key) ?? { id: node.key, name: node.label, count: 0 };
      cur.count++;
      personaCount.set(node.key, cur);
    }
  }
  const personas = [...personaCount.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { personas, cyrillic, cloakingSuspected, deepfakeScoreMax };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function minDate(values: Array<string | null>): string | null {
  const v = values.filter((x): x is string => !!x).sort();
  return v[0] ?? null;
}

function maxDate(values: Array<string | null>): string | null {
  const v = values.filter((x): x is string => !!x).sort();
  return v[v.length - 1] ?? null;
}

function avg(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Entity types that can appear in campaign evidence (for UI legends). */
export type EvidenceKind = EntityType | SimilarityEdgeType;
