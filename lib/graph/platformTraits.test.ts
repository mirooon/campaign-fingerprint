/**
 * Traits of platforms used by many independent operators (tracker product, landing-page platform,
 * multi-client form services) must not join campaigns; traits of one operator's instance or account must.
 * Synthetic data only: fictional machines, accounts and .example/.test domains.
 */
import { describe, expect, it } from "vitest";
import { emptyAdLibraryInfo, type AdLibraryInfo } from "../osint/adLibrary";
import { encodeXid } from "../osint/clickIds";
import type { LanderConfig } from "../osint/landerConfig";
import { extractPageKit, withRequestUrls } from "../osint/pagekit";
import { clusterCampaigns } from "./cluster";
import { mergeConfig } from "./config";
import { buildEvidenceGraph } from "./link";
import { endpointRef, makeDataset, type TestItemSpec } from "./testkit";

function run(specs: TestItemSpec[]) {
  return clusterCampaigns(buildEvidenceGraph(makeDataset(specs), { textMethod: "none" }));
}
const same = (res: ReturnType<typeof run>, a: string, b: string) => res.campaigns.assignments[a] === res.campaigns.assignments[b];
const linkOf = (res: ReturnType<typeof run>, a: string, b: string) => res.graph.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
const xid = (machine: string, pid: number, counter: number) => encodeXid({ time: "2026-09-10T12:00:00Z", machine, pid, counter });

describe("tracker server from xid click IDs", () => {
  it("joins two clicks issued by one machine under different process IDs", () => {
    const res = run([
      { id: "a", url: `https://zdrowie-portal.example/lp/?clickid=${xid("0a0b0c", 50001, 100)}` },
      { id: "b", url: `https://inny-portal.example/lp/?clickid=${xid("0a0b0c", 61234, 9000)}` },
    ]);
    const l = linkOf(res, "a", "b")!;
    expect(l.evidence.map((e) => e.pivot)).toContain("click_server:0a0b0c");
    expect(res.graph.nodes.find((n) => n.id === "click_server:0a0b0c")?.data.pids).toEqual([50001, 61234]);
  });

  it("does not link two machines that share only the process ID (a constant of the tracker product)", () => {
    const res = run([
      { id: "a", url: `https://zdrowie-portal.example/lp/?clickid=${xid("0a0b0c", 50001, 100)}` },
      { id: "b", url: `https://inny-portal.example/lp/?clickid=${xid("1d2e3f", 50001, 100)}` },
    ]);
    const l = linkOf(res, "a", "b");
    expect(l?.strong ?? false).toBe(false);
    expect(l?.evidence.some((e) => e.pivotType === "click_server") ?? false).toBe(false);
    expect(same(res, "a", "b")).toBe(false);
  });
});

describe("files and link format of a tracker product", () => {
  const asset = (pageUrl: string) => {
    const host = new URL(pageUrl).hostname;
    return { key: "/include/events-stat.js", url: `https://${host}/include/events-stat.js`, host, path: "/include/events-stat.js", basename: "events-stat.js", kind: "js" as const, sameOrigin: true };
  };
  const page = (id: string, host: string, hex: string, tok: string): TestItemSpec => {
    const url = `https://${host}/?key=${hex}&clickid=${tok}&sub7=${tok}x9`;
    return { id, url, kit: { assets: [asset(url)], endpoints: [endpointRef(`https://${host}/click?key=${hex}`, url)] } };
  };

  it("does not make one campaign of two operators sharing only events-stat.js and the /click?key= format", () => {
    const res = run([
      page("a", "alfa-wiadomosci.example", "0123456789abcdef0123456789abcdef", "Qa1Wb2Ec3R"),
      page("b", "beta-zdrowie.test", "fedcba9876543210fedcba9876543210", "Zx9Yw8Vu7T"),
    ]);
    const l = linkOf(res, "a", "b")!;
    expect(new Set(l.evidence.map((e) => e.pivotType))).toEqual(new Set(["asset", "endpoint", "param_schema"]));
    expect(l.evidence.every((e) => e.discounted)).toBe(true);
    expect(same(res, "a", "b")).toBe(false);
    const ev = res.graph.nodes.find((n) => n.id === "asset:/include/events-stat.js")!;
    expect(ev.discounts.map((d) => d.rule)).toContain("endpointPlatformPaths:/include/events-stat.js");
  });
});

