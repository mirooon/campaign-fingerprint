/**
 * Campaign clustering and explanations.
 *
 * 1. Union-find over STRONG pair evidence (tracker ID, wallet, same domain/URL,
 *    contact data, multi-domain certificate ...) -> components that must stay together.
 * 2. Louvain (graphology) over the weighted item graph (pairs with score >= minLinkScore)
 *    -> communities; medium evidence (near-duplicate images, similar text, NS set, IP)
 *    can merge strong components, while discounted infrastructure (shared Cloudflare
 *    IPs etc.) never even enters the clustering graph.
 * 3. Each strong component is assigned wholesale to the community holding most of it, and every community
 *    is split into its connected parts (`splitDisconnected`: Louvain can return a disconnected community).
 *    A campaign without infrastructure then joins the only campaign whose creatives its own nearly
 *    repeat (`attachContentVariants`): a variant attaches, it never merges two campaigns.
 *
 * Which non-strong links enter step 2 is decided by `config.campaignRules` (see `campaignLinkVerdict`):
 * corroboration by two kinds of evidence, and no joining of different accounts of one page platform.
 * 4. Families (second level): campaigns tied by the links step 2 left out (a shared kit, template or
 *    narrative under different accounts, one strong-looking similarity) form groups of similar campaigns.
 */
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { DEFAULT_LINK_CONFIG, type LinkConfig } from "./config";
import { weekdayCounts, type AdStart } from "../text/adStart";
import { summarizeNarratives, type MaterialNarrative } from "../text/narrative";
import { findNearMisses } from "./nearMiss";
import { combineScores } from "./weights";
import { isAdvertiserAccountKey } from "./adLibraryTraces";
import {
  CREATIVE_FILE_PREFIX,
  isSimilarityEdge,
  type Campaign,
  type CampaignAttributes,
  type CampaignEvidence,
  type CampaignFamily,
  type CampaignsFile,
  type ContentVariant,
  type EntityType,
  type EvidenceGraph,
  type GraphEdge,
  type GraphNode,
  type ItemLink,
  type NearMissRule,
  type NearMissesFile,
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
  /** Pairs kept out of one campaign that come close to it, with the rule that decided (I20); a record, it changes no campaign. */
  nearMisses: NearMissesFile;
}

function itemIdOf(node: GraphNode): string {
  return node.key;
}

/**
 * Groups the ads of an evidence graph into campaigns (steps in the header of this file) and campaigns into
 * groups of similar campaigns. Returns the campaigns file (with the method's rules spelled out) and a copy
 * of the graph with `campaignId` on item nodes. Deterministic except the `generatedAt` stamp (`now`).
 */
