import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "./cluster";
import { DEFAULT_LINK_CONFIG, mergeConfig } from "./config";
import { buildEvidenceGraph } from "./link";
import type { ItemLink } from "./model";
import { endpointRef, makeDataset, type TestInfra, type TestItemSpec } from "./testkit";
import { ubiquityFactor } from "./weights";

function run(specs: TestItemSpec[], infra: TestInfra = {}) {
  const graph = buildEvidenceGraph(makeDataset(specs, infra), { textMethod: "none" });
  return clusterCampaigns(graph);
}

function link(res: ReturnType<typeof run>, a: string, b: string): ItemLink | undefined {
  return res.graph.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
}

const same = (res: ReturnType<typeof run>, a: string, b: string) => res.campaigns.assignments[a] === res.campaigns.assignments[b];
const familyOf = (res: ReturnType<typeof run>, id: string) => res.campaigns.campaigns.find((c) => c.members.includes(id))?.familyId ?? null;
const sameFamily = (res: ReturnType<typeof run>, a: string, b: string) => familyOf(res, a) !== null && familyOf(res, a) === familyOf(res, b);

describe("endpoint (lead backend) pivot", () => {
  it("a shared cross-origin backend is strong evidence across different domains", () => {
    const res = run([
      { id: "a", url: "https://alpha.example/", kit: { endpoints: [endpointRef("https://leads-api.test/api/v1/submit/0b9a5c3e-1d2f-4a6b-9c8d-7e6f5a4b3c2d/", "https://alpha.example/")] } },
      { id: "b", url: "https://beta.example/", kit: { endpoints: [endpointRef("https://leads-api.test/api/v1/submit/7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2910/", "https://beta.example/")] } },
    ]);
    const l = link(res, "a", "b")!;
    expect(l.strong).toBe(true);
    expect(l.evidence[0].pivot).toBe("endpoint:leads-api.test/api/v1/submit/<uuid>/");
    expect(same(res, "a", "b")).toBe(true);
  });

  it("a public form service must NOT merge unrelated sites", () => {
    const res = run([
      { id: "shop", url: "https://shop.example/", kit: { endpoints: [endpointRef("https://api.web3forms.com/submit", "https://shop.example/")] } },
      { id: "course", url: "https://course.test/", kit: { endpoints: [endpointRef("https://api.web3forms.com/submit", "https://course.test/")] } },
    ]);
    const node = res.graph.nodes.find((n) => n.id === "endpoint:api.web3forms.com/submit")!;
    expect(node.discounts[0].rule).toBe("endpointHosts:web3forms.com");
    expect(node.strong).toBe(false);
    expect(same(res, "shop", "course")).toBe(false);
  });

  it("an outbound link to a public form service domain is discounted like the endpoint itself", () => {
    // A web3forms form usually comes with links to web3forms.com (privacy notice, branding).
    const res = run([
      { id: "shop", url: "https://shop.example/", outboundDomains: ["web3forms.com"], kit: { endpoints: [endpointRef("https://api.web3forms.com/submit", "https://shop.example/")] } },
      { id: "course", url: "https://course.test/", outboundDomains: ["web3forms.com"], kit: { endpoints: [endpointRef("https://api.web3forms.com/submit", "https://course.test/")] } },
    ]);
    const domain = res.graph.nodes.find((n) => n.id === "domain:web3forms.com")!;
    expect(domain.discounts.map((d) => d.rule)).toContain("endpointHosts:web3forms.com");
    expect(domain.weight!).toBeLessThan(0.05);
    expect(link(res, "shop", "course")?.score ?? 0).toBeLessThan(0.1);
    expect(same(res, "shop", "course")).toBe(false);
  });

  it("generic relative paths are near-zero, kit-specific relative paths are medium (never strong)", () => {
    const res = run([
      { id: "x", url: "https://x.example/", kit: { endpoints: [endpointRef("/api/lead", "https://x.example/"), endpointRef("/api/v2/landing/lead-submit/", "https://x.example/", "literal"), endpointRef("/api/v1/trigger/field/", "https://x.example/", "literal")] } },
      { id: "y", url: "https://y.example/", kit: { endpoints: [endpointRef("/api/lead", "https://y.example/"), endpointRef("/api/v2/landing/lead-submit/", "https://y.example/", "literal"), endpointRef("/api/v1/trigger/field/", "https://y.example/", "literal")] } },
    ]);
    const generic = res.graph.nodes.find((n) => n.id === "endpoint:*/api/lead")!;
    const kit = res.graph.nodes.find((n) => n.id === "endpoint:*/api/v2/landing/lead-submit/")!;
    expect(generic.weight!).toBeLessThan(0.05);
    expect(kit.weight!).toBeGreaterThan(0.3);
    expect(kit.strong).toBe(false);
    // the SDK of a landing-page platform is shared by all its accounts: a trait of the platform, not of a kit
    const sdk = res.graph.nodes.find((n) => n.id === "endpoint:*/api/v1/trigger/field/")!;
    expect(sdk.discounts.map((d) => d.rule)).toContain("endpointPlatformPaths:/api/v1/trigger/");
    expect(sdk.weight!).toBeLessThan(0.1);
  });
});

