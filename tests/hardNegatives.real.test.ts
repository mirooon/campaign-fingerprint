/**
 * Hard negatives from real material (task I21): pairs of ads from different operations that look alike
 * (the same person in the ad, the same theme, similar copy or picture without shared infrastructure, a
 * discounted shared trace such as a CDN, page builder or registrar, look-alike domains, empty pages).
 * The fixture keeps only the structure of each measured pair: which trace types the two ads share, with
 * what weight, discount, strength and similarity, and whether each ad has infrastructure or sits on a
 * page-platform account. Every value is replaced (a pair is "tNNN", accounts "konto-NN", identical
 * premises are merged with a count), so the file carries nothing from the case files.
 * "real" pairs come from labelled material with a basis for "different operations"; "derived" pairs take
 * a real case and swap one layer (other backend and account, other content and tracker). Measured merges
 * that no configuration change could fix without breaking a labelled campaign are `it.fails`; they are
 * listed with the proposed rule changes in the hard-negatives report (data/twarde-negatywy/NEGATYWY.md,
 * outside the repository) and summarised in docs/METODYKA.md.
 */
import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "../lib/graph/cluster";
import type { EntityType, EdgeType, EvidenceGraph, GraphNode, ItemLink, PairEvidence } from "../lib/graph/model";
import { combineScores } from "../lib/graph/weights";
import fixture from "./fixtures/hard-negatives-real.json";

interface FixtureAd {
  account: string | null;
  accountSource: string | null;
  infrastructure: string[];
}

interface FixtureEvidence {
  kind: "pivot" | "similarity";
  type: string;
  weight: number;
  strong: boolean;
  discounted: boolean;
  similarity?: number;
  /** How many identical premises (e.g. template sentences of the same weight) the pair shares. */
  count: number;
}

interface FixturePair {
  id: string;
  source: "real" | "derived";
  categories: string[];
  /** Result in the full measured graph: merged (error), family (one group of similar campaigns) or apart. */
  measured: "merged" | "family" | "apart";
  /** The pair's own link reaches a group; false when the full graph groups it only through other ads. */
  familyDirect: boolean;
  a: FixtureAd;
  b: FixtureAd;
  strong: boolean;
  evidence: FixtureEvidence[];
}

const pairs = fixture.pairs as FixturePair[];

/** Item node of one ad of a pair, with the fields the campaign rules read (account, infrastructure). */
function itemNode(id: string, ad: FixtureAd): GraphNode {
  const data: Record<string, unknown> = { infrastructure: ad.infrastructure };
  if (ad.account) {
    data.platformAccount = ad.account;
    data.platformAccountSource = ad.accountSource;
  }
  return { id: `item:${id}`, type: "item", key: id, label: id, df: 1, weight: null, strong: false, discounts: [], data, campaignId: null };
}

/**
 * Two-ad evidence graph of a fixture pair: both item nodes, one synthetic pivot node per shared trace
 * (merged premises expanded by their count) and the link with the recorded premises; the score is
 * recombined from the weights as build-graph does.
 */
function pairGraph(p: FixturePair): EvidenceGraph {
  const a = `${p.id}-a`;
  const b = `${p.id}-b`;
  const expanded = p.evidence.flatMap((e) => Array.from({ length: e.count }, () => e));
  const evidence: PairEvidence[] = expanded.map((e, n) => ({
    kind: e.kind,
    pivot: e.kind === "pivot" ? `${e.type}:${p.id}-${n}` : null,
    pivotType: e.kind === "pivot" ? (e.type as EntityType) : null,
    edgeType: e.kind === "similarity" ? (e.type as EdgeType) : null,
    weight: e.weight,
    strong: e.strong,
    discounted: e.discounted,
    evidence: "ślad syntetyczny",
    ...(e.similarity === undefined ? {} : { similarity: e.similarity }),
    pathA: [],
    pathB: [],
  }));
  const pivots: GraphNode[] = evidence
    .filter((e): e is PairEvidence & { pivot: string; pivotType: EntityType } => e.pivot !== null && e.pivotType !== null)
    .map((e) => ({ id: e.pivot, type: e.pivotType, key: e.pivot, label: e.pivot, df: 2, weight: e.weight, strong: e.strong, discounts: [], data: {}, campaignId: null }));
  const link: ItemLink = { a, b, score: combineScores(evidence.map((e) => e.weight)), strong: p.strong, evidence };
  return {
    version: 1,
    generatedAt: "2026-11-22T00:00:00.000Z",
    mode: "offline",
    baseDir: ".",
    textMethod: "tfidf",
    stats: { items: 2, nodes: 2 + pivots.length, edges: 0, links: 1, strongLinks: p.strong ? 1 : 0, byType: {} },
    nodes: [itemNode(a, p.a), itemNode(b, p.b), ...pivots],
    edges: [],
    links: [link],
  };
}

/** Campaign of each ad and the group of similar campaigns of each campaign (null outside a group). */
function outcome(p: FixturePair): { campaignA: string; campaignB: string; familyA: string | null; familyB: string | null } {
  const { campaigns } = clusterCampaigns(pairGraph(p), { now: () => new Date("2026-11-22T00:00:00.000Z") });
  const familyOf = (c: string) => (campaigns.families ?? []).find((f) => f.campaigns.includes(c))?.id ?? null;
  const campaignA = campaigns.assignments[`${p.id}-a`];
  const campaignB = campaigns.assignments[`${p.id}-b`];
  return { campaignA, campaignB, familyA: familyOf(campaignA), familyB: familyOf(campaignB) };
}

const label = (p: FixturePair) => `${p.id} (${p.source}; ${p.categories.join(", ")})`;

describe("hard negatives from real material: different operations never share a campaign", () => {
  it("the fixture covers every bait category with real pairs and carries no case values", () => {
    const real = pairs.filter((p) => p.source === "real");
    for (const category of ["persona", "motyw", "podobna_tresc", "slad_zdyskontowany", "domena", "pusta_strona"]) {
      expect(real.filter((p) => p.categories.includes(category)).length, category).toBeGreaterThanOrEqual(3);
    }
    const accounts = pairs.flatMap((p) => [p.a.account, p.b.account]).filter((x): x is string => x !== null);
    expect(accounts.every((x) => /^konto-\d{2}$/.test(x))).toBe(true);
    expect(pairs.every((p) => p.evidence.every((e) => Object.keys(e).every((k) => ["kind", "type", "weight", "strong", "discounted", "similarity", "count"].includes(k))))).toBe(true);
  });

  for (const p of pairs.filter((x) => x.measured !== "merged")) {
    it(`${label(p)}: two campaigns`, () => {
      const r = outcome(p);
      expect(r.campaignA).not.toBe(r.campaignB);
    });
  }

  for (const p of pairs.filter((x) => x.measured === "family" && x.familyDirect)) {
    it(`${label(p)}: one group of similar campaigns`, () => {
      const r = outcome(p);
      expect(r.familyA).not.toBeNull();
      expect(r.familyA).toBe(r.familyB);
    });
  }

  // Known merges of derived pairs (NEGATYWY.md, "Błędy i proponowane poprawki"): kept visible until a rule change passes.
  for (const p of pairs.filter((x) => x.measured === "merged")) {
    it.fails(`${label(p)}: two campaigns (known merge)`, () => {
      const r = outcome(p);
      expect(r.campaignA).not.toBe(r.campaignB);
    });
  }
});
