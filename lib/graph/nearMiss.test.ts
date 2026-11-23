/**
 * Near misses (I20): pairs that look alike but that the campaign rules deliberately keep apart, with the
 * rule that held them back. Part 1 checks the rule id of each refusal (campaignLinkDecision) on hand-built
 * links, part 2 the choice of pairs for the report (findNearMisses), part 3 the whole run: the report is
 * only a record, the campaigns and groups must stay the same.
 * Synthetic data only: fictional accounts, .example/.test domains.
 */
import { describe, expect, it } from "vitest";
import type { AssetRef } from "../osint/pagekit";
import { campaignLinkDecision, campaignLinkVerdict, clusterCampaigns, evidenceKind } from "./cluster";
import { DEFAULT_LINK_CONFIG, mergeConfig } from "./config";
import { buildEvidenceGraph } from "./link";
import type { CampaignFamily, GraphNode, ItemLink, PairEvidence } from "./model";
import { findNearMisses, nearMissesOfMaterial } from "./nearMiss";
import { makeDataset } from "./testkit";
import { combineScores } from "./weights";

const evidence = (over: Partial<PairEvidence>): PairEvidence => ({
  kind: "pivot",
  pivot: null,
  pivotType: null,
  edgeType: null,
  weight: 0.3,
  strong: false,
  discounted: false,
  evidence: "ślad",
  pathA: [],
  pathB: [],
  ...over,
});
/** A pivot trace of the given type (weight 0.3 unless stated). */
const pivot = (type: NonNullable<PairEvidence["pivotType"]>, weight = 0.3, over: Partial<PairEvidence> = {}) => evidence({ pivotType: type, pivot: `${type}:x`, weight, ...over });
/** A similarity trace of the given edge type. */
const similar = (edge: NonNullable<PairEvidence["edgeType"]>, weight = 0.5) => evidence({ kind: "similarity", edgeType: edge, weight });
const linkOf = (a: string, b: string, ev: PairEvidence[], strong = false): ItemLink => ({ a, b, score: combineScores(ev.map((e) => e.weight)), strong, evidence: ev });
const config = DEFAULT_LINK_CONFIG;