describe("page-kit pivots", () => {
  it("hidden fields: generic names are ignored, a specific set becomes a pivot (alone it makes a family, not a campaign)", () => {
    const res = run([
      { id: "a", url: "https://a.example/", kit: { hiddenFields: ["_token", "access_key", "redirect"] } },
      { id: "b", url: "https://b.example/", kit: { hiddenFields: ["_token", "access_key", "redirect"] } },
      { id: "c", url: "https://c.example/", kit: { hiddenFields: ["device_id", "fill_time", "read_time", "_token"] } },
      { id: "d", url: "https://d.example/", kit: { hiddenFields: ["device_id", "fill_time", "read_time"] } },
    ]);
    expect(res.graph.nodes.some((n) => n.type === "hidden_fields" && n.key.includes("access_key"))).toBe(false);
    expect(res.graph.nodes.find((n) => n.type === "hidden_fields")!.key).toBe("device_id,fill_time,read_time");
    expect(same(res, "a", "b")).toBe(false);
    expect(link(res, "c", "d")!.evidence[0]).toMatchObject({ pivotType: "hidden_fields", discounted: false });
    expect(same(res, "c", "d")).toBe(false);
    expect(sameFamily(res, "c", "d")).toBe(true);
  });

  it("assets: libraries and CDNs are discounted, a kit's own build file is evidence (alone a family, not a campaign)", () => {
    const asset = (url: string, page: string) => {
      const u = new URL(url, page);
      const sameOrigin = u.hostname === new URL(page).hostname;
      const basename = u.pathname.split("/").pop()!.toLowerCase();
      return { key: sameOrigin ? u.pathname : `${u.hostname}${u.pathname}`, url: u.toString(), host: u.hostname, path: u.pathname, basename, kind: "js" as const, sameOrigin };
    };
    const res = run([
      { id: "a", url: "https://a.example/", kit: { assets: [asset("/js/jquery-3.7.1.min.js", "https://a.example/"), asset("https://cdn.jsdelivr.net/npm/x.js", "https://a.example/")] } },
      { id: "b", url: "https://b.example/", kit: { assets: [asset("/js/jquery-3.7.1.min.js", "https://b.example/"), asset("https://cdn.jsdelivr.net/npm/x.js", "https://b.example/")] } },
      { id: "c", url: "https://c.example/", kit: { assets: [asset("/static/js/lead-form.9f8e7d.js", "https://c.example/")] } },
      { id: "d", url: "https://d.test/", kit: { assets: [asset("/static/js/lead-form.9f8e7d.js", "https://d.test/")] } },
    ]);
    expect(res.graph.nodes.some((n) => n.id.includes("jsdelivr"))).toBe(false);
    expect(res.graph.nodes.find((n) => n.id === "asset:/js/jquery-3.7.1.min.js")!.discounts[0].rule).toContain("assetLibraries");
    expect(same(res, "a", "b")).toBe(false);
    expect(link(res, "c", "d")!.evidence[0]).toMatchObject({ pivotType: "asset", discounted: false });
    expect(same(res, "c", "d")).toBe(false);
    expect(sameFamily(res, "c", "d")).toBe(true);
  });

  it("comments: boilerplate is discounted, a specific Cyrillic comment links (a family, not a campaign) and flags the ads", () => {
    const cyr = "вставляем форму после блока phone (демо)";
    const res = run([
      { id: "a", url: "https://a.example/", kit: { comments: ["google tag manager"] } },
      { id: "b", url: "https://b.example/", kit: { comments: ["google tag manager"] } },
      { id: "c", url: "https://c.example/", kit: { comments: [cyr], cyrillicComments: true } },
      { id: "d", url: "https://d.test/", kit: { comments: [cyr], cyrillicComments: true } },
    ]);
    expect(same(res, "a", "b")).toBe(false);
    expect(same(res, "c", "d")).toBe(false);
    expect(sameFamily(res, "c", "d")).toBe(true);
    for (const id of ["c", "d"]) expect(res.campaigns.campaigns.find((c) => c.members.includes(id))!.attributes.cyrillic).toBe(1);
  });

  it("DOM simhash: the same structure on different domains is medium similarity evidence", () => {
    const res = run([
      { id: "a", url: "https://a.example/", kit: { domSimhash: "0f0f0f0f0f0f0f0f" } },
      { id: "b", url: "https://b.test/", kit: { domSimhash: "0f0f0f0f0f0f0f0e" } },
      { id: "c", url: "https://c.example/", kit: { domSimhash: "f0f0f0f0f0f0f0f0" } },
    ]);
    const l = link(res, "a", "b")!;
    expect(l.evidence[0].edgeType).toBe("similar_dom");
    expect(l.strong).toBe(false);
    expect(link(res, "a", "c")).toBeUndefined();
  });
});

