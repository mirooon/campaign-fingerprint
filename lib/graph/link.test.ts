import { describe, expect, it } from "vitest";
import { clusterCampaigns, explain } from "./cluster";
import { DEFAULT_LINK_CONFIG, mergeConfig } from "./config";
import { buildEvidenceGraph } from "./link";
import { makeDataset, type TestInfra, type TestItemSpec } from "./testkit";
import { combineScores, Discounter, idfFactor, pivotWeight } from "./weights";

const CF_IPS = ["104.21.48.10", "172.67.150.20"];
const CF_ASN = { asn: 13335, asName: "CLOUDFLARENET - Cloudflare, Inc., US" };
const CF_NS = ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"];

function run(specs: TestItemSpec[], infra: TestInfra, config = DEFAULT_LINK_CONFIG) {
  const graph = buildEvidenceGraph(makeDataset(specs, infra), { config, textMethod: "none" });
  return clusterCampaigns(graph, { config });
}

function campaignOf(res: ReturnType<typeof run>, id: string) {
  return res.campaigns.assignments[id];
}

describe("weights", () => {
  it("IDF is 1 for pairs and decays smoothly with frequency", () => {
    expect(idfFactor(2, 100)).toBe(1);
    expect(idfFactor(10, 100)).toBeLessThan(1);
    expect(idfFactor(50, 100)).toBeLessThan(idfFactor(10, 100));
    expect(idfFactor(100, 100, 0.2)).toBeGreaterThanOrEqual(0.2);
  });

  it("discounts Cloudflare IPs by CIDR and by ASN", () => {
    const d = new Discounter(DEFAULT_LINK_CONFIG);
    const discounts = d.ipDiscounts("104.21.48.10", [13335]);
    expect(discounts.map((x) => x.rule)).toEqual(["ipCidrs:104.16.0.0/13", "asns:13335"]);
    const w = pivotWeight("ip", discounts, 2, 10, DEFAULT_LINK_CONFIG);
    expect(w.weight).toBeLessThan(0.02);
    expect(w.strong).toBe(false);
    expect(d.ipDiscounts("203.0.113.50", [64500])).toEqual([]);
  });

  it("discounts NS sets only when every nameserver is a mass provider", () => {
    const d = new Discounter(DEFAULT_LINK_CONFIG);
    const cf = d.discountsFor({ type: "nameserver", key: CF_NS.join(" + "), id: "x", data: { nameservers: CF_NS } });
    expect(cf[0]?.factor).toBe(0.1);
    const mixed = d.discountsFor({
      type: "nameserver",
      key: "x",
      id: "x",
      data: { nameservers: ["ada.ns.cloudflare.com", "ns1.own-dns.test"] },
    });
    expect(mixed).toEqual([]);
  });

  it("combines evidence with noisy-OR", () => {
    expect(combineScores([0.5, 0.5])).toBeCloseTo(0.75, 10);
    expect(combineScores([])).toBe(0);
    expect(combineScores([1, 0.2])).toBe(1);
  });
});

