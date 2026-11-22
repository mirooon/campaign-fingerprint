/**
 * Fields of the landing-page platform's visitor record (`window.aio.visit.fields`): the cloaker customer
 * account (B-331) and the launcher account plus the id in the Meta campaign name (B-345).
 * Synthetic data only: made-up UUIDs, numbers and .example/.test hosts.
 */
import { describe, expect, it } from "vitest";
import { extractLanderConfig, type LanderConfig } from "../osint/landerConfig";
import { redactPageHtml } from "../osint/redact";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset, type TestItemSpec } from "./testkit";

/** Runs the graph and clustering on synthetic items. */
function run(specs: TestItemSpec[]) {
  return clusterCampaigns(buildEvidenceGraph(makeDataset(specs), { textMethod: "none" }));
}
/** The link between two items, if any. */
const linkOf = (res: ReturnType<typeof run>, a: string, b: string) => res.graph.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));

const OWNER_A = "0f1e2d3c-4b5a-4968-8776-655443322110";
const OWNER_B = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const LAUNCHER = "9e8d7c6b-5a49-4382-9716-afbecdc0d1e2";

/** A lander record with only the fields under test set. */
function lander(ownerId: string, extra: Partial<LanderConfig> = {}): LanderConfig {
  return { platform: "aio", ownerId, campaignId: null, campaignName: null, campaignNumber: null, landingId: null, landingName: null, templateId: null, landerTypeId: null, sourceId: null, sourceName: null, ...extra };
}
/** One item whose page carries the given lander record. */
const page = (id: string, host: string, lc: LanderConfig): TestItemSpec => ({ id, url: `https://${host}/`, kit: { lander: lc } });

describe("extractLanderConfig: visit.fields (B-331, B-345)", () => {
  const rec = (fields: Record<string, unknown>, visit: Record<string, unknown> = {}) =>
    `<script>window.aio = JSON.parse('${JSON.stringify({ campaign: { owner_uuid: OWNER_A }, visit: { ...visit, fields } })}')</script>`;

  it("reads the cloaker, the launcher and the 16-digit id of the campaign name", () => {
    const lc = extractLanderConfig(rec({ cl_sid: "12345", cl_domain: "Cloak.Example.test", cl_did: "777", cl_clid: "abc", launcher: LAUNCHER.toUpperCase(), fb_campaign_name: "PL(PL) - Testowa - 1234567890123456 - 2 (1,2/9)" }));
    expect(lc?.cloaker).toEqual({ sid: "12345", domain: "cloak.example.test", did: "777" });
    expect(lc?.launcherId).toBe(LAUNCHER);
    expect(lc?.fbCampaignNameId).toBe("1234567890123456");
  });

  it("falls back to visit.launcher and leaves empty fields out", () => {
    const lc = extractLanderConfig(rec({ launcher: "", cl_sid: "", fb_campaign_name: "PL - bez numeru 12345" }, { launcher: LAUNCHER }));
    expect(lc?.launcherId).toBe(LAUNCHER);
    expect(lc?.cloaker).toBeUndefined();
    expect(lc?.fbCampaignNameId).toBeUndefined();
    expect(extractLanderConfig(rec({ launcher: "" }))?.launcherId).toBeUndefined();
  });

  it("keeps the operator's fields through redaction and drops the visit's click id", () => {
    const out = redactPageHtml(rec({ cl_sid: "12345", cl_domain: "cloak.example.test", cl_did: "777", cl_clid: "klik-analityka-1", fbclid: "klik-analityka-2", launcher: LAUNCHER, fb_campaign_name: "PL - X - 1234567890123456 - 1" })).text;
    const lc = extractLanderConfig(out);
    expect(lc?.cloaker).toEqual({ sid: "12345", domain: "cloak.example.test", did: "777" });
    expect(lc?.launcherId).toBe(LAUNCHER);
    expect(lc?.fbCampaignNameId).toBe("1234567890123456");
    for (const gone of ["klik-analityka-1", "klik-analityka-2"]) expect(out).not.toContain(gone);
  });
});

