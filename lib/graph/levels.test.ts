import { describe, expect, it } from "vitest";
import { campaignLinkVerdict, clusterCampaigns } from "./cluster";
import { DEFAULT_LINK_CONFIG, mergeConfig } from "./config";
import { buildEvidenceGraph, impersonatedBrand } from "./link";
import type { ItemLink, PairEvidence } from "./model";
import { makeDataset, type TestItemSpec } from "./testkit";
import type { LanderConfig } from "../osint/landerConfig";

function run(specs: TestItemSpec[]) {
  return clusterCampaigns(buildEvidenceGraph(makeDataset(specs), { textMethod: "none" }));
}
const same = (res: ReturnType<typeof run>, a: string, b: string) => res.campaigns.assignments[a] === res.campaigns.assignments[b];
const lander = (over: Partial<LanderConfig>): LanderConfig => ({
  platform: "aio",
  ownerId: null,
  campaignId: null,
  campaignName: null,
  campaignNumber: null,
  landingId: null,
  landingName: null,
  templateId: null,
  landerTypeId: null,
  sourceId: null,
  sourceName: null,
  ...over,
});
const OWNER_A = "5a1e0c3d-7b42-4f19-9c6e-2d8b41f07a13";
const OWNER_B = "8c3f2a71-41d9-4e6b-a0f5-7e19c4b2d860";
const TEMPLATE = "3d7b9e14-0c5a-4a82-9f31-b6e2a8c4f159";
const COMMENTS = ["fill the hidden input before submit", "custom dropdown for the phone prefix", "remove the default dropdown"];

describe("records of the landing-page platform (window.aio)", () => {
  it("joins pages of one platform campaign and one account, and shows the traffic source", () => {
    const res = run([
      { id: "a", url: "https://dziennik-obywatela.example/", kit: { lander: lander({ ownerId: OWNER_A, campaignId: "6e2d4b80-93a1-4c57-b8e2-1f4a7c9d03be", campaignName: "ZESPOL / PL / Kamp1", sourceName: "FB CAPI via TestCloaker" }) } },
      { id: "b", url: "https://wspolnoty-lokalne.example/", kit: { lander: lander({ ownerId: OWNER_A, campaignId: "6e2d4b80-93a1-4c57-b8e2-1f4a7c9d03be", campaignName: "ZESPOL / PL / Kamp1" }) } },
      { id: "c", url: "https://murek-falowy.example/", kit: { lander: lander({ ownerId: OWNER_A, campaignId: "2b9c71e5-5f08-4d3a-8c47-a3e61d2f9b04", campaignName: "Marek / PL / Kamp1" }) } },
    ]);
    expect(same(res, "a", "b")).toBe(true);
    expect(same(res, "a", "c")).toBe(true); // another campaign of the same account: still one operator
    const ab = res.graph.links.find((l) => l.a === "a" && l.b === "b")!;
    expect(ab.evidence.map((e) => e.pivotType)).toEqual(expect.arrayContaining(["platform_campaign", "platform_account"]));
    const item = res.graph.nodes.find((n) => n.id === "item:a")!;
    expect(item.data).toMatchObject({ platformAccount: OWNER_A, platformCampaignName: "ZESPOL / PL / Kamp1", trafficSource: "FB CAPI via TestCloaker", cloakerInSource: true });
  });

  it("keeps different accounts apart when only the kit is shared, and puts them in one family", () => {
    const res = run([
      { id: "alfa", url: "https://novumtest.example/", kit: { comments: COMMENTS, lander: lander({ ownerId: OWNER_B, templateId: TEMPLATE }) } },
      { id: "beta", url: "https://pikselblask.example/", kit: { comments: COMMENTS, lander: lander({ ownerId: "9f4a06c2-2e7d-4b15-a6c9-58d03e7b1fa2", templateId: TEMPLATE }) } },
      { id: "other", url: "https://unrelated.example/" },
    ]);
    expect(same(res, "alfa", "beta")).toBe(false);
    const fam = res.campaigns.families!;
    expect(fam).toHaveLength(1);
    expect(fam[0].members).toEqual(["alfa", "beta"]);
    expect(fam[0].apart[0]).toMatch(/różne konta na platformie stron/);
    const alfaCampaign = res.campaigns.campaigns.find((c) => c.members.includes("alfa"))!;
    expect(alfaCampaign.familyId).toBe(fam[0].id);
    expect(res.campaigns.campaigns.find((c) => c.members.includes("other"))!.familyId).toBeNull();
  });

  it("joins the same shared kit into one campaign when no account says otherwise", () => {
    const res = run([
      { id: "x", url: "https://one.example/", kit: { comments: COMMENTS, hiddenFields: ["lead_ref", "pxl", "sub_ref", "promo_code"] } },
      { id: "y", url: "https://two.example/", kit: { comments: COMMENTS, hiddenFields: ["lead_ref", "pxl", "sub_ref", "promo_code"] } },
    ]);
    expect(same(res, "x", "y")).toBe(true);
  });
});