export function clusterCampaigns(
  graph: EvidenceGraph,
  options: { config?: LinkConfig; now?: () => Date } = {},
): ClusterResult {
  const config = options.config ?? DEFAULT_LINK_CONFIG;
  const itemNodes = graph.nodes.filter((nd) => nd.type === "item");
  const itemIds = itemNodes.map(itemIdOf).sort();
  const { accountOf, infraItems } = verdictContext(graph.nodes);
  const decisions = new Map<ItemLink, LinkDecision>();
  const verdicts = new Map<ItemLink, LinkVerdict>();
  for (const link of graph.links) {
    const decision = campaignLinkDecision(link, config, accountOf, infraItems);
    decisions.set(link, decision);
    verdicts.set(link, decision.verdict);
  }
  const uf = new UnionFind<string>(itemIds);
  // a strong link held back by an account conflict (campaignRules.accountConflictOverStrongKinds) must not merge either
  for (const link of graph.links) if (link.strong && verdicts.get(link) === "campaign") uf.union(link.a, link.b);

  // Louvain over the weighted graph
  const g = new Graph({ type: "undirected", multi: false, allowSelfLoops: false });
  for (const link of graph.links) {
    if (verdicts.get(link) !== "campaign") continue;
    if (!g.hasNode(link.a)) g.addNode(link.a);
    if (!g.hasNode(link.b)) g.addNode(link.b);
    // Strong links get at least the strong threshold so Louvain respects them.
    const score = campaignScore(link, config);
    const weight = link.strong ? Math.max(score, config.strongThreshold) : score;
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
  // Louvain may return a community of parts with no joining link between them: each part is its own campaign
  const connected = splitDisconnected([...groups.values()], graph.links.filter((l) => verdicts.get(l) === "campaign"));
  const attached = attachContentVariants(connected, graph.links, verdicts, config, infraItems);
  const variantLinks = new Set([...attached.variants.values()].map((v) => v.link));

  const nodeById = new Map(graph.nodes.map((nd) => [nd.id, nd]));
  const edgesBySource = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    const list = edgesBySource.get(e.source) ?? [];
    list.push(e);
    edgesBySource.set(e.source, list);
  }
  const joiningOf = (internal: ItemLink[]) => internal.filter((l) => verdicts.get(l) === "campaign" || variantLinks.has(l));
  const draft = attached.groups.map((members) => {
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
      attributes: { ...campaignAttributes(c.members, nodeById, edgesBySource), basis: campaignBasis(c.members, c.internal, verdicts, config, infraItems, variantLinks) },
      ...variantsOf(c.members, attached.variants),
      ...weakestLink(c.members, joiningOf(c.internal)),
      ...bridgeOf(c.members, joiningOf(c.internal), config, nodeById),
    };
  });

  const families = buildFamilies(graph.links, verdicts, assignments, config, nodeById, accountOf);
  const familyOf = new Map<string, string>();
  for (const f of families) for (const c of f.campaigns) familyOf.set(c, f.id);
  for (const c of campaigns) c.familyId = familyOf.get(c.id) ?? null;

  const generatedAt = (options.now?.() ?? new Date()).toISOString();
  const nearMisses = findNearMisses({ links: graph.links, decisions, assignments, families, nodes: graph.nodes, config, generatedAt, kindOf: evidenceKind });

  const outGraph: EvidenceGraph = {
    ...graph,
    nodes: graph.nodes.map((nd) => (nd.type === "item" ? { ...nd, campaignId: assignments[nd.key] ?? null } : nd)),
  };
  return {
    graph: outGraph,
    nearMisses,
    campaigns: {
      version: 1,
      generatedAt,
      method: {
        unionFind: `silne dowody (waga typu × lista ≥ ${config.strongThreshold})`,
        louvain: { resolution: config.louvain.resolution, seed: config.louvain.seed, modularity },
        minLinkScore: config.minLinkScore,
        rules: [
          `kampania: silny dowód albo wynik pary ≥ ${config.minLinkScore}; cechy zestawu stron i płatnik z biblioteki reklam (${config.campaignRules.notAloneKinds.join(", ")}) liczą się razem jako jeden rodzaj i nie łączą same, między sobą ani z treścią: potrzebny jest co najmniej jeden rodzaj dowodu spoza zestawu stron i treści; dowody zdyskontowane się nie liczą`,
          `treść (${(config.campaignRules.contentKinds ?? []).join(", ")}): bez infrastruktury po obu stronach kampanię tworzą co najmniej ${config.campaignRules.minContentKinds ?? 2} różne rodzaje treści; gdy którakolwiek reklama ma infrastrukturę, treść jest jednym rodzajem dowodu i sama nie łączy; ten sam plik kreacji (SHA-256 albo klatki CLIP ≥ ${config.campaignRules.sameCreative?.clipMinCosine ?? 0.97} z tym samym dźwiękiem) łączy sam`,
          ...(config.campaignRules.contentVariant
            ? [`wariant kreacji: kampania bez infrastruktury, łączona tylko treścią, dołącza do jedynej kampanii z infrastrukturą, której kreacje prawie powtarza (ten sam dHash albo plik, dHash w odległości ≤ ${config.campaignRules.contentVariant.imageHamming}, CLIP ≥ ${config.campaignRules.contentVariant.clipMinCosine}); kreacja bliska kilku kampaniom nie dołącza nigdzie, wariant nie scala kampanii, sam tekst nie dołącza`]
            : []),
          ...((config.campaignRules.familyOnlyKinds ?? []).length ? [`tylko grupa podobnych kampanii: ${(config.campaignRules.familyOnlyKinds ?? []).join(", ")}`] : []),
          ...(config.campaignRules.accountConflict
            ? [
                `różne konta tej samej platformy stron nie łączą się w kampanię bez silnego dowodu${(config.campaignRules.accountConflictOverStrongKinds ?? []).length ? `; silny dowód samego rodzaju ${(config.campaignRules.accountConflictOverStrongKinds ?? []).join(", ")} też nie wystarcza` : ""}`,
              ]
            : []),
          `grupa podobnych kampanii: pozostałe powiązania między kampaniami o wyniku (bez dowodów zdyskontowanych) ≥ ${config.familyMinScore}`,
        ],
      },
      campaigns,
      families,
      assignments,
    },
  };
}