describe("cloaker_account (B-331)", () => {
  it("links two cases with the same cl_sid on the same cloaker host", () => {
    const cl = { sid: "25011", domain: "cloak.example.test", did: null };
    const res = run([page("a", "alfa-wiadomosci.example", lander(OWNER_A, { cloaker: cl })), page("b", "beta-zdrowie.test", lander(OWNER_B, { cloaker: { ...cl, did: "42" } }))]);
    expect(linkOf(res, "a", "b")?.evidence.map((e) => e.pivot)).toContain("cloaker_account:cloak.example.test/25011");
    expect(res.campaigns.assignments.a).toBe(res.campaigns.assignments.b);
  });

  it("does not link the same cl_sid on different cloaker hosts", () => {
    const res = run([
      page("a", "alfa-wiadomosci.example", lander(OWNER_A, { cloaker: { sid: "25011", domain: "cloak.example.test", did: null } })),
      page("b", "beta-zdrowie.test", lander(OWNER_B, { cloaker: { sid: "25011", domain: "inny-cloak.example", did: null } })),
    ]);
    expect(linkOf(res, "a", "b")?.evidence.some((e) => e.pivotType === "cloaker_account") ?? false).toBe(false);
  });

  it("keeps cl_did alone as an attribute, not a link", () => {
    const cl = { sid: null, domain: null, did: "129999" };
    const res = run([page("a", "alfa-wiadomosci.example", lander(OWNER_A, { cloaker: cl })), page("b", "beta-zdrowie.test", lander(OWNER_B, { cloaker: cl }))]);
    expect(linkOf(res, "a", "b")).toBeUndefined();
    expect(res.graph.nodes.some((n) => n.type === "cloaker_account")).toBe(false);
    expect((res.graph.nodes.find((n) => n.id === "item:a")?.data.cloaker as { did: string }).did).toBe("129999");
  });
});

describe("launcher_account and fb_campaign_name id (B-345)", () => {
  it("links two cases with the same launcher that differs from the page owner", () => {
    const res = run([page("a", "alfa-wiadomosci.example", lander(OWNER_A, { launcherId: LAUNCHER })), page("b", "beta-zdrowie.test", lander(OWNER_B, { launcherId: LAUNCHER }))]);
    expect(linkOf(res, "a", "b")?.evidence.map((e) => e.pivot)).toContain(`launcher_account:${LAUNCHER}`);
  });

  it("adds no second pivot when the launcher equals owner_uuid (one platform account)", () => {
    const res = run([page("a", "alfa-wiadomosci.example", lander(OWNER_A, { launcherId: OWNER_A })), page("b", "beta-zdrowie.test", lander(OWNER_A, { launcherId: OWNER_A }))]);
    const ev = linkOf(res, "a", "b")!.evidence;
    expect(ev.map((e) => e.pivot)).toEqual([`platform_account:${OWNER_A}`]);
    expect(res.graph.nodes.some((n) => n.type === "launcher_account")).toBe(false);
    expect(res.graph.nodes.find((n) => n.id === "item:a")?.data.launcherSameAsOwner).toBe(true);
  });

  it("creates nothing for an empty launcher", () => {
    const res = run([page("a", "alfa-wiadomosci.example", lander(OWNER_A)), page("b", "beta-zdrowie.test", lander(OWNER_B))]);
    expect(linkOf(res, "a", "b")).toBeUndefined();
    expect(res.graph.nodes.some((n) => n.type === "launcher_account")).toBe(false);
  });

  it("links two cases by the 16-digit id in the Meta campaign name", () => {
    const res = run([page("a", "alfa-wiadomosci.example", lander(OWNER_A, { fbCampaignNameId: "1234567890123456" })), page("b", "beta-zdrowie.test", lander(OWNER_B, { fbCampaignNameId: "1234567890123456" }))]);
    expect(linkOf(res, "a", "b")?.evidence.map((e) => e.pivot)).toContain("campaign_param:fb_campaign_name_id=1234567890123456");
  });
});