describe("path_id pivot (page-builder account ID in resource paths)", () => {
  const ID = "1b2c3d4e-aaaa-4bbb-8ccc-0123456789ab";
  const specs: TestItemSpec[] = [
    { id: "a", url: "https://alpha.example/", kit: { pathIds: [{ id: ID, prefix: "/_cdn/landing/" }] } },
    { id: "b", url: "https://beta.test/", kit: { pathIds: [{ id: ID, prefix: "/_cdn/landing/" }] } },
    { id: "c", url: "https://gamma.example/", kit: { pathIds: [{ id: "9a8b7c6d-bbbb-4ccc-8ddd-ba9876543210", prefix: "/_cdn/landing/" }] } },
  ];

  it("the same account ID on different domains is strong evidence; a different ID is none", () => {
    const res = run(specs);
    const l = link(res, "a", "b")!;
    expect(l.strong).toBe(true);
    expect(l.evidence[0].pivot).toBe(`path_id:${ID}`);
    expect(same(res, "a", "b")).toBe(true);
    expect(link(res, "a", "c")).toBeUndefined();
    expect(same(res, "a", "c")).toBe(false);
  });

  it("an ID listed in the config as shared must NOT merge", () => {
    const config = mergeConfig({ lists: { pivots: [{ match: `path_id:${ID}`, factor: 0.05, reason: "identyfikator wspólny dla wielu klientów" }] } });
    const res = clusterCampaigns(buildEvidenceGraph(makeDataset(specs), { config, textMethod: "none" }), { config });
    expect(res.campaigns.assignments.a).not.toBe(res.campaigns.assignments.b);
  });
});

describe("path_id on a shop platform (the UUID names an installed app, not the merchant)", () => {
  it("two unrelated shops with the same platform app must NOT merge", () => {
    const APP = "0c1d2e3f-cccc-4ddd-8eee-0a1b2c3d4e5f";
    const res = run([
      { id: "shop1", url: "https://okulary-demo.example/products/1", kit: { pathIds: [{ id: APP, prefix: "/cdn/shop/prod/app-extension/" }] } },
      { id: "shop2", url: "https://protezy-demo.test/products/2", kit: { pathIds: [{ id: APP, prefix: "/cdn/shop/prod/app-extension/" }] } },
    ]);
    const node = res.graph.nodes.find((n) => n.type === "path_id")!;
    expect(node.discounts.map((d) => d.rule)).toEqual(["pathIdSharedPrefixes:/cdn/shop/"]);
    expect(node.strong).toBe(false);
    expect(same(res, "shop1", "shop2")).toBe(false);
  });
});