describe("campaignLinkDecision: the rule of each refusal", () => {
  it("a campaign link has no refusal rule", () => {
    const d = campaignLinkDecision(linkOf("a", "b", [pivot("ip", 0.6), pivot("nameserver", 0.5)]), config);
    expect(d).toEqual({ verdict: "campaign", rule: null });
  });

  it("below-min-score: the score does not reach minLinkScore", () => {
    const d = campaignLinkDecision(linkOf("a", "b", [similar("similar_text", 0.1)]), config);
    expect(d).toEqual({ verdict: "below", rule: "below-min-score" });
  });

  it("family-only-kind: a person in the ad lifts the score, but that kind counts for groups only", () => {
    const l = linkOf("a", "b", [pivot("persona", 0.35)]);
    expect(l.score).toBeGreaterThanOrEqual(config.minLinkScore);
    expect(campaignLinkDecision(l, config)).toEqual({ verdict: "below", rule: "family-only-kind" });
  });

  it("account-conflict: two accounts of one page platform are not joined by a non-strong link", () => {
    const l = linkOf("a", "b", [pivot("ip", 0.6), pivot("nameserver", 0.5)]);
    const accounts = new Map([["a", "11111111-aaaa"], ["b", "22222222-bbbb"]]);
    expect(campaignLinkDecision(l, config, accounts)).toEqual({ verdict: "account_conflict", rule: "account-conflict" });
  });

  it("account-conflict: a strong path ID yields to the conflict, other strong evidence does not", () => {
    const accounts = new Map([["a", "11111111-aaaa"], ["b", "22222222-bbbb"]]);
    const pathId = linkOf("a", "b", [pivot("path_id", 0.85, { strong: true })], true);
    expect(campaignLinkDecision(pathId, config, accounts).rule).toBe("account-conflict");
    const wallet = linkOf("a", "b", [pivot("wallet", 1, { strong: true })], true);
    expect(campaignLinkDecision(wallet, config, accounts)).toEqual({ verdict: "campaign", rule: null });
  });

  it("kit-only: traces of a page kit, even several, never join on their own", () => {
    const d = campaignLinkDecision(linkOf("a", "b", [pivot("asset", 0.55), pivot("hidden_fields", 0.6)]), config);
    expect(d).toEqual({ verdict: "single_kind", rule: "kit-only" });
  });

  it("content-only-with-infra: copy and picture do not join when one ad has infrastructure", () => {
    const l = linkOf("a", "b", [similar("similar_text", 0.5), similar("similar_image", 0.6)]);
    expect(campaignLinkDecision(l, config, new Map(), new Set(["a"]))).toEqual({ verdict: "single_kind", rule: "content-only-with-infra" });
  });

  it("too-few-content-kinds: between ads without infrastructure one kind of content is not enough", () => {
    const d = campaignLinkDecision(linkOf("a", "b", [similar("similar_text", 0.5)]), config, new Map(), new Set());
    expect(d).toEqual({ verdict: "single_kind", rule: "too-few-content-kinds" });
  });

  it("discounted-only: the only trace is shared infrastructure that the discount weakened", () => {
    const d = campaignLinkDecision(linkOf("a", "b", [pivot("domain", 0.2, { discounted: true })]), config);
    expect(d).toEqual({ verdict: "single_kind", rule: "discounted-only" });
  });

  it("too-few-evidence-kinds: operator evidence below the required number of kinds", () => {
    const strict = mergeConfig({ campaignRules: { minEvidenceKinds: 3 } });
    const d = campaignLinkDecision(linkOf("a", "b", [pivot("ip", 0.6), pivot("nameserver", 0.5)]), strict);
    expect(d).toEqual({ verdict: "single_kind", rule: "too-few-evidence-kinds" });
  });

  it("campaignLinkVerdict stays the verdict of the decision", () => {
    const links = [
      linkOf("a", "b", [similar("similar_text", 0.1)]),
      linkOf("a", "b", [pivot("asset", 0.55), pivot("hidden_fields", 0.6)]),
      linkOf("a", "b", [pivot("ip", 0.6), pivot("nameserver", 0.5)]),
      linkOf("a", "b", [pivot("wallet", 1, { strong: true })], true),
    ];
    for (const l of links) expect(campaignLinkVerdict(l, config)).toBe(campaignLinkDecision(l, config).verdict);
  });
});

const item = (key: string, caseName?: string): GraphNode => ({
  id: `item:${key}`,
  type: "item",
  key,
  label: key,
  df: 1,
  weight: null,
  strong: false,
  discounts: [],
  data: caseName ? { case: caseName } : {},
  campaignId: null,
});
const family = (id: string, campaigns: string[]): CampaignFamily => ({ id, campaigns, members: [], size: campaigns.length, topEvidence: [], apart: [] });
const FILE_STAMP = "2026-01-01T00:00:00.000Z";

/** Runs findNearMisses on hand-built links; the decisions are taken from the campaign rules. */
function near(
  links: ItemLink[],
  o: { assignments?: Record<string, string>; families?: CampaignFamily[]; nodes?: GraphNode[]; config?: typeof config } = {},
) {
  const cfg = o.config ?? config;
  const decisions = new Map(links.map((l) => [l, campaignLinkDecision(l, cfg, new Map(), new Set())]));
  const nodes = o.nodes ?? [...new Set(links.flatMap((l) => [l.a, l.b]))].map((k) => item(k));
  return findNearMisses({ links, decisions, assignments: o.assignments ?? {}, families: o.families ?? [], nodes, config: cfg, generatedAt: FILE_STAMP, kindOf: evidenceKind });
}

