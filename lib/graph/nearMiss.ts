/**
 * Near misses (I20): pairs of ads that look alike but that the campaign rules deliberately keep apart,
 * with the rule that held them back. A record of decisions already made by `campaignLinkDecision` and the
 * clustering: nothing here changes which ads form a campaign or a group. Pure (no files, no network).
 */
import type { LinkDecision } from "./cluster";
import { DEFAULT_LINK_CONFIG, type LinkConfig } from "./config";
import type { CampaignFamily, GraphNode, ItemLink, NearMiss, NearMissDiscount, NearMissesFile, NearMissRule, PairEvidence } from "./model";

export interface NearMissInput {
  /** Every link of the graph, before pruning for output. */
  links: ItemLink[];
  /** Decision of each link (campaignLinkDecision). */
  decisions: Map<ItemLink, LinkDecision>;
  /** Campaign of each ad (item id -> campaign id). */
  assignments: Record<string, string>;
  families: CampaignFamily[];
  /** Graph nodes: item nodes (their `case`) and pivot nodes (their discounts). */
  nodes: GraphNode[];
  config: LinkConfig;
  generatedAt: string;
  /** Rule kind of a piece of evidence (`evidenceKind` of cluster.ts). */
  kindOf: (e: PairEvidence) => string;
}

/** Number with a decimal comma and two places, as the sentences of the report print scores. */
function pl(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

/**
 * Sentence in Polish for a refusal: what held the pair back and what trace was missing, so a reviewer sees
 * at once whether the method guarded against a false link or the threshold is just close. `kinds` are the
 * rule kinds of the shared traces, `discounted` the kinds of the traces a discount weakened.
 */
function refusalReason(rule: NearMissRule, o: { score: number; kinds: string[]; discounted: string[]; config: LinkConfig }): string {
  const r = o.config.campaignRules;
  switch (rule) {
    case "below-min-score":
      return `wynik pary ${pl(o.score)} jest poniżej progu połączenia ${pl(o.config.minLinkScore)}`;
    case "family-only-kind": {
      const only = o.kinds.filter((k) => (r.familyOnlyKinds ?? []).includes(k));
      return `wynik pary pochodzi ze śladów, które łączą kampanie tylko w grupę podobnych (${only.join(", ")}); bez nich wynik jest poniżej progu ${pl(o.config.minLinkScore)}`;
    }
    case "account-conflict":
      return "reklamy stoją na różnych kontach tej samej platformy stron; wspólny ślad nie wystarcza, bo platforma udostępnia go wielu kontom";
    case "discounted-only":
      return `jedyne wspólne ślady to infrastruktura używana przez wiele stron (${o.discounted.join(", ") || o.kinds.join(", ")}); po obniżeniu wagi nie wystarczają, brak śladu operatora`;
    case "kit-only":
      return "łączy je tylko zestaw stron (szablon, motyw, komentarze, struktura), który kupuje i kopiuje wielu operatorów; brak śladu operatora (domena, tracker, konto, portfel, kontakt)";
    case "content-only-with-infra":
      return "łączy je tylko treść (podobny tekst albo obraz), a któraś reklama ma własną infrastrukturę; sama treść nie łączy, brak wspólnego śladu infrastruktury";
    case "too-few-content-kinds":
      return `łączy je jeden rodzaj treści; bez infrastruktury kampania wymaga co najmniej ${r.minContentKinds ?? 2} różnych rodzajów treści`;
    case "too-few-evidence-kinds":
      return `łączy je za mało rodzajów dowodów (potrzeba ${r.minEvidenceKinds})`;
    case "split-by-clustering":
      return "reguły pozwalają połączyć te reklamy, ale podział na kampanie rozdzielił je między różne kampanie";
  }
}

/** Discounts of the pivots behind the discounted evidence of a link, one entry per kind and discount rule. */
function discountsOf(link: ItemLink, nodeById: Map<string, GraphNode>, kindOf: NearMissInput["kindOf"]): NearMissDiscount[] {
  const out = new Map<string, NearMissDiscount>();
  for (const e of link.evidence) {
    if (!e.discounted || !e.pivot) continue;
    for (const d of nodeById.get(e.pivot)?.discounts ?? []) {
      const kind = kindOf(e);
      out.set(`${kind}|${d.rule}`, { kind, rule: d.rule, factor: d.factor });
    }
  }
  return [...out.values()];
}

/**
 * Lists the near misses: links whose ads are not in one campaign and that are close to it. A pair is
 * listed when (a) its score is at least `nearMiss.minScoreRatio` x `minLinkScore`, (b) it shares a trace of
 * a strong type (type weight at least `strongThreshold`) that a discount weakened, or (c) its ads are in
 * different campaigns of one family. Ads of one case (the same folder) are never paired: their
 * similarity is not a finding. Sorted by score, highest first, and cut at `nearMiss.maxPairs`; `total`
 * and `byRule` count every pair that qualified. Returns the file written as `near-misses.json`.
 */
export function findNearMisses(input: NearMissInput): NearMissesFile {
  const { links, decisions, assignments, families, nodes, config, kindOf } = input;
  const opt = config.nearMiss ?? DEFAULT_LINK_CONFIG.nearMiss!;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const familyOf = new Map<string, string>();
  for (const f of families) for (const c of f.campaigns) familyOf.set(c, f.id);
  const caseOf = (id: string) => nodeById.get(`item:${id}`)?.data.case;
  const found: NearMiss[] = [];
  for (const link of links) {
    const campaignA = assignments[link.a] ?? null;
    const campaignB = assignments[link.b] ?? null;
    if (campaignA !== null && campaignA === campaignB) continue;
    const ownCase = caseOf(link.a);
    if (typeof ownCase === "string" && ownCase === caseOf(link.b)) continue;
    const decision = decisions.get(link);
    const rule = decision?.rule ?? (decision?.verdict === "campaign" ? "split-by-clustering" : null);
    if (!rule) continue;
    const familyA = campaignA ? familyOf.get(campaignA) : undefined;
    const familyId = familyA && campaignB && familyA === familyOf.get(campaignB) ? familyA : null;
    const discounted = discountsOf(link, nodeById, kindOf);
    const selectedBy: NearMiss["selectedBy"] = [];
    if (link.score >= opt.minScoreRatio * config.minLinkScore) selectedBy.push("score");
    if (link.evidence.some((e) => e.discounted && e.pivotType && (config.typeWeights[e.pivotType] ?? 0) >= config.strongThreshold)) selectedBy.push("discounted-strong");
    if (familyId) selectedBy.push("family");
    if (!selectedBy.length) continue;
    const sharedKinds = [...new Set(link.evidence.map(kindOf))].sort();
    found.push({
      a: link.a,
      b: link.b,
      score: link.score,
      rule,
      reason: refusalReason(rule, { score: link.score, kinds: sharedKinds, discounted: [...new Set(discounted.map((d) => d.kind))], config }),
      sharedKinds,
      discounted,
      selectedBy,
      campaignA,
      campaignB,
      familyId,
    });
  }
  found.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  const byRule: NearMissesFile["byRule"] = {};
  for (const p of found) byRule[p.rule] = (byRule[p.rule] ?? 0) + 1;
  return {
    version: 1,
    generatedAt: input.generatedAt,
    minLinkScore: config.minLinkScore,
    minScoreRatio: opt.minScoreRatio,
    maxPairs: opt.maxPairs,
    total: found.length,
    byRule,
    pairs: found.slice(0, Math.max(0, opt.maxPairs)),
  };
}

/** A known campaign that a new record came close to without joining it (`MaterialItemResult.nearMisses`). */
export interface MaterialNearMiss {
  /** Campaign of the existing run. */
  campaign: string;
  /** The record of that campaign the pair is with. */
  other: string;
  score: number;
  rule: NearMissRule;
  reason: string;
  sharedKinds: string[];
}

/**
 * Near misses of one new record against the campaigns of the existing run: for each known campaign the
 * strongest pair of the record with one of its ads, strongest first. Leaves out the campaign the record
 * joined (`known`) and pairs with other new records (`isNew`). `oldCampaignOf` gives the campaign of a
 * record in the existing run (null for none). `file` should hold every near miss, not a cut list
 * (set `nearMiss.maxPairs` high for this call), or the record's pairs may be missing.
 */
export function nearMissesOfMaterial(
  file: NearMissesFile,
  id: string,
  o: { known: string | null; oldCampaignOf: (itemId: string) => string | null; isNew: (itemId: string) => boolean },
): MaterialNearMiss[] {
  const best = new Map<string, MaterialNearMiss>();
  for (const p of file.pairs) {
    if (p.a !== id && p.b !== id) continue;
    const other = p.a === id ? p.b : p.a;
    if (o.isNew(other)) continue;
    const campaign = o.oldCampaignOf(other);
    if (!campaign || campaign === o.known) continue;
    if ((best.get(campaign)?.score ?? -1) >= p.score) continue;
    best.set(campaign, { campaign, other, score: p.score, rule: p.rule, reason: p.reason, sharedKinds: p.sharedKinds });
  }
  return [...best.values()].sort((x, y) => y.score - x.score || x.campaign.localeCompare(y.campaign));
}