/**
 * Connected parts of each group (B-121): a group whose members fall apart into parts with no joining link
 * between them becomes one group per part. Louvain optimises modularity and can return such a community
 * (Leiden, which guarantees connected communities, is GPL-licensed in its reference implementation).
 * Takes groups of item ids and the joining links; links leaving a group are ignored. Parts keep their
 * members sorted, in the order of their first member.
 */
export function splitDisconnected(groups: string[][], joining: ItemLink[]): string[][] {
  const out: string[][] = [];
  for (const members of groups) {
    if (members.length < 2) {
      out.push([...members]);
      continue;
    }
    const set = new Set(members);
    const uf = new UnionFind<string>(members);
    for (const l of joining) if (set.has(l.a) && set.has(l.b)) uf.union(l.a, l.b);
    out.push(...uf.components().map((p) => [...p].sort()).sort((x, y) => x[0].localeCompare(y[0])));
  }
  return out;
}

export type LinkVerdict = "campaign" | "below" | "single_kind" | "account_conflict";

/**
 * Rule kind of a piece of evidence: the pivot type, the similarity edge type, "creative_sha256" for the same
 * creative file, "scam_brand" for the scam's own brand, "tracker_host" for a host of the page's requests,
 * "adsense_publisher" for an AdSense publisher ID, "affiliate_team" for the team+user pair of an affiliate network (B-330) or "advertiser_name" for an advertiser known only by its
 * display name (no library account ID): ad accounts are stolen and resold, so the name alone does not
 * merge campaigns (I23).
 */
export function evidenceKind(e: ItemLink["evidence"][number]): string {
  if (e.pivot?.startsWith(`imagehash:${CREATIVE_FILE_PREFIX}`)) return "creative_sha256";
  if (e.pivotType === "advertiser" && e.pivot && !isAdvertiserAccountKey(e.pivot.slice("advertiser:".length))) return "advertiser_name";
  if (e.pivot?.startsWith("campaign_param:scam_brand=")) return "scam_brand";
  if (e.pivot?.startsWith("endpoint:tracker_host:")) return "tracker_host";
  if (e.pivot?.startsWith("tracker:adsense:")) return "adsense_publisher";
  if (e.pivot?.startsWith("affiliate_account:team:")) return "affiliate_team";
  return e.pivotType ?? e.edgeType ?? e.kind;
}

/**
 * Per-item context of the campaign rules, read from the item nodes: the platform account (with its
 * namespace: "tenant:" for a landing-cdn tenant not mapped to an owner_uuid) and the items that have
 * infrastructure (`data.infrastructure`, filled by buildEvidenceGraph).
 */
export function verdictContext(nodes: GraphNode[]): { accountOf: Map<string, string>; infraItems: Set<string> } {
  const accountOf = new Map<string, string>();
  const infraItems = new Set<string>();
  for (const nd of nodes) {
    if (nd.type !== "item") continue;
    if (typeof nd.data.platformAccount === "string") accountOf.set(nd.key, nd.data.platformAccountSource === "tenant" ? `tenant:${nd.data.platformAccount}` : nd.data.platformAccount);
    if (Array.isArray(nd.data.infrastructure) && nd.data.infrastructure.length) infraItems.add(nd.key);
  }
  return { accountOf, infraItems };
}

/** Two accounts of the same namespace (owner_uuid, or unmapped landing-cdn tenant) that differ. */
function accountsConflict(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const ns = (x: string) => (x.startsWith("tenant:") ? "tenant" : "owner");
  return ns(a) === ns(b) && a !== b;
}

const shortAccount = (a: string | undefined) => (a ? a.replace(/^tenant:/, "").slice(0, 8) : "?");

/** Evidence of a kind that only counts for groups of similar campaigns (e.g. page techniques). */
function familyOnly(e: ItemLink["evidence"][number], config: LinkConfig): boolean {
  const kinds = config.campaignRules.familyOnlyKinds ?? [];
  return kinds.length > 0 && kinds.includes(evidenceKind(e));
}