describe("external form backend: client identifier and multi-client services", () => {
  const UUID_A = "6f1c2e3d-4b5a-4c7d-8e9f-0a1b2c3d4e5f";
  const UUID_B = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
  const withForm = (id: string, host: string, action: string, hidden = ""): TestItemSpec => {
    const url = `https://${host}/`;
    const html = `<html><body><form action="${action}" method="post">${hidden}<input name="phone"></form></body></html>`;
    return { id, url, kit: { endpoints: extractPageKit(html, url).endpoints } };
  };

  it("keeps the client ID in the key: two domains posting to one client of a lead service are one campaign", () => {
    const res = run([
      withForm("a", "zdrowie-dzis.example", `https://leads.example/api/v1/lead/${UUID_A}`),
      withForm("b", "portal-finansowy.test", `https://leads.example/api/v1/lead/${UUID_A}`),
    ]);
    const l = linkOf(res, "a", "b")!;
    expect(l.strong).toBe(true);
    expect(l.evidence[0].pivot).toBe(`endpoint:leads.example/api/v1/lead/<uuid>#klient=${UUID_A}`);
    expect(l.evidence[0].evidence).toContain("ten sam backend formularza z tym samym identyfikatorem klienta");
    expect(same(res, "a", "b")).toBe(true);
  });

  it("does not link two different clients of the same service", () => {
    const res = run([
      withForm("a", "zdrowie-dzis.example", `https://leads.example/api/v1/lead/${UUID_A}`),
      withForm("b", "portal-finansowy.test", `https://leads.example/api/v1/lead/${UUID_B}`),
    ]);
    expect(linkOf(res, "a", "b")).toBeUndefined();
    expect(same(res, "a", "b")).toBe(false);
  });

  it("reads the client ID from a hidden field of the form", () => {
    const hidden = (v: string) => `<input type="hidden" name="account_id" value="${v}"><input type="hidden" name="csrf" value="0123456789abcdef0123">`;
    const a = withForm("a", "zdrowie-dzis.example", "https://crm.example/submit", hidden("48151623"));
    expect(a.kit!.endpoints![0]).toMatchObject({ clientId: "48151623", clientIdSource: "ukryte pole account_id", key: "crm.example/submit#klient=48151623" });
    const res = run([a, withForm("b", "portal-finansowy.test", "https://crm.example/submit", hidden("48151623"))]);
    expect(same(res, "a", "b")).toBe(true);
  });

  it("gives a backend of a multi-client service without a client ID only a platform-trait weight", () => {
    const config = mergeConfig({ lists: { multiTenantBackends: [{ match: "forms.example", factor: 0.1, reason: "usługa wielu klientów (test)" }] } });
    const specs = [
      withForm("a", "zdrowie-dzis.example", "https://forms.example/api/submit/lead"),
      withForm("b", "portal-finansowy.test", "https://forms.example/api/submit/lead"),
    ];
    const res = clusterCampaigns(buildEvidenceGraph(makeDataset(specs), { textMethod: "none", config }), { config });
    const l = linkOf(res, "a", "b")!;
    expect(l.strong).toBe(false);
    expect(l.evidence[0]).toMatchObject({ pivotType: "endpoint", discounted: true });
    expect(l.evidence[0].weight).toBeLessThan(0.15);
    expect(same(res, "a", "b")).toBe(false);
    // the default configuration (no list entry): the same backend stays a strong trace
    const def = run(specs);
    expect(linkOf(def, "a", "b")!.strong).toBe(true);
  });
});

