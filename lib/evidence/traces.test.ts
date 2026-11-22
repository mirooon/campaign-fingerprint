import { describe, expect, it } from "vitest";
import type { GraphNode, ItemLink, PairEvidence } from "../graph/model";
import { sharedTraces } from "./traces";

const node = (id: string, type: GraphNode["type"], label: string, over: Partial<GraphNode> = {}): GraphNode => ({
  id, type, key: label, label, df: 3, weight: 0.5, strong: false, discounts: [], data: {}, campaignId: null, ...over,
});
const ev = (pivot: string, pivotType: GraphNode["type"], over: Partial<PairEvidence> = {}): PairEvidence => ({
  kind: "pivot", pivot, pivotType, edgeType: null, weight: 0.5, strong: false, discounted: false, evidence: "x", pathA: [], pathB: [], ...over,
});
const link = (a: string, b: string, evidence: PairEvidence[]): ItemLink => ({ a, b, score: 0.8, strong: false, evidence });

const nodes = new Map<string, GraphNode>(
  [
    node("platform_account:acc1", "platform_account", "konto-777"),
    node("campaign_param:utm", "campaign_param", "utm_campaign=lato", { weight: 0.72 }),
    node("click_server:x", "click_server", "maszyna-12"),
    node("registrar:serie", "registrar", "seria rejestracji: Rejestrator Testowy, 2026-09-02 (3 domeny)", { discounts: [{ reason: "duży rejestrator", factor: 0.1, rule: "r" }] }),
    node("host:a.example", "host", "a.example"),
    node("domain:a.example", "domain", "a.example"),
  ].map((n) => [n.id, n]),
);

describe("sharedTraces", () => {
  const links = [
    link("a1", "a2", [ev("platform_account:acc1", "platform_account"), ev("campaign_param:utm", "campaign_param", { weight: 0.72 }), ev("click_server:x", "click_server"), ev("host:a.example", "host"), ev("domain:a.example", "domain"), ev("registrar:serie", "registrar", { discounted: true, weight: 0.1 })]),
    link("a2", "a3", [ev("platform_account:acc1", "platform_account"), ev("campaign_param:utm", "campaign_param", { weight: 0.72 }), ev("registrar:serie", "registrar", { discounted: true, weight: 0.1 })]),
    link("a1", "a3", [ev("campaign_param:utm", "campaign_param", { weight: 0.72 })]),
  ];
  const out = sharedTraces(links, nodes);

  it("lists every undiscounted trace shared by at least two ads, with the ads, not only a few top ones", () => {
    const byType = Object.fromEntries(out.identifiers.map((t) => [t.type, t]));
    expect(byType.campaign_param).toMatchObject({ value: "utm_campaign=lato", ads: ["a1", "a2", "a3"], ads_with_identifier: 3 });
    expect(byType.platform_account).toMatchObject({ ads: ["a1", "a2", "a3"] });
    expect(byType.click_server.ads).toEqual(["a1", "a2"]);
  });

  it("orders by coverage times weight and keeps only the domain when the apex host repeats it", () => {
    expect(out.identifiers[0].type).toBe("campaign_param");
    expect(out.identifiers.map((t) => t.type)).not.toContain("host");
    expect(out.identifiers.map((t) => t.type)).toContain("domain");
  });

  it("keeps discounted traces apart, with the reason, as context that does not link", () => {
    expect(out.identifiers.map((t) => t.type)).not.toContain("registrar");
    expect(out.context).toEqual([expect.objectContaining({ type: "registrar", ads: ["a1", "a2", "a3"], discount_reasons: ["duży rejestrator (×0.1)"] })]);
  });
});