describe("Cloudflare must not merge unrelated campaigns", () => {
  const specs: TestItemSpec[] = [
    { id: "a1", url: "https://alpha-zysk.example/start", trackers: [{ kind: "ga4", id: "G-AAAA111111" }] },
    { id: "a2", url: "https://alpha-zysk.example/oferta", trackers: [{ kind: "ga4", id: "G-AAAA111111" }] },
    { id: "b1", url: "https://beta-energia.example/", trackers: [{ kind: "ga4", id: "G-BBBB222222" }] },
    { id: "b2", url: "https://www.beta-energia.example/x", trackers: [{ kind: "ga4", id: "G-BBBB222222" }] },
    { id: "c1", url: "https://sklep-rowerowy.example/" },
  ];
  const cfInfra: TestInfra = {
    hosts: {
      "alpha-zysk.example": CF_IPS,
      "beta-energia.example": CF_IPS,
      "www.beta-energia.example": CF_IPS,
      "sklep-rowerowy.example": CF_IPS,
    },
    asns: { [CF_IPS[0]]: CF_ASN, [CF_IPS[1]]: CF_ASN },
    ns: { "alpha-zysk.example": CF_NS, "beta-energia.example": CF_NS, "sklep-rowerowy.example": CF_NS },
  };

  it("keeps campaigns apart and explains the discount", () => {
    const res = run(specs, cfInfra);
    expect(campaignOf(res, "a1")).toBe(campaignOf(res, "a2"));
    expect(campaignOf(res, "b1")).toBe(campaignOf(res, "b2"));
    expect(campaignOf(res, "a1")).not.toBe(campaignOf(res, "b1"));
    expect(campaignOf(res, "c1")).not.toBe(campaignOf(res, "a1"));
    expect(campaignOf(res, "c1")).not.toBe(campaignOf(res, "b1"));

    const ipNode = res.graph.nodes.find((n) => n.id === `ip:${CF_IPS[0]}`)!;
    expect(ipNode.df).toBe(5);
    expect(ipNode.strong).toBe(false);
    expect(ipNode.discounts.some((d) => d.reason.includes("Cloudflare"))).toBe(true);
    // No cross-campaign link reaches the clustering threshold.
    const cross = res.graph.links.filter((l) => l.a.startsWith("a") !== l.b.startsWith("a"));
    for (const l of cross) expect(l.score).toBeLessThan(DEFAULT_LINK_CONFIG.minLinkScore);
  });

  it("the same structure on a dedicated IP and own NS DOES link (control case)", () => {
    const dedicated: TestInfra = {
      hosts: { "alpha-zysk.example": ["198.51.100.50"], "sklep-rowerowy.example": ["198.51.100.50"] },
      asns: { "198.51.100.50": { asn: 64500, asName: "EXAMPLE-HOSTING" } },
      ns: { "alpha-zysk.example": ["ns1.hosting-x.test", "ns2.hosting-x.test"], "sklep-rowerowy.example": ["ns1.hosting-x.test", "ns2.hosting-x.test"] },
    };
    const res = run([specs[0], specs[1], specs[4]], dedicated);
    expect(campaignOf(res, "c1")).toBe(campaignOf(res, "a1"));
    const link = res.graph.links.find((l) => l.a === "a1" && l.b === "c1")!;
    expect(link.strong).toBe(false); // IP + NS are medium evidence: Louvain merged them, not union-find
    expect(link.score).toBeGreaterThan(DEFAULT_LINK_CONFIG.minLinkScore);
  });
});