describe("tenant of the landing-page platform (landing-cdn/<uuid>) in place of the account", () => {
  const U = "2f7c9a1e-4b3d-4e8f-a6c2-9d0b1e5f7a38";
  const OTHER = "7b1d3f5a-9c2e-4a6b-8d0f-1e3a5c7b9d24";
  const lander = (ownerId: string): LanderConfig => ({
    platform: "aio",
    ownerId,
    campaignId: null,
    campaignName: null,
    campaignNumber: null,
    landingId: null,
    landingName: null,
    templateId: null,
    landerTypeId: null,
    sourceId: null,
    sourceName: null,
  });

  it("joins a page with owner_uuid U and a page known only from a request to landing-cdn/U", () => {
    const res = run([
      { id: "a", url: "https://dziennik-alfa.example/", kit: { lander: lander(U) } },
      { id: "b", url: "https://kurier-beta.test/", kit: withRequestUrls(null, [`https://cdn.example/landing-cdn/${U}/app.js`]) },
    ]);
    const l = linkOf(res, "a", "b")!;
    expect(l.evidence.map((e) => e.pivot)).toContain(`platform_account:${U}`);
    expect(same(res, "a", "b")).toBe(true);
    expect(res.graph.nodes.find((n) => n.id === "item:b")!.data).toMatchObject({ platformAccount: U, platformAccountSource: "tenant", platformTenants: [U] });
  });

  it("warns when the tenant and owner_uuid of one page differ, and maps a tenant-only page to that owner", () => {
    const pageWithBoth = extractPageKit(`<html><head><script src="https://cdn.example/landing-cdn/${OTHER}/a1/app.js"></script></head><body></body></html>`, "https://dziennik-alfa.example/");
    expect(pageWithBoth.platformTenants).toEqual([OTHER]);
    const res = run([
      { id: "a", url: "https://dziennik-alfa.example/", kit: { ...pageWithBoth, lander: lander(U) } },
      { id: "b", url: "https://kurier-beta.test/", kit: withRequestUrls(null, [`https://cdn.example/landing-cdn/${OTHER}/b2/app.js`]) },
    ]);
    const a = res.graph.nodes.find((n) => n.id === "item:a")!.data;
    expect(String(a.platformAccountWarning)).toContain("różni się od owner_uuid");
    const b = res.graph.nodes.find((n) => n.id === "item:b")!.data;
    expect(b).toMatchObject({ platformAccount: U, platformAccountSource: "tenant→owner_uuid" });
    expect(linkOf(res, "a", "b")!.evidence.map((e) => e.pivot)).toContain(`platform_account:${U}`);
    expect(same(res, "a", "b")).toBe(true);
  });

  it("ignores a shared library of the platform (not a UUID) and keeps different tenants apart", () => {
    expect(withRequestUrls(null, ["https://cdn.example/landing-cdn/666/x/app.js"]).platformTenants).toBeUndefined();
    const res = run([
      { id: "a", url: "https://dziennik-alfa.example/", text: "Jan Testowy ujawnia sekret platformy, która daje 4000 zł dziennie bez ryzyka.", kit: withRequestUrls(null, [`https://cdn.example/landing-cdn/${U}/app.js`]) },
      { id: "b", url: "https://kurier-beta.test/", text: "Jan Testowy ujawnia sekret platformy, która daje 4000 zł dziennie bez ryzyka.", kit: withRequestUrls(null, [`https://cdn.example/landing-cdn/${OTHER}/app.js`]) },
    ]);
    expect(same(res, "a", "b")).toBe(false);
  });
});