describe("domain_pattern pivot", () => {
  it("links domains generated from one template, also across TLDs, without double counting", () => {
    const res = run([
      { id: "a", url: "https://finance23-voluptas94.sbs/" },
      { id: "b", url: "https://finance41-dolorem77.sbs/" },
      { id: "c", url: "https://finance95-praesentium23.pro/" },
      { id: "d", url: "https://unrelated-shop.example/" },
    ]);
    const ab = link(res, "a", "b")!;
    expect(ab.evidence.map((e) => e.pivot)).toContain("domain_pattern:finance<n>-<lorem><n>.sbs");
    expect(ab.evidence.map((e) => e.pivot)).not.toContain("domain_pattern:finance<n>-<lorem><n>.*");
    const ac = link(res, "a", "c")!;
    expect(ac.evidence.map((e) => e.pivot)).toEqual(["domain_pattern:finance<n>-<lorem><n>.*"]);
    expect(ac.strong).toBe(false);
    expect(same(res, "a", "c")).toBe(true);
    expect(same(res, "a", "d")).toBe(false);
  });

  it("needs a placeholder and at least two distinct domains", () => {
    const res = run([
      { id: "a", url: "https://finance23-voluptas94.sbs/" },
      { id: "b", url: "https://finance23-voluptas94.sbs/other" },
      { id: "c", url: "https://opcoprox.example/" },
    ]);
    expect(res.graph.nodes.some((n) => n.type === "domain_pattern")).toBe(false);
  });
});

describe("cname_target pivot", () => {
  it("an operator's CNAME target links domains; a CDN target must NOT", () => {
    const res = run(
      [
        { id: "a", url: "https://offer-a.example/" },
        { id: "b", url: "https://offer-b.test/" },
        { id: "c", url: "https://shop-c.example/" },
        { id: "d", url: "https://news-d.test/" },
      ],
      {
        cname: {
          "offer-a.example": ["land2.tds-cname.test"],
          "offer-b.test": ["prx7.tds-cname.test"],
          // Shared CDN edge hostname (registrable "fastly.net") used by unrelated customers
          "shop-c.example": ["dualstack.j.sni.global.fastly.net"],
          "news-d.test": ["dualstack.j.sni.global.fastly.net"],
        },
      },
    );
    const op = res.graph.nodes.find((n) => n.id === "cname_target:tds-cname.test")!;
    expect(op.data.targets).toEqual(["land2.tds-cname.test", "prx7.tds-cname.test"]);
    expect(same(res, "a", "b")).toBe(true);
    const cdn = res.graph.nodes.find((n) => n.id === "cname_target:fastly.net")!;
    expect(cdn.df).toBe(2);
    expect(cdn.discounts[0].rule).toBe("cnameTargets:fastly.net");
    expect(same(res, "c", "d")).toBe(false);
  });
});

describe("campaign_param pivot", () => {
  it("specific values are strong, generic values must NOT merge, Cyrillic is flagged", () => {
    const res = run([
      { id: "a", url: "https://a.example/", params: [{ name: "sub1", value: "mb_kowal" }, { name: "utm_source", value: "facebook" }] },
      { id: "b", url: "https://b.test/", params: [{ name: "sub1", value: "mb_kowal" }, { name: "utm_source", value: "facebook" }] },
      { id: "c", url: "https://c.example/", params: [{ name: "utm_source", value: "facebook" }, { name: "utm_medium", value: "cpc" }] },
      { id: "d", url: "https://d.test/", params: [{ name: "utm_source", value: "facebook" }, { name: "utm_campaign", value: "пл_инвест_лиды_07" }] },
    ]);
    expect(link(res, "a", "b")!.strong).toBe(true);
    expect(same(res, "a", "b")).toBe(true);
    expect(same(res, "c", "a")).toBe(false);
    expect(same(res, "c", "d")).toBe(false);
    const generic = res.graph.nodes.find((n) => n.id === "campaign_param:utm_source=facebook")!;
    expect(generic.weight!).toBeLessThan(0.05);
    expect(res.graph.nodes.find((n) => n.id === "item:d")!.data.cyrillic).toBe(true);
  });
});

