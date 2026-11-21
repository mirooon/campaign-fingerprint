/**
 * Traits of platforms used by many independent operators (tracker product, landing-page platform,
 * multi-client form services) must not join campaigns; traits of one operator's instance or account must.
 * Synthetic data only: fictional machines, accounts and .example/.test domains.
 */
import { describe, expect, it } from "vitest";
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