/** The same creative file: identical SHA-256, or video frames with CLIP cosine >= clipMinCosine plus the same audio. */
function sameCreative(evidence: ItemLink["evidence"], config: LinkConfig): boolean {
  if (evidence.some((e) => evidenceKind(e) === "creative_sha256")) return true;
  const clipMin = config.campaignRules.sameCreative?.clipMinCosine ?? 0.97;
  const frames = evidence.some((e) => e.edgeType === "similar_image_semantic" && (e.similarity ?? 0) >= clipMin);
  return frames && evidence.some((e) => e.edgeType === "similar_audio");
}

/** Score of a link for the campaign level: without the family-only evidence. */
export function campaignScore(link: ItemLink, config: LinkConfig): number {
  if (!link.evidence.some((e) => familyOnly(e, config))) return link.score;
  return combineScores(link.evidence.filter((e) => !familyOnly(e, config)).map((e) => e.weight));
}

/** Evidence that counts towards corroboration: not negligible, and when discounted, still weighty after the discount. */
function countedEvidence(link: ItemLink, config: LinkConfig) {
  return link.evidence.filter((e) => e.weight >= 0.02 && (!e.discounted || e.weight >= config.campaignRules.discountedMinWeight));
}

/**
 * Whether a link may join two ads into one campaign. Strong links may, unless two different accounts of
 * one page platform meet and all the strong evidence is of a kind in `accountConflictOverStrongKinds`
 * (a UUID in resource paths can name a lander of a library shared by many accounts). A non-strong link
 * needs the minimum score and must not join two different accounts of one page platform (this wins
 * over any content). The same creative file then joins alone. Page-kit traces (`notAloneKinds`: a page
 * template, a shop theme, a cloned portal) are bought and reused by many operators, so they count
 * together as one kind and never join on their own, with each other or with content: a campaign needs at
 * least one kind of evidence outside the kit and the content. Without one, content follows its own rule:
 * between two ads without infrastructure it needs `minContentKinds` different content kinds; when either
 * ad has infrastructure it never joins alone. With one, `minEvidenceKinds` different kinds (all content
 * then one kind "content", all kit traces one kind "page_kit") or that one kind alone.
 * `infraItems` lists the items that have infrastructure; when it is not given, every item counts as
 * having it (the stricter reading for content).
 */
export function campaignLinkVerdict(
  link: ItemLink,
  config: LinkConfig,
  accountOf: Map<string, string> = new Map(),
  infraItems: Set<string> | null = null,
): LinkVerdict {
  return campaignLinkDecision(link, config, accountOf, infraItems).verdict;
}

/** Refusal rules of `campaignLinkDecision`: the near-miss rules that the pair rules themselves can give. */
type RefusalRule = Exclude<NearMissRule, "split-by-clustering">;

/** Verdict of a link and, for a refused one, the id of the rule that refused it (null for a campaign link). */
export interface LinkDecision {
  verdict: LinkVerdict;
  rule: RefusalRule | null;
}

/**
 * The decision behind `campaignLinkVerdict`: the same verdict plus the rule that refused the link
 * (`NearMissRule`), so a pair kept out of a campaign can say why. Takes and reads exactly what
 * `campaignLinkVerdict` does; the rules are described there.
 */
export function campaignLinkDecision(
  link: ItemLink,
  config: LinkConfig,
  accountOf: Map<string, string> = new Map(),
  infraItems: Set<string> | null = null,
): LinkDecision {
  const r = config.campaignRules;
  const conflict = r.accountConflict && accountsConflict(accountOf.get(link.a), accountOf.get(link.b));
  if (link.strong) {
    const overStrong = r.accountConflictOverStrongKinds ?? [];
    const strongKinds = link.evidence.filter((e) => e.strong).map(evidenceKind);
    const yields = strongKinds.length > 0 && strongKinds.every((k) => overStrong.includes(k));
    return conflict && yields ? { verdict: "account_conflict", rule: "account-conflict" } : { verdict: "campaign", rule: null };
  }
  if (campaignScore(link, config) < config.minLinkScore) {
    // the score alone would have passed: only the evidence that counts for groups lifted it
    return { verdict: "below", rule: link.score >= config.minLinkScore ? "family-only-kind" : "below-min-score" };
  }
  if (conflict) return { verdict: "account_conflict", rule: "account-conflict" };
  const counted = countedEvidence(link, config).filter((e) => !familyOnly(e, config));
  if (sameCreative(counted, config)) return { verdict: "campaign", rule: null };
  const contentKinds = new Set(r.contentKinds ?? []);
  const kinds = [...new Set(counted.map(evidenceKind))];
  const content = kinds.filter((k) => contentKinds.has(k));
  const kit = kinds.filter((k) => !contentKinds.has(k) && r.notAloneKinds.includes(k));
  const operator = kinds.filter((k) => !contentKinds.has(k) && !r.notAloneKinds.includes(k));
  const withInfra = infraItems === null || infraItems.has(link.a) || infraItems.has(link.b);
  if (!operator.length) {
    // nothing counted: every trace is weaker than discountedMinWeight after its discount
    if (!counted.length) return { verdict: "single_kind", rule: "discounted-only" };
    if (!content.length) return { verdict: "single_kind", rule: "kit-only" };
    const need = withInfra ? (r.contentKindsWithInfrastructure ?? null) : (r.minContentKinds ?? 2);
    if (need !== null && need > 0 && content.length >= need) return { verdict: "campaign", rule: null };
    return { verdict: "single_kind", rule: withInfra ? "content-only-with-infra" : "too-few-content-kinds" };
  }
  const effective = [...operator, ...(kit.length ? ["page_kit"] : []), ...(withInfra && content.length ? ["content"] : content)];
  if (effective.length === 1 || effective.length >= r.minEvidenceKinds) return { verdict: "campaign", rule: null };
  return { verdict: "single_kind", rule: "too-few-evidence-kinds" };
}