describe("campaignLinkVerdict", () => {
  const ev = (kind: string, weight: number, discounted = false): PairEvidence => ({
    kind: kind.startsWith("similar_") ? "similarity" : "pivot",
    pivot: kind.startsWith("similar_") ? null : `${kind}:x`,
    pivotType: kind.startsWith("similar_") ? null : (kind as PairEvidence["pivotType"]),
    edgeType: kind.startsWith("similar_") ? (kind as PairEvidence["edgeType"]) : null,
    weight,
    strong: false,
    discounted,
    evidence: kind,
    pathA: [],
    pathB: [],
  });
  const link = (evidence: PairEvidence[], score = 0.4): ItemLink => ({ a: "a", b: "b", score, strong: false, evidence });

  it("never lets one kind of content, a page-kit trait or a persona join alone", () => {
    expect(campaignLinkVerdict(link([ev("similar_text", 0.3)]), DEFAULT_LINK_CONFIG)).toBe("single_kind");
    expect(campaignLinkVerdict(link([ev("similar_text", 0.5)], 0.5), DEFAULT_LINK_CONFIG, new Map(), new Set())).toBe("single_kind");
    expect(campaignLinkVerdict(link([ev("similar_dom", 0.38)]), DEFAULT_LINK_CONFIG)).toBe("single_kind");
    expect(campaignLinkVerdict(link([ev("persona", 0.1), ev("persona", 0.1)], 0.19), DEFAULT_LINK_CONFIG)).toBe("below");
    expect(campaignLinkVerdict(link([ev("similar_dom", 0.3), ev("comment", 0.3)]), DEFAULT_LINK_CONFIG)).toBe("campaign");
    // a kind of evidence that is neither content nor a kit trait still stands alone
    expect(campaignLinkVerdict(link([ev("advertiser", 0.6)], 0.6), DEFAULT_LINK_CONFIG)).toBe("campaign");
  });

  it("joins content only between ads without infrastructure, by two kinds of content", () => {
    const content = link([ev("similar_image", 0.4), ev("similar_text", 0.3)], 0.58);
    expect(campaignLinkVerdict(content, DEFAULT_LINK_CONFIG, new Map(), new Set())).toBe("campaign");
    expect(campaignLinkVerdict(content, DEFAULT_LINK_CONFIG, new Map(), new Set(["a"]))).toBe("single_kind");
    // with infrastructure all content is one kind: it still corroborates another kind
    const mixed = link([ev("similar_text", 0.3), ev("similar_dom", 0.3)], 0.51);
    expect(campaignLinkVerdict(mixed, DEFAULT_LINK_CONFIG, new Map(), new Set(["a", "b"]))).toBe("campaign");
    // the older reading is one setting away
    const loose = mergeConfig({ campaignRules: { contentKindsWithInfrastructure: 2 } });
    expect(campaignLinkVerdict(content, loose, new Map(), new Set(["a"]))).toBe("campaign");
  });

  it("does not count weak discounted evidence, and never joins two accounts without strong evidence", () => {
    expect(campaignLinkVerdict(link([ev("registrar", 0.18, true)], 0.18), DEFAULT_LINK_CONFIG)).toBe("single_kind");
    const accounts = new Map([["a", OWNER_A], ["b", OWNER_B]]);
    expect(campaignLinkVerdict(link([ev("similar_dom", 0.4), ev("comment", 0.6)], 0.76), DEFAULT_LINK_CONFIG, accounts)).toBe("account_conflict");
    expect(campaignLinkVerdict({ ...link([]), strong: true }, DEFAULT_LINK_CONFIG, accounts)).toBe("campaign");
  });
});