describe("pivots", () => {
  it("a shared tracker ID is strong evidence across different domains", () => {
    const res = run(
      [
        { id: "x1", url: "https://one.example/", trackers: [{ kind: "meta_pixel", id: "123456789012345" }] },
        { id: "x2", url: "https://two.test/", trackers: [{ kind: "meta_pixel", id: "123456789012345" }] },
        { id: "y1", url: "https://three.example/" },
      ],
      {},
    );
    const link = res.graph.links.find((l) => l.a === "x1" && l.b === "x2")!;
    expect(link.strong).toBe(true);
    expect(link.evidence[0].pivot).toBe("tracker:meta_pixel:123456789012345");
    expect(campaignOf(res, "x1")).toBe(campaignOf(res, "x2"));
    expect(campaignOf(res, "y1")).not.toBe(campaignOf(res, "x1"));
  });

  it("parked pages sharing the parking provider's tracker and IP are not merged", () => {
    const parkingText = "This domain may be for sale. Buy this domain today!";
    const res = run(
      [
        { id: "p1", url: "https://parked-one.example/", trackers: [{ kind: "ga4", id: "G-PARK000001" }], pageText: parkingText },
        { id: "p2", url: "https://parked-two.example/", trackers: [{ kind: "ga4", id: "G-PARK000001" }], pageText: parkingText },
      ],
      { hosts: { "parked-one.example": ["192.0.2.80"], "parked-two.example": ["192.0.2.80"] } },
    );
    expect(campaignOf(res, "p1")).not.toBe(campaignOf(res, "p2"));
    const link = res.graph.links.find((l) => l.a === "p1" && l.b === "p2");
    expect(link?.strong ?? false).toBe(false);
  });

  it("ignores outbound links to big platforms but keeps other outbound domains (weakly)", () => {
    const graph = buildEvidenceGraph(
      makeDataset([
        { id: "o1", url: "https://o1.example/", outboundDomains: ["facebook.com", "affiliate-net.test"] },
        { id: "o2", url: "https://o2.example/", outboundDomains: ["facebook.com", "affiliate-net.test"] },
      ]),
      { textMethod: "none" },
    );
    expect(graph.nodes.some((n) => n.id === "domain:facebook.com")).toBe(false);
    const link = graph.links.find((l) => l.a === "o1" && l.b === "o2")!;
    expect(link.evidence[0].pivot).toBe("domain:affiliate-net.test");
    expect(link.strong).toBe(false);
  });

  it("follows redirect chains: a shared TDS/redirect host links ads with different landing URLs", () => {
    const res = run(
      [
        { id: "r1", url: "https://ad-a.example/", redirects: ["https://tds.test/go?c=1", "https://final-a.example/"] },
        { id: "r2", url: "https://ad-b.example/", redirects: ["https://tds.test/go?c=1", "https://final-b.example/"] },
      ],
      {},
    );
    const link = res.graph.links.find((l) => l.a === "r1" && l.b === "r2")!;
    expect(link.strong).toBe(true);
    expect(link.evidence.map((e) => e.pivot)).toContain("domain:tds.test");
  });

  it("links domains on a shared multi-domain certificate, discounting free CAs", () => {
    const certs = [{ id: "777", issuer: "Let's Encrypt", sanDomains: ["dom-a.example", "dom-b.example"] }];
    const graph = buildEvidenceGraph(
      makeDataset(
        [
          { id: "c1", url: "https://dom-a.example/" },
          { id: "c2", url: "https://dom-b.example/" },
        ],
        { certs: { "dom-a.example": certs, "dom-b.example": certs } },
      ),
      { textMethod: "none" },
    );
    const cert = graph.nodes.find((n) => n.type === "cert")!;
    expect(cert.df).toBe(2);
    expect(cert.discounts[0].rule).toBe("certIssuers:let's encrypt");
    expect(graph.links[0].evidence[0].pivotType).toBe("cert");
  });

  it("groups a registration burst by IANA registrar ID when registries spell the registrar's name differently", () => {
    const graph = buildEvidenceGraph(
      makeDataset(
        [
          { id: "v1", url: "https://variant-a.example/" },
          { id: "v2", url: "https://variant-b.test/" },
          { id: "v3", url: "https://other-registrar.example/" },
        ],
        {
          rdap: {
            "variant-a.example": { registrar: "Zeta Names Inc", ianaId: "9991", created: "2026-10-01T10:00:00Z" },
            "variant-b.test": { registrar: "Zeta Names, LLC", ianaId: "9991", created: "2026-10-01T10:02:00Z" },
            // same spelling as v1 but a different accredited registrar: must stay out of the burst
            "other-registrar.example": { registrar: "Zeta Names Inc", ianaId: "9992", created: "2026-10-01T10:01:00Z" },
          },
        },
      ),
      { textMethod: "none" },
    );
    const bursts = graph.nodes.filter((n) => n.type === "registrar" && n.data.burst);
    expect(bursts.map((b) => b.data.domains)).toEqual([["variant-a.example", "variant-b.test"]]);
  });

  it("keeps same-day bursts of two registrars apart even when their names are spelled identically", () => {
    const graph = buildEvidenceGraph(
      makeDataset(
        [
          { id: "r1", url: "https://first-a.example/" },
          { id: "r2", url: "https://first-b.example/" },
          { id: "r3", url: "https://second-a.test/" },
          { id: "r4", url: "https://second-b.test/" },
        ],
        {
          rdap: {
            "first-a.example": { registrar: "Zeta Names Inc", ianaId: "9991", created: "2026-10-01T10:00:00Z" },
            "first-b.example": { registrar: "Zeta Names Inc", ianaId: "9991", created: "2026-10-01T10:05:00Z" },
            "second-a.test": { registrar: "Zeta Names Inc", ianaId: "9992", created: "2026-10-01T11:00:00Z" },
            "second-b.test": { registrar: "Zeta Names Inc", ianaId: "9992", created: "2026-10-01T11:05:00Z" },
          },
        },
      ),
      { textMethod: "none" },
    );
    const bursts = graph.nodes.filter((n) => n.type === "registrar" && n.data.burst).map((b) => b.data.domains);
    expect(bursts).toEqual([
      ["first-a.example", "first-b.example"],
      ["second-a.test", "second-b.test"],
    ]);
  });

  it("creates a registration-burst pivot for domains registered together", () => {
    const graph = buildEvidenceGraph(
      makeDataset(
        [
          { id: "g1", url: "https://burst-a.example/" },
          { id: "g2", url: "https://burst-b.example/" },
          { id: "g3", url: "https://late.example/" },
        ],
        {
          rdap: {
            "burst-a.example": { registrar: "Registrar Example Sp. z o.o.", created: "2026-10-01T10:00:00Z" },
            "burst-b.example": { registrar: "Registrar Example Sp. z o.o.", created: "2026-10-02T09:00:00Z" },
            "late.example": { registrar: "Registrar Example Sp. z o.o.", created: "2026-10-20T09:00:00Z" },
          },
        },
      ),
      { textMethod: "none" },
    );
    const burst = graph.nodes.find((n) => n.type === "registrar" && n.data.burst)!;
    expect(burst.df).toBe(2);
    expect(burst.data.domains).toEqual(["burst-a.example", "burst-b.example"]);
  });
});