/** Whether all counted evidence of a link is content (similar copy, picture, recording, the same creative file). */
function contentOnly(link: ItemLink, config: LinkConfig): boolean {
  const contentKinds = new Set([...(config.campaignRules.contentKinds ?? []), "creative_sha256"]);
  const counted = countedEvidence(link, config).filter((e) => !familyOnly(e, config));
  return counted.length > 0 && counted.every((e) => contentKinds.has(evidenceKind(e)));
}

/**
 * What a campaign stands on (CampaignAttributes.basis). `variantLinks` are the links that attached
 * content variants (attachContentVariants): they count as joining links, so a campaign with an
 * attached variant is "mixed".
 */
function campaignBasis(
  members: string[],
  internal: ItemLink[],
  verdicts: Map<ItemLink, LinkVerdict>,
  config: LinkConfig,
  infraItems: Set<string>,
  variantLinks: Set<ItemLink>,
): "content" | "infrastructure" | "mixed" {
  if (members.length === 1) return infraItems.has(members[0]) ? "infrastructure" : "content";
  const joining = internal.filter((l) => verdicts.get(l) === "campaign" || variantLinks.has(l));
  const byContent = joining.filter((l) => contentOnly(l, config)).length;
  if (joining.length && byContent === joining.length) return "content";
  return byContent === 0 ? "infrastructure" : "mixed";
}

/** A member attached as a variant of a creative: the link that attached it, the other end, and the premise. */
interface VariantAttachment {
  link: ItemLink;
  like: string;
  evidence: ItemLink["evidence"][number];
}

/**
 * The premise that makes a link "the same creative, nearly": the same dHash or file, a similar picture
 * within `imageHamming` bits (similar_image stores 1 - bits/64), or CLIP cosine >= `clipMinCosine`;
 * the heaviest one, or null. Only the creative counts: similar copy never does, because text templates
 * travel between operators. Discounted evidence counts as in the campaign rules.
 */
function variantEvidence(link: ItemLink, config: LinkConfig, rule: { imageHamming: number; clipMinCosine: number }): ItemLink["evidence"][number] | null {
  const near = countedEvidence(link, config).filter((e) => {
    const kind = evidenceKind(e);
    if (kind === "imagehash" || kind === "creative_sha256") return true;
    if (e.similarity === undefined) return false;
    if (e.edgeType === "similar_image") return Math.round((1 - e.similarity) * 64) <= rule.imageHamming;
    return e.edgeType === "similar_image_semantic" && e.similarity >= rule.clipMinCosine;
  });
  return near.sort((x, y) => y.weight - x.weight)[0] ?? null;
}

/**
 * Content variants (campaignRules.contentVariant), a step after the campaigns are built. A group with
 * no infrastructure, joined by content only (usually one screenshot), has nothing that could
 * contradict an assignment: it moves into the only group with infrastructure that its variant links
 * reach. Why it attaches and never merges: targets are read from the groups before any move and a
 * group without infrastructure is never a target, so variants cannot chain; a creative near the
 * creatives of two campaigns attaches nowhere (creative templates travel between operators, so content
 * must not decide between campaigns, and the campaigns stay apart). A group with infrastructure keeps
 * the pair rules (a variant on its own domain joins through shared infrastructure, not content), and a
 * platform-account conflict still wins. Takes the groups (member ids) and returns them after the moves,
 * with the variant link of each moved member (its own nearest, else the group's nearest).
 */