describe("domain suspended by the registrar (parking NS and placeholder address)", () => {
  // Public values of the registrar service, not of an operator: its suspension NS and the placeholder A record.
  const SUSPENDED_NS = ["ns1.dyna-ns.net", "ns2.dyna-ns.net"];
  const PLACEHOLDER_IP = "1.1.1.1";

  it("does not link two suspended domains of different operators and marks both as suspended", () => {
    const specs: TestItemSpec[] = [
      { id: "a", url: "https://zdrowie-alfa.test/" },
      { id: "b", url: "https://portal-beta.example/" },
    ];
    const ds = makeDataset(specs, {
      hosts: { "zdrowie-alfa.test": [PLACEHOLDER_IP], "portal-beta.example": [PLACEHOLDER_IP] },
      ns: { "zdrowie-alfa.test": SUSPENDED_NS, "portal-beta.example": SUSPENDED_NS },
      rdap: {
        "zdrowie-alfa.test": { registrar: "Rejestrator Testowy", created: "2026-03-02T10:00:00Z", status: ["client hold", "client transfer prohibited"] },
        "portal-beta.example": { registrar: "Rejestrator Testowy", created: "2026-08-20T10:00:00Z", status: ["serverHold"] },
      },
    });
    const res = clusterCampaigns(buildEvidenceGraph(ds, { textMethod: "none" }));
    const l = linkOf(res, "a", "b");
    expect(l?.strong ?? false).toBe(false);
    expect(l?.score ?? 0).toBeLessThan(0.15);
    expect(same(res, "a", "b")).toBe(false);
    for (const d of ["zdrowie-alfa.test", "portal-beta.example"]) expect(res.graph.nodes.find((n) => n.id === `domain:${d}`)?.data.suspended).toBe(true);
  });

  it("does not mark a domain with only transfer locks as suspended", () => {
    const ds = makeDataset([{ id: "a", url: "https://zdrowie-alfa.test/" }], {
      rdap: { "zdrowie-alfa.test": { registrar: "Rejestrator Testowy", created: "2026-03-02T10:00:00Z", status: ["client transfer prohibited"] } },
    });
    const g = buildEvidenceGraph(ds, { textMethod: "none" });
    expect(g.nodes.find((n) => n.id === "domain:zdrowie-alfa.test")?.data.suspended).toBeUndefined();
  });
});

describe("domain names from the platform's lorem generator (no literal core)", () => {
  it("does not make one campaign of two lorem domains of different tenants with nothing else in common", () => {
    // no page code: no owner_uuid, so the account conflict cannot keep them apart
    const res = run([
      { id: "a", url: "https://dolor-amet-magna.test/" },
      { id: "b", url: "https://nulla-tempor-lacus.test/" },
    ]);
    const l = linkOf(res, "a", "b")!;
    expect(l.evidence.map((e) => e.pivot)).toContain("domain_pattern:<lorem>-<lorem>-<lorem>.test");
    expect(l.score).toBeLessThan(0.15);
    expect(same(res, "a", "b")).toBe(false);
  });

  it("keeps the weight of a template with a literal core", () => {
    const res = run([
      { id: "a", url: "https://finanse23-dolor.test/" },
      { id: "b", url: "https://finanse87-magna.test/" },
    ]);
    expect(same(res, "a", "b")).toBe(true);
  });
});