describe("findNearMisses: which pairs are listed", () => {
  it("lists a pair at half of minLinkScore or more, leaves out a weaker one", () => {
    const half = config.minLinkScore * (config.nearMiss?.minScoreRatio ?? 0.5);
    const file = near([linkOf("a", "b", [similar("similar_text", half + 0.01)]), linkOf("c", "d", [similar("similar_text", half - 0.02)])]);
    expect(file.pairs.map((p) => [p.a, p.b])).toEqual([["a", "b"]]);
    expect(file.pairs[0].rule).toBe("below-min-score");
    expect(file.pairs[0].selectedBy).toEqual(["score"]);
  });

  it("leaves out pairs in one campaign and pairs from one case", () => {
    const links = [linkOf("a", "b", [similar("similar_text", 0.1)]), linkOf("c", "d", [similar("similar_text", 0.1)])];
    const nodes = [item("a"), item("b"), item("c", "sprawa-1"), item("d", "sprawa-1")];
    const file = near(links, { nodes, assignments: { a: "K01", b: "K01", c: "K02", d: "K03" } });
    expect(file.pairs).toEqual([]);
  });

  it("lists a pair with a strong-type trace that was discounted, whatever its score", () => {
    const e = pivot("domain", 0.01, { discounted: true, pivot: "domain:cdn.example" });
    const l = linkOf("a", "b", [e]);
    const cdn = { ...item("cdn"), id: "domain:cdn.example", type: "domain" as const, key: "cdn.example", discounts: [{ reason: "wspólny CDN, korzystają z niego różni operatorzy", factor: 0.02, rule: "domains:cdn.example" }] };
    const file = near([l], { nodes: [item("a"), item("b"), cdn] });
    expect(file.pairs).toHaveLength(1);
    expect(file.pairs[0].selectedBy).toEqual(["discounted-strong"]);
    expect(file.pairs[0].discounted).toEqual([{ kind: "domain", rule: "domains:cdn.example", factor: 0.02 }]);
    expect(file.pairs[0].sharedKinds).toEqual(["domain"]);
  });

  it("lists a pair in one family but two campaigns, whatever its score", () => {
    const l = linkOf("a", "b", [similar("similar_text", 0.01)]);
    const file = near([l], { assignments: { a: "K01", b: "K02" }, families: [family("F1", ["K01", "K02"])] });
    expect(file.pairs).toHaveLength(1);
    expect(file.pairs[0]).toMatchObject({ selectedBy: ["family"], familyId: "F1", campaignA: "K01", campaignB: "K02" });
  });

  it("split-by-clustering: the rules allowed the link, the clustering still put the ads in different campaigns", () => {
    const l = linkOf("a", "b", [pivot("ip", 0.6), pivot("nameserver", 0.5)]);
    const file = near([l], { assignments: { a: "K01", b: "K02" } });
    expect(file.pairs[0].rule).toBe("split-by-clustering");
  });

  it("sorts by score descending, cuts at maxPairs and counts the rest in total and byRule", () => {
    const cfg = mergeConfig({ nearMiss: { minScoreRatio: 0.5, maxPairs: 2 } });
    const links = [0.09, 0.12, 0.1, 0.11].map((w, i) => linkOf(`a${i}`, `b${i}`, [similar("similar_text", w)]));
    const file = near(links, { config: cfg });
    expect(file.pairs.map((p) => p.a)).toEqual(["a1", "a3"]);
    expect(file.total).toBe(4);
    expect(file.byRule).toEqual({ "below-min-score": 4 });
    expect(file).toMatchObject({ version: 1, generatedAt: FILE_STAMP, minLinkScore: config.minLinkScore, maxPairs: 2 });
  });

  it("every pair has a reason that names the rule's cause", () => {
    const file = near([linkOf("a", "b", [pivot("asset", 0.55), pivot("hidden_fields", 0.6)])]);
    expect(file.pairs[0].rule).toBe("kit-only");
    expect(file.pairs[0].reason).toMatch(/page kit/i);
  });
});