function attachContentVariants(
  groups: string[][],
  links: ItemLink[],
  verdicts: Map<ItemLink, LinkVerdict>,
  config: LinkConfig,
  infraItems: Set<string>,
): { groups: string[][]; variants: Map<string, VariantAttachment> } {
  const variants = new Map<string, VariantAttachment>();
  const rule = config.campaignRules.contentVariant;
  if (!rule) return { groups, variants };
  const groupOf = new Map<string, number>();
  groups.forEach((members, idx) => members.forEach((m) => groupOf.set(m, idx)));
  const hasInfra = groups.map((members) => members.some((m) => infraItems.has(m)));
  const notContent = new Set<number>();
  const outgoing = new Map<number, VariantAttachment[]>();
  for (const link of links) {
    const ga = groupOf.get(link.a);
    const gb = groupOf.get(link.b);
    if (ga === undefined || gb === undefined) continue;
    if (ga === gb) {
      if (verdicts.get(link) === "campaign" && !contentOnly(link, config)) notContent.add(ga);
      continue;
    }
    if (verdicts.get(link) === "account_conflict") continue;
    const evidence = variantEvidence(link, config, rule);
    if (!evidence) continue;
    for (const [from, to, like] of [[ga, gb, link.b], [gb, ga, link.a]] as const) {
      if (hasInfra[from] || !hasInfra[to]) continue;
      outgoing.set(from, [...(outgoing.get(from) ?? []), { link, like, evidence }]);
    }
  }
  const out = groups.map((members) => [...members]);
  for (const [from, found] of outgoing) {
    if (notContent.has(from)) continue;
    const targets = new Set(found.map((v) => groupOf.get(v.like)!));
    if (targets.size !== 1) continue;
    const [to] = targets;
    const byWeight = [...found].sort((x, y) => y.evidence.weight - x.evidence.weight || x.like.localeCompare(y.like));
    for (const m of groups[from]) variants.set(m, byWeight.find((v) => v.link.a === m || v.link.b === m) ?? byWeight[0]);
    out[to].push(...groups[from]);
    out[from] = [];
  }
  return { groups: out.filter((members) => members.length > 0), variants };
}

/**
 * Weakest link of a campaign: for every member its best joining link score, then the lowest of these
 * (`minInternalScore`) with that member and its number of joining links. Nothing for a campaign without
 * joining links (one member).
 */
function weakestLink(members: string[], joining: ItemLink[]): Pick<Campaign, "minInternalScore" | "weakestMember"> {
  let weakest: { id: string; score: number; links: number } | null = null;
  for (const m of members) {
    const own = joining.filter((l) => l.a === m || l.b === m);
    if (!own.length) continue;
    const score = Math.max(...own.map((l) => l.score));
    if (!weakest || score < weakest.score) weakest = { id: m, score, links: own.length };
  }
  return weakest ? { minInternalScore: weakest.score, weakestMember: weakest } : {};
}

/**
 * Bridge of a campaign (B-123): the first strong pivot (by key) whose removal from the joining links splits
 * the members into parts of at least `bridgeMinPartSize` each. A link still holds a part together when it
 * has counted evidence other than that pivot. Such a campaign stands on one trace: if the trace is a shared
 * service or a mistake, the parts are separate campaigns, so it is shown as a candidate for lists.pivots.
 */
function bridgeOf(members: string[], joining: ItemLink[], config: LinkConfig, nodeById: Map<string, GraphNode>): Pick<Campaign, "bridge"> {
  const minPart = config.bridgeMinPartSize ?? 2;
  if (members.length < 2 * minPart) return {};
  const candidates = [...new Set(joining.flatMap((l) => l.evidence.filter((e) => e.strong && e.pivot).map((e) => e.pivot!)))].sort();
  for (const pivot of candidates) {
    const uf = new UnionFind<string>(members);
    for (const l of joining) {
      if (countedEvidence(l, config).some((e) => e.pivot !== pivot && !familyOnly(e, config))) uf.union(l.a, l.b);
    }
    const parts = uf.components().map((p) => [...p].sort()).sort((x, y) => x[0].localeCompare(y[0]));
    if (parts.length < 2 || parts.some((p) => p.length < minPart)) continue;
    const node = nodeById.get(pivot);
    if (!node) continue;
    return { bridge: { pivot, type: node.type, label: node.label, parts } };
  }
  return {};
}