describe("SDK and default link template of the landing-page platform (window.aio)", () => {
  const OWNER_A = "3c9e1a7b-5d2f-4e8a-9b6c-0d1e2f3a4b5c";
  const OWNER_B = "8f2a4c6e-1b3d-4f5a-8c7e-9d0b1a2c3e4f";
  const sdkPage = (id: string, host: string, owner: string, visit: string, tok: string): TestItemSpec => {
    const url = `https://${host}/?utm_visit=${visit}&utm_source=${tok}a1&utm_campaign=${tok}b2&utm_content=${tok}c3`;
    const html = `<html><head>
<script src="/aio-static/sdk/main.js?v=1.0.49"></script>
<link rel="stylesheet" href="/aio-static/sdk/main.css">
<link rel="manifest" href="/api/v1/pwa/manifest/${owner}">
<script>window.aio = JSON.parse('{"campaign":{"owner_uuid":"${owner}"}}');
navigator.serviceWorker.register("/aio-sw.js");
fetch("/api/v1/agent/pub-key-push-settings/", { method: "POST" });
fetch("/api/v1/trigger/visit", { method: "POST" });</script>
</head><body><p>Strona testowa</p></body></html>`;
    return { id, url, kit: extractPageKit(html, url) };
  };

  it("gives two pages on the same SDK under different accounts a pair score near 0, no campaign and no group", () => {
    const res = run([
      sdkPage("a", "dziennik-alfa.example", OWNER_A, "0192f3a4-5b6c-7d8e-9f01-23456789abcd", "Qw7Er"),
      sdkPage("b", "kurier-beta.test", OWNER_B, "0192f3b5-6c7d-7e8f-a012-3456789abcde", "Zx4Cv"),
    ]);
    const l = linkOf(res, "a", "b");
    expect(l?.score ?? 0).toBeLessThan(0.05);
    expect(l?.evidence.every((e) => e.discounted) ?? true).toBe(true);
    expect(same(res, "a", "b")).toBe(false);
    const families = res.campaigns.families ?? [];
    expect(families.some((f) => f.members.includes("a") && f.members.includes("b"))).toBe(false);
  });
});

describe("payer from the ad library (accounts are rented or stolen)", () => {
  const libRec = (id: string, payer: string): AdLibraryInfo => ({ ...emptyAdLibraryInfo(id, null), payers: [payer], beneficiaries: [payer] });

  it("puts two ads with the same payer and nothing else in common at most in one group", () => {
    const res = run([
      { id: "a", url: "https://zdrowie-alfa.test/", adLibrary: [libRec("1000000000000101", "Jan Testowy")] },
      { id: "b", url: "https://portal-beta.example/", adLibrary: [libRec("1000000000000202", "Jan Testowy")] },
    ]);
    const l = linkOf(res, "a", "b")!;
    expect(l.evidence.map((e) => e.pivotType)).toEqual(["ad_payer"]);
    expect(l.strong).toBe(false);
    expect(same(res, "a", "b")).toBe(false);
  });

  it("joins them when a second kind of evidence of the operator confirms the payer", () => {
    const res = run([
      { id: "a", url: `https://zdrowie-alfa.test/?clickid=${xid("0a0b0c", 50001, 100)}`, adLibrary: [libRec("1000000000000101", "Jan Testowy")] },
      { id: "b", url: `https://portal-beta.example/?clickid=${xid("0a0b0c", 50001, 900)}`, adLibrary: [libRec("1000000000000202", "Jan Testowy")] },
    ]);
    expect(same(res, "a", "b")).toBe(true);
  });
});