describe("tracker server and clicked ad from the landing URL", () => {
  it("links two landings routed through one xid tracker machine and reads the clicked Meta ad", () => {
    const fb = "PAYnJpZAECdGVzdC1jbGljay1yZWNvcmQAYWRpZAGrE2D2xQHHc3J0Y2FwcF9pZA8xMjM0NTAwMDAwNjc4OTAAAQ";
    const res = run([
      { id: "m2", url: "https://smart-zdrowie.example/L50918273fl-306k741-fkf205Q/?clickid=d6q8k5t1mb1h14galpgg" },
      { id: "m1", url: `https://zdrowie-link.example/L72649105fl-518m392-fkf864W/?clickid=d6qjcrl1mb1h14gblns0&fbclid=${fb}` },
    ]);
    const l = res.graph.links.find((x) => x.a === "m1" && x.b === "m2")!;
    expect(l.evidence[0]).toMatchObject({ pivot: "click_server:a1b2c3", strong: false });
    expect(l.evidence[0].evidence).toContain("maszyna a1b2c3");
    expect(res.graph.nodes.find((n) => n.id === "click_server:a1b2c3")?.data.pids).toEqual([4242]);
    const m1 = res.graph.nodes.find((n) => n.id === "item:m1")!;
    expect(m1.data).toMatchObject({ clickTime: "2026-03-14T10:20:30Z", metaAdId: "120211122233344455", metaAppId: "123450000067890" });
    expect(res.graph.nodes.some((n) => n.id === "meta_ad:120211122233344455")).toBe(true);
  });
});

describe("impersonatedBrand", () => {
  it("reads the brand a cloned page claims in its title when its domain does not carry it", () => {
    expect(impersonatedBrand("«Widziałem wszystko»: afera wokół Jana Testowego — Kurier Testowy", "https://dziennik-obywatela.example/")).toBe("Kurier Testowy");
    expect(impersonatedBrand("Wiadomości z kraju — Kurier Testowy", "https://wiadomosci.kurier-testowy.example/")).toBeNull();
    expect(impersonatedBrand("Forum Inwestorów 2026 – Gdzie Pieniądz Spotyka Jutro Rynku", "https://meropulo-test.example/")).toBeNull();
    expect(impersonatedBrand("Vitaflex Pro", "https://owalsolid-test.example/")).toBeNull();
  });
});

describe("favicon of an impersonated brand", () => {
  it("is discounted as a trait of the brand, not of the operator", async () => {
    const { Discounter } = await import("./weights");
    const d = new Discounter(DEFAULT_LINK_CONFIG).discountsFor({ type: "favicon", key: "mmh3:1357924680", id: "favicon:mmh3:1357924680", data: { impersonatedBrand: "Kurier Testowy" } });
    expect(d).toEqual([{ reason: "favicon podrabianej marki „Kurier Testowy” (cecha marki, pod którą się podszywają, nie operatora)", factor: 0.1, rule: "kit.brandAssetFactor" }]);
  });
});