/** `Campaign.variants` of a campaign: its members attached as variants, or nothing when there are none. */
function variantsOf(members: string[], variants: Map<string, VariantAttachment>): { variants?: ContentVariant[] } {
  const list = members
    .filter((m) => variants.has(m))
    .map((m) => {
      const v = variants.get(m)!;
      return { id: m, like: v.like, evidence: v.evidence.evidence, weight: v.evidence.weight };
    });
  return list.length ? { variants: list } : {};
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
      if (v === "account_conflict") apart.add(`różne konta na platformie stron (${shortAccount(accountOf.get(l.a))}…, ${shortAccount(accountOf.get(l.b))}…)`);
      else if (v === "single_kind") apart.add(contentOnly(l, config) ? "łączy je tylko treść" : "łączy je tylko jeden rodzaj dowodu");
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
    ...familyTraits(f.members, nodeById),
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

/**
 * Attributes of a campaign read from its members' item nodes and persona edges: personas with counts,
 * Cyrillic and cloaking counts, the highest deepfake score, the summary of narratives, the creative brands,
 * the page platforms and the number of ads taken down by the platform. Descriptions for the card, never evidence.
 */
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
  const narrative = summarizeNarratives(members.map((m) => nodeById.get(`item:${m}`)?.data.narrative as MaterialNarrative | undefined));
  const brands = creativeBrands(members, nodeById);
  const platformCount = new Map<string, number>();
  for (const m of members) for (const p of (nodeById.get(`item:${m}`)?.data.pagePlatforms as string[] | undefined) ?? []) platformCount.set(p, (platformCount.get(p) ?? 0) + 1);
  const platforms = [...platformCount.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  const takenDownCount = members.filter((m) => nodeById.get(`item:${m}`)?.data.adTakenDown === true).length;
  const starts = members.map((m) => nodeById.get(`item:${m}`)?.data.adStartWeekday as AdStart | undefined).filter((s): s is AdStart => !!s);
  return { personas, cyrillic, cloakingSuspected, deepfakeScoreMax, ...(narrative ? { narrative } : {}), ...(brands.length ? { brands } : {}), ...(platforms.length ? { platforms } : {}), ...(takenDownCount ? { takenDownCount } : {}), ...(starts.length ? { adStartWeekdays: weekdayCounts(starts) } : {}) };
}

/** Brands recognised on the creatives of the members (item `creativeBrand`), with member counts, most frequent first. */
function creativeBrands(members: string[], nodeById: Map<string, GraphNode>): Array<{ id: string; name: string; count: number }> {
  const byId = new Map<string, { id: string; name: string; count: number }>();
  for (const m of members) {
    const b = nodeById.get(`item:${m}`)?.data.creativeBrand as { id: string; name: string } | undefined;
    if (!b) continue;
    const cur = byId.get(b.id) ?? { id: b.id, name: b.name, count: 0 };
    cur.count++;
    byId.set(b.id, cur);
  }
  return [...byId.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

/**
 * Traits of a group of similar campaigns read from its members' item nodes: the summary of their narratives
 * and the groups of the impersonated persons ("Dziennikarze": members naming such a person). Empty fields
 * are left out. Attributes only: they never decide membership.
 */
function familyTraits(members: string[], nodeById: Map<string, GraphNode>): Pick<CampaignFamily, "narrative" | "personaCategories" | "brands"> {
  const narrative = summarizeNarratives(members.map((m) => nodeById.get(`item:${m}`)?.data.narrative as MaterialNarrative | undefined));
  const byCategory = new Map<string, number>();
  for (const m of members) {
    const cats = (nodeById.get(`item:${m}`)?.data.personaCategories as Array<{ category: string }> | undefined) ?? [];
    for (const c of new Set(cats.map((x) => x.category))) byCategory.set(c, (byCategory.get(c) ?? 0) + 1);
  }
  const personaCategories = [...byCategory.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  const brands = creativeBrands(members, nodeById);
  return { ...(narrative ? { narrative } : {}), ...(personaCategories.length ? { personaCategories } : {}), ...(brands.length ? { brands } : {}) };
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