describe("campaign key and internal numbers of a tracker product", () => {
  const HEX_A = "0123456789abcdef0123456789abcdef";
  const HEX_B = "fedcba9876543210fedcba9876543210";

  it("links two materials with the same key= value through a shared tracker_campaign that is not strong", () => {
    const res = run([
      { id: "a", url: `https://alfa-wiadomosci.example/?key=${HEX_A}`, params: [{ name: "tracker_campaign", value: HEX_A }] },
      { id: "b", url: `https://beta-zdrowie.test/?key=${HEX_A}`, params: [{ name: "tracker_campaign", value: HEX_A }] },
    ]);
    const l = linkOf(res, "a", "b")!;
    const ev = l.evidence.find((e) => e.pivot === `campaign_param:tracker_campaign=${HEX_A}`)!;
    expect(ev).toBeDefined();
    expect(ev.strong).toBe(false);
    expect(ev.weight).toBeGreaterThanOrEqual(0.5);
    expect(same(res, "a", "b")).toBe(true);
  });

  it("does not link two different keys of the same format", () => {
    const res = run([
      { id: "a", url: `https://alfa-wiadomosci.example/?key=${HEX_A}`, params: [{ name: "tracker_campaign", value: HEX_A }] },
      { id: "b", url: `https://beta-zdrowie.test/?key=${HEX_B}`, params: [{ name: "tracker_campaign", value: HEX_B }] },
    ]);
    expect(linkOf(res, "a", "b")?.evidence.some((e) => e.pivot?.startsWith("campaign_param:tracker_campaign=")) ?? false).toBe(false);
  });

  it("scopes campaign_id by the xid machine: the same number on different machines is no shared node", () => {
    const res = run([
      { id: "a", url: `https://alfa-wiadomosci.example/?campaign_id=319&clickid=${xid("0a0b0c", 50001, 100)}`, params: [{ name: "campaign_id", value: "319" }] },
      { id: "b", url: `https://beta-zdrowie.test/?campaign_id=319&clickid=${xid("1d2e3f", 50001, 100)}`, params: [{ name: "campaign_id", value: "319" }] },
      { id: "c", url: `https://gamma-portal.example/?campaign_id=319&clickid=${xid("0a0b0c", 50001, 700)}`, params: [{ name: "campaign_id", value: "319" }] },
    ]);
    expect(linkOf(res, "a", "b")?.evidence.some((e) => e.pivotType === "campaign_param") ?? false).toBe(false);
    expect(res.graph.nodes.some((n) => n.id === "campaign_param:campaign_id=319")).toBe(false);
    expect(linkOf(res, "a", "c")!.evidence.map((e) => e.pivot)).toContain("campaign_param:campaign_id=0a0b0c/319");
  });
});

describe("campaign, source and account of the page platform read from its link (cuuid, suuid, launcher)", () => {
  const C = "0192f3c6-7d8e-7f90-a123-456789abcdef";
  const S = "0192f3d7-8e9f-7a01-b234-56789abcdef0";
  const U = "5e7a9c1b-3d5f-4b7d-9e1a-2c4e6a8b0d13";
  const scriptPage = (id: string, host: string): TestItemSpec => {
    const url = `https://${host}/`;
    const html = `<html><head><script>var go = "https://trk.platforma.example/v1/go?cuuid=${C}&suuid=${S}&source_visit_id=0192f3e8-9fa0-7b12-c345-6789abcdef01";
document.querySelectorAll("a").forEach(function (a) { a.href = go; });</script></head><body><p>Strona</p></body></html>`;
    return { id, url, kit: extractPageKit(html, url) };
  };

  it("joins two pages whose scripts carry the same cuuid through one platform_campaign node", () => {
    const res = run([scriptPage("a", "dziennik-alfa.example"), scriptPage("b", "kurier-beta.test")]);
    const l = linkOf(res, "a", "b")!;
    expect(l.evidence.map((e) => e.pivot)).toContain(`platform_campaign:${C}`);
    expect(res.graph.nodes.find((n) => n.id === "item:a")!.data.platformSourceIds).toEqual([S]);
    expect(same(res, "a", "b")).toBe(true);
  });

  it("puts launcher= of a bare link in the owner_uuid space: shared platform_account with a window.aio page", () => {
    const owner: LanderConfig = { platform: "aio", ownerId: U, campaignId: null, campaignName: null, campaignNumber: null, landingId: null, landingName: null, templateId: null, landerTypeId: null, sourceId: null, sourceName: null };
    const res = run([
      { id: "a", url: "https://dziennik-alfa.example/", kit: { lander: owner } },
      { id: "b", url: `https://kurier-beta.test/?cuuid=${C}&suuid=${S}&launcher=${U}` },
    ]);
    const l = linkOf(res, "a", "b")!;
    expect(l.evidence.map((e) => e.pivot)).toContain(`platform_account:${U}`);
    expect(res.graph.nodes.find((n) => n.id === "item:b")!.data).toMatchObject({ platformAccount: U, platformAccountSource: "launcher" });
    expect(same(res, "a", "b")).toBe(true);
  });
});