describe("similarity and explain", () => {
  it("links creative variants by CLIP cosine and skips pairs dHash already covers", () => {
    const graph = buildEvidenceGraph(
      makeDataset([
        { id: "v1", dhash: "ffffffff00000000", imageEmbedding: [1, 0, 0] },
        { id: "v2", dhash: "00000000ffffffff", imageEmbedding: [0.97, 0.24, 0] }, // cos ≈ 0.97, different dHash
        { id: "v3", dhash: "ffffffff00000001", imageEmbedding: [0.97, 0.24, 0] }, // near-duplicate of v1 by dHash
        { id: "x", dhash: "0f0f0f0f0f0f0f0f", imageEmbedding: [0, 0, 1] }, // unrelated
      ]),
      { textMethod: "none" },
    );
    const pair = (a: string, b: string) => graph.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
    const v12 = pair("v1", "v2")!;
    expect(v12.evidence.map((e) => e.edgeType)).toEqual(["similar_image_semantic"]);
    expect(v12.evidence[0].evidence).toContain("CLIP");
    expect(pair("v1", "v3")!.evidence.map((e) => e.edgeType)).toEqual(["similar_image"]);
    expect(pair("v1", "x")).toBeUndefined();
  });

  it("prefers the video embedding and labels video evidence", () => {
    const graph = buildEvidenceGraph(
      makeDataset([
        { id: "w1", imageEmbedding: [0, 1, 0], videoEmbedding: [1, 0, 0] },
        { id: "w2", videoEmbedding: [0.97, 0.24, 0] },
      ]),
      { textMethod: "none" },
    );
    expect(graph.links).toHaveLength(1);
    expect(graph.links[0].evidence[0].evidence).toContain("klatki wideo");
  });

  it("ignores CLIP pairs below the configured cosine", () => {
    const config = mergeConfig({ similarity: { imageSemantic: { minCosine: 0.99 } } });
    const graph = buildEvidenceGraph(
      makeDataset([
        { id: "v1", imageEmbedding: [1, 0, 0] },
        { id: "v2", imageEmbedding: [0.97, 0.24, 0] },
      ]),
      { config, textMethod: "none" },
    );
    expect(graph.links).toEqual([]);
  });

  it("adds near-duplicate image evidence and explains indirect membership", () => {
    const config = mergeConfig({ similarity: { imageHamming: 10 } });
    const graph = buildEvidenceGraph(
      makeDataset([
        { id: "i1", url: "https://img-a.example/", dhash: "ffffffff00000000", advertiser: "Strona Testowa Media" },
        // distance 3 from i1, no URL at all: the picture (content) is corroborated by the advertiser
        { id: "i2", dhash: "ffffffff00000007", advertiser: "Strona Testowa Media" },
        { id: "i3", url: "https://img-a.example/p2" },
      ]),
      { config, textMethod: "none" },
    );
    const res = clusterCampaigns(graph, { config });
    const sim = res.graph.links.find((l) => l.a === "i1" && l.b === "i2")!;
    expect(sim.evidence.map((e) => e.edgeType)).toContain("similar_image");
    expect(res.campaigns.assignments.i2).toBe(res.campaigns.assignments.i3);

    const ex = explain(res.graph, "i2", "i3", config);
    expect(ex.sameCampaign).toBe(true);
    expect(ex.direct).toEqual([]);
    expect(ex.path.map((s) => [s.from, s.to])).toEqual([
      ["i2", "i1"],
      ["i1", "i3"],
    ]);

    const direct = explain(res.graph, "i1", "i3", config);
    expect(direct.direct[0].pathA[0]).toBe("item:i1");
    expect(direct.direct[0].pathB[0]).toBe("item:i3");
  });

  it("links reworded ad copy via TF-IDF and reports campaign stats", () => {
    const graph = buildEvidenceGraph(
      makeDataset([
        // no addresses: the copy and a near-identical picture are two kinds of content
        { id: "t1", text: "Adam Testowy ujawnia: nowa platforma krypto zarabia 5000 zł dziennie. Zarejestruj się dziś!", firstSeen: "2026-10-01T00:00:00Z", dhash: "f0f0f0f0f0f0f0f0" },
        { id: "t2", text: "Adam Testowy ujawnił sekret: platforma kryptowalut zarabia nawet 5000 zł dziennie. Zarejestruj się teraz!", firstSeen: "2026-10-05T00:00:00Z", dhash: "f0f0f0f0f0f0f0ff" },
        { id: "t3", text: "Promocja na rowery miejskie i darmowa dostawa przez cały październik.", firstSeen: "2026-10-03T00:00:00Z" },
      ]),
    );
    const res = clusterCampaigns(graph);
    expect(res.campaigns.assignments.t1).toBe(res.campaigns.assignments.t2);
    expect(res.campaigns.assignments.t3).not.toBe(res.campaigns.assignments.t1);
    const c = res.campaigns.campaigns.find((x) => x.members.includes("t1"))!;
    expect(c.firstSeen).toBe("2026-10-01T00:00:00Z");
    expect(c.lastSeen).toBe("2026-10-05T00:00:00Z");
    expect(c.topEvidence.map((e) => e.type)).toContain("similar_text");
    expect(c.attributes.basis).toBe("content");
    // one kind of content alone (the copy) does not make a campaign
    const textOnly = clusterCampaigns(buildEvidenceGraph(makeDataset([{ id: "t1", text: "Adam Testowy ujawnia: nowa platforma krypto zarabia 5000 zł dziennie. Zarejestruj się dziś!" }, { id: "t2", text: "Adam Testowy ujawnił sekret: platforma kryptowalut zarabia nawet 5000 zł dziennie. Zarejestruj się teraz!" }])));
    expect(textOnly.campaigns.assignments.t1).not.toBe(textOnly.campaigns.assignments.t2);
  });
});
