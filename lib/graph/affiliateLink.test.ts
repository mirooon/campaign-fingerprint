import { describe, expect, it } from "vitest";
import { affiliateIdsFromHtml, affiliateIdsFromUrls, sha256Hex } from "../osint/affiliateIds";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset, type TestItemSpec } from "./testkit";

// Affiliate-network accounts of B-330 on synthetic pages: fictional ids, reserved domains only.

/** Clusters synthetic items and returns the result. */
function run(specs: TestItemSpec[]) {
  return clusterCampaigns(buildEvidenceGraph(makeDataset(specs), { textMethod: "none" }));
}
const same = (res: ReturnType<typeof run>, a: string, b: string) => res.campaigns.assignments[a] === res.campaigns.assignments[b];
/** A spec whose kit affiliate ids come from the page HTML, as pagekit would store them. */
function pageSpec(id: string, url: string, html: string, extra: Partial<TestItemSpec> = {}): TestItemSpec {
  return { id, url, ...extra, kit: { affiliateIds: affiliateIdsFromHtml(html, url), ...(extra.kit ?? {}) } };
}
const order = (host: string) => `<a href="https://${host}/click.php?team_id=42&user_id=13&traffic_source_name=Facebook">Zamów</a>`;
const API_KEY = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

describe("affiliate network accounts (B-330)", () => {
  it("extracts the team+user pair scoped to the order link host, and nothing for a bare user_id", () => {
    expect(affiliateIdsFromUrls(["https://net.example.test/click.php?team_id=42&user_id=13"])).toEqual([{ kind: "team_user", host: "net.example.test", value: "42/13", via: "url" }]);
    expect(affiliateIdsFromHtml(`<input type="hidden" name="user_id" value="13">`, "https://lp.example.test/")).toEqual([]);
    expect(affiliateIdsFromUrls(["user_id=13"])).toEqual([]);
  });

  it("reads hidden fields of a form scoped to the action host, with weak attributes, and decodes a base64 referer", () => {
    const html = `<form action="https://net.example.test/order" method="post"><input type="hidden" name="stream_id" value="s77"><input type="hidden" name="offer_uuid" value="0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D"><input type="hidden" name="sub1" value="x1"></form>`;
    const ids = affiliateIdsFromHtml(html, "https://lp.example.test/");
    expect(ids.map((i) => `${i.kind}:${i.host}:${i.value}`)).toEqual(["stream:net.example.test:s77", "offer_uuid:net.example.test:0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"]);
    expect(ids[0].attrs).toEqual({ sub1: "x1" });
    const ref = Buffer.from("https://inner.example.test/?team_id=7&user_id=9").toString("base64");
    expect(affiliateIdsFromUrls([`https://net.example.test/click.php?referer=${ref}`])).toEqual([{ kind: "team_user", host: "inner.example.test", value: "7/9", via: "referer" }]);
  });

  it("the same team+user at the same network host is one shared node; it joins with another trace", () => {
    const res = run([
      pageSpec("a", "https://alpha.test/", order("net.example.test"), { emails: ["kontakt@shared.example.test"] }),
      pageSpec("b", "https://beta.test/", order("net.example.test"), { emails: ["kontakt@shared.example.test"] }),
    ]);
    const node = res.graph.nodes.find((n) => n.type === "affiliate_account");
    expect(node?.key).toBe("team:net.example.test:42/13");
    const link = res.graph.links.find((l) => l.evidence.some((e) => e.pivotType === "affiliate_account"));
    expect(link).toBeDefined();
    expect(same(res, "a", "b")).toBe(true);
  });

  it("the team+user pair alone does not join (notAlone)", () => {
    const res = run([pageSpec("a", "https://alpha.test/", order("net.example.test")), pageSpec("b", "https://beta.test/", order("net.example.test"))]);
    expect(res.graph.nodes.some((n) => n.type === "affiliate_account")).toBe(true);
    expect(same(res, "a", "b")).toBe(false);
  });

  it("the same pair at a different network host gives no link", () => {
    const res = run([pageSpec("a", "https://alpha.test/", order("net.example.test")), pageSpec("b", "https://beta.test/", order("other.example.test"))]);
    expect(res.graph.nodes.filter((n) => n.type === "affiliate_account")).toHaveLength(2);
    expect(res.graph.links.some((l) => l.evidence.some((e) => e.pivotType === "affiliate_account"))).toBe(false);
  });

  it("the same offer_uuid at one network joins alone", () => {
    const html = `<a href="https://net.example.test/go?offer_uuid=0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d">Kup</a>`;
    const res = run([pageSpec("a", "https://alpha.test/", html), pageSpec("b", "https://beta.test/", html)]);
    expect(same(res, "a", "b")).toBe(true);
  });

  it("the same api_key in a link is one crm_key node holding only the hash; the raw key is in neither graph nor pack", () => {
    const html = `<a href="https://net.example.test/api/lead?api_key=${API_KEY}">Wyślij</a>`;
    const ds = makeDataset([pageSpec("a", "https://alpha.test/", html), pageSpec("b", "https://beta.test/", html)]);
    const res = clusterCampaigns(buildEvidenceGraph(ds, { textMethod: "none" }));
    expect(res.graph.nodes.find((n) => n.type === "crm_key")?.key).toBe(sha256Hex(API_KEY));
    expect(same(res, "a", "b")).toBe(true);
    expect(JSON.stringify(res.graph)).not.toContain(API_KEY);
    // the evidence pack reads the page kit (affiliate_accounts, crm_keys): the kit holds the hash only
    expect(JSON.stringify(ds.pages)).not.toContain(API_KEY);
  });
});

describe("affiliate ids in page scripts (B-330)", () => {
  it("reads a network address written into a script", () => {
    const html = `<script>window.goBack('https://news.example.test/?showcase_id=x&stream_id=s-0a1b2c');</script>`;
    expect(affiliateIdsFromHtml(html, "https://lp.example.test/").map((i) => `${i.kind}:${i.host}:${i.value}`)).toEqual(["stream:news.example.test:s-0a1b2c"]);
  });
});