describe("param_schema pivot (template of a tracking link)", () => {
  it("is recorded for clicks through the same template but does not merge on its own", () => {
    // utm_ref, not utm_visit: utm_visit=<uuid> is the default link of a page platform (lists.paramSchemaPlatformParts)
    const res = run([
      { id: "a", url: "https://alpha.example/?utm_id=aB4dE6gH8jK0mN2pQ4rS&utm_medium=Qw3rTy7UiO&utm_ref=0195c2aa-1111-7222-8333-444455556666" },
      { id: "b", url: "https://beta.test/?utm_id=zY8xW6vU4tS2rQ0pN8mL&utm_medium=zX9cV8bN1m&utm_ref=0195c2bb-9999-7888-8777-666655554444" },
      { id: "c", url: "https://gamma.example/?utm_source=facebook&utm_medium=cpc&utm_campaign=wiosna" },
    ]);
    const nodes = res.graph.nodes.filter((n) => n.type === "param_schema");
    expect(nodes.map((n) => [n.key, n.df, n.strong])).toEqual([["utm_id:tok|utm_medium:tok|utm_ref:uuid", 2, false]]);
    expect(link(res, "a", "b")!.evidence.map((e) => e.pivotType)).toEqual(["param_schema"]);
    expect(same(res, "a", "b")).toBe(false);
  });
});

describe("persona (weak signal)", () => {
  it("one celebrity in two unrelated ads does not merge them, but is reported as an attribute", () => {
    const res = run([
      { id: "a", url: "https://a.example/", personas: ["Adam Testowy"], deepfakeScore: 0.91 },
      { id: "b", url: "https://b.test/", personas: ["Adam Testowy"], deepfakeScore: 0.4 },
    ]);
    const node = res.graph.nodes.find((n) => n.type === "persona")!;
    expect(node.weight!).toBeLessThan(DEFAULT_LINK_CONFIG.minLinkScore);
    expect(same(res, "a", "b")).toBe(false);
    const camp = res.campaigns.campaigns.find((c) => c.members.includes("a"))!;
    expect(camp.attributes.personas).toEqual([{ id: "adam-testowy", name: "Adam Testowy", count: 1 }]);
    expect(camp.attributes.deepfakeScoreMax).toBe(0.91);
  });

  it("carries the category of the person (a group trait) in the persona node, only when the list gives one", () => {
    const res = run([
      { id: "a", url: "https://a.example/", personas: ["Adam Testowy", "Ewa Przykładowa"], personaCategories: { "Adam Testowy": "Dziennikarze" } },
    ]);
    const nodes = res.graph.nodes.filter((n) => n.type === "persona");
    expect(nodes.map((n) => [n.label, n.data.category])).toEqual([
      ["Adam Testowy", "Dziennikarze"],
      ["Ewa Przykładowa", undefined],
    ]);
  });
});

describe("ubiquity penalty", () => {
  it("leaves ordinary frequencies alone and crushes entities present on almost every item", () => {
    expect(ubiquityFactor(10, 43)).toBe(1);
    expect(ubiquityFactor(21, 43)).toBe(1);
    expect(ubiquityFactor(40, 43)).toBeCloseTo(0.1395, 3);
    expect(ubiquityFactor(43, 43)).toBe(0.1);
    expect(ubiquityFactor(5, 6)).toBe(1); // small datasets unaffected
  });

  it("a comment present on every page does not glue unrelated ads together", () => {
    const specs: TestItemSpec[] = Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, url: `https://site${i}.example/`, kit: { comments: ["wygenerowano przez wspolny szablon strony"] } }));
    const res = run(specs);
    expect(new Set(Object.values(res.campaigns.assignments)).size).toBe(12);
  });
});