describe("nearMissesOfMaterial: known campaigns a new record came close to", () => {
  const oldCampaign: Record<string, string> = { o1: "K01", o2: "K01", o3: "K02", o4: "K03" };
  const pairs = () =>
    near(
      [
        linkOf("new", "o1", [similar("similar_text", 0.12)]),
        linkOf("new", "o2", [pivot("asset", 0.55), pivot("hidden_fields", 0.6)]),
        linkOf("new", "o3", [similar("similar_text", 0.1)]),
        linkOf("new", "o4", [similar("similar_text", 0.11)]),
        linkOf("new", "x", [similar("similar_text", 0.11)]),
        linkOf("o3", "o4", [similar("similar_text", 0.11)]),
      ],
      { assignments: {} },
    );
  const of = (known: string | null) => nearMissesOfMaterial(pairs(), "new", { known, oldCampaignOf: (id) => oldCampaign[id] ?? null, isNew: (id) => id === "new" || id === "x" });

  it("gives one entry per known campaign, the strongest pair first, with rule and reason", () => {
    const out = of(null);
    expect(out.map((n) => n.campaign)).toEqual(["K01", "K03", "K02"]);
    expect(out[0]).toMatchObject({ campaign: "K01", other: "o2", rule: "kit-only" });
    expect(out[0].reason).toMatch(/page kit/i);
    expect(out[1]).toMatchObject({ campaign: "K03", rule: "below-min-score" });
  });

  it("leaves out the campaign the record joined, other new records and pairs between old records", () => {
    const out = of("K01");
    expect(out.map((n) => n.campaign)).toEqual(["K03", "K02"]);
    expect(out.every((n) => n.other !== "x" && n.other !== "new")).toBe(true);
  });
});

/** Same-origin asset of a page, as extractPageKit records it. */
const asset = (pageUrl: string, path: string): AssetRef => {
  const host = new URL(pageUrl).hostname;
  return { key: path, url: `https://${host}${path}`, host, path, basename: path.split("/").pop()!, kind: path.endsWith(".css") ? "css" : "js", sameOrigin: true };
};

describe("the report does not change the decisions", () => {
  const shop = (id: string, url: string, email: string) => ({
    id,
    url,
    emails: [email],
    kit: {
      assets: [asset(url, "/assets/motyw-zielony.7f3a9c.js"), asset(url, "/assets/motyw-zielony.7f3a9c.css")],
      hiddenFields: ["cart_token", "theme_section", "variant_pick"],
      comments: ["motyw zielony: sekcja koszyka", "motyw zielony: karta produktu"],
    },
  });
  const specs = () => [shop("a", "https://sklep-alfa.example/", "kontakt@sklep-alfa.example"), shop("b", "https://sklep-beta.test/", "biuro@sklep-beta.test"), { id: "c", url: "https://trzeci.example/", emails: ["x@trzeci.example"] }];
  const graph = () => buildEvidenceGraph(makeDataset(specs(), {}), { textMethod: "tfidf" });

  it("two shops of one platform: a near miss with the rule kit-only, the campaigns as without the report", () => {
    const res = clusterCampaigns(graph());
    expect(res.campaigns.assignments.a).not.toBe(res.campaigns.assignments.b);
    const pair = res.nearMisses.pairs.find((p) => [p.a, p.b].sort().join() === "a,b");
    expect(pair?.rule).toBe("kit-only");
    expect(pair?.sharedKinds.length).toBeGreaterThan(0);
  });

  it("turning the report off (maxPairs 0) leaves campaigns, families and assignments identical", () => {
    const on = clusterCampaigns(graph(), { now: () => new Date(FILE_STAMP) });
    const off = clusterCampaigns(graph(), { config: mergeConfig({ nearMiss: { minScoreRatio: 0.5, maxPairs: 0 } }), now: () => new Date(FILE_STAMP) });
    expect(off.nearMisses.pairs).toEqual([]);
    expect(JSON.stringify(off.campaigns)).toBe(JSON.stringify(on.campaigns));
  });
});
