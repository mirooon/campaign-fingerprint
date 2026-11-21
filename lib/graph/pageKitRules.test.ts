/**
 * Traces of a page kit (campaignRules.notAloneKinds: theme files, hidden fields, template comments,
 * DOM structure, favicon of a cloned portal ...) and the shared lander library of the page platform
 * are used by many unrelated operators: they never make a campaign on their own, together, or with
 * content. A campaign needs at least one kind of evidence of the operator, and a conflict of platform
 * accounts wins also over a strong path ID.
 * Synthetic data only: fictional accounts and UUIDs, .example/.test domains.
 */
import { describe, expect, it } from "vitest";
import { encodeXid } from "../osint/clickIds";
import type { LanderConfig } from "../osint/landerConfig";
import { extractPageKit, type AssetRef } from "../osint/pagekit";
import { campaignLinkVerdict, campaignScore, clusterCampaigns, verdictContext } from "./cluster";
import { DEFAULT_LINK_CONFIG } from "./config";
import { buildEvidenceGraph } from "./link";
import { makeDataset, type TestInfra, type TestItemSpec } from "./testkit";

function run(specs: TestItemSpec[], infra: TestInfra = {}) {
  return clusterCampaigns(buildEvidenceGraph(makeDataset(specs, infra), { textMethod: "tfidf" }));
}
type Result = ReturnType<typeof run>;
const same = (res: Result, a: string, b: string) => res.campaigns.assignments[a] === res.campaigns.assignments[b];
const linkOf = (res: Result, a: string, b: string) => res.graph.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))!;
const familyOf = (res: Result, id: string) => res.campaigns.campaigns.find((c) => c.members.includes(id))?.familyId ?? null;
const verdictOf = (res: Result, a: string, b: string) => {
  const { accountOf, infraItems } = verdictContext(res.graph.nodes);
  return campaignLinkVerdict(linkOf(res, a, b), DEFAULT_LINK_CONFIG, accountOf, infraItems);
};
const lander = (ownerId: string, templateId: string | null = null): LanderConfig => ({
  platform: "aio",
  ownerId,
  campaignId: null,
  campaignName: null,
  campaignNumber: null,
  landingId: null,
  landingName: null,
  templateId,
  landerTypeId: null,
  sourceId: null,
  sourceName: null,
});
/** Same-origin asset of a page, as extractPageKit records it. */
const asset = (pageUrl: string, path: string): AssetRef => {
  const host = new URL(pageUrl).hostname;
  return { key: path, url: `https://${host}${path}`, host, path, basename: path.split("/").pop()!, kind: path.endsWith(".css") ? "css" : "js", sameOrigin: true };
};
/** A page whose scripts and styles all lie under `dir` on its own host (two files: enough for a path ID). */
const pageWithFiles = (url: string, dir: string) =>
  extractPageKit(`<html><head><link rel="stylesheet" href="${dir}style.css"><script src="${dir}app.js"></script></head><body></body></html>`, url);

const ACCOUNT_A = "1a2b3c4d-1111-4aaa-8aaa-0000000000a1";
const ACCOUNT_B = "5e6f7a8b-2222-4bbb-9bbb-0000000000b2";
const LANDER = "c0ffee00-3333-4ccc-8ccc-0000000000c3";

describe("page kit traces do not add up to a campaign", () => {
  it("1: two shops of one shop platform (same theme files, hidden fields and theme comments) are one group, not one campaign", () => {
    const shop = (id: string, url: string, email: string): TestItemSpec => ({
      id,
      url,
      emails: [email],
      kit: {
        assets: [asset(url, "/assets/motyw-zielony.7f3a9c.js"), asset(url, "/assets/motyw-zielony.7f3a9c.css")],
        hiddenFields: ["cart_token", "theme_section", "variant_pick"],
        comments: ["motyw zielony: sekcja koszyka", "motyw zielony: karta produktu"],
      },
    });
    const res = run([shop("a", "https://sklep-alfa.example/", "kontakt@sklep-alfa.example"), shop("b", "https://sklep-beta.test/", "biuro@sklep-beta.test")], {
      rdap: { "sklep-alfa.example": { registrar: "Rejestrator Pierwszy", created: "2026-03-01" }, "sklep-beta.test": { registrar: "Rejestrator Drugi", created: "2026-07-15" } },
      ns: { "sklep-alfa.example": ["ns1.dns-alfa.example"], "sklep-beta.test": ["ns1.dns-beta.test"] },
    });
    expect(new Set(linkOf(res, "a", "b").evidence.map((e) => e.pivotType ?? e.edgeType))).toEqual(new Set(["asset", "hidden_fields", "comment"]));
    expect(verdictOf(res, "a", "b")).toBe("single_kind");
    expect(same(res, "a", "b")).toBe(false);
    expect(familyOf(res, "a")).not.toBeNull();
    expect(familyOf(res, "a")).toBe(familyOf(res, "b"));
  });

  it("2: two clones of one portal (favicon, clone comments, similar DOM, identical text) are at most a group", () => {
    const TEXT = "Pilna wiadomość: Jan Testowy ujawnia, jak zarabia 4000 zł dziennie na nowej platformie. Zobacz, zanim usuną ten artykuł!";
    const clone = (id: string, url: string, domSimhash: string): TestItemSpec => ({
      id,
      url,
      text: TEXT,
      faviconMmh3: -123456789,
      kit: { domSimhash, comments: ["klon portalu: blok artykułu", "klon portalu: stopka redakcji"] },
    });
    const res = run(
      [clone("a", "https://wiadomosci-alfa.example/artykul?utm_campaign=alfa1", "0f0f0f0f0f0f0f0f"), clone("b", "https://kurier-beta.test/artykul?utm_campaign=beta2", "0f0f0f0f0f0f0f0e")],
      {
        rdap: { "wiadomosci-alfa.example": { registrar: "Rejestrator Pierwszy", created: "2026-03-01" }, "kurier-beta.test": { registrar: "Rejestrator Drugi", created: "2026-07-15" } },
        ns: { "wiadomosci-alfa.example": ["ns1.dns-alfa.example"], "kurier-beta.test": ["ns1.dns-beta.test"] },
      },
    );
    const kinds = new Set(linkOf(res, "a", "b").evidence.map((e) => e.pivotType ?? e.edgeType));
    for (const k of ["favicon", "comment", "similar_dom", "similar_text"]) expect(kinds).toContain(k);
    expect(verdictOf(res, "a", "b")).toBe("single_kind");
    expect(same(res, "a", "b")).toBe(false);
  });

  it("3: one shared block of template comments scoring at least 0.5 alone is not a campaign", () => {
    const comments = ["sekcja opinii: początek bloku", "sekcja opinii: koniec bloku"];
    const res = run([
      { id: "a", url: "https://opinie-alfa.example/", kit: { comments } },
      { id: "b", url: "https://opinie-beta.test/", kit: { comments } },
    ]);
    const l = linkOf(res, "a", "b");
    expect(l.evidence.every((e) => e.pivotType === "comment")).toBe(true);
    expect(campaignScore(l, DEFAULT_LINK_CONFIG)).toBeGreaterThanOrEqual(0.5);
    expect(verdictOf(res, "a", "b")).toBe("single_kind");
    expect(same(res, "a", "b")).toBe(false);
  });

  it("4: the same platform account or the same tracker server with a shared template is still one campaign", () => {
    const xid = (machine: string, pid: number) => encodeXid({ time: "2026-09-10T12:00:00Z", machine, pid, counter: 7 });
    const template = { domSimhash: "0f0f0f0f0f0f0f0f", comments: ["szablon: formularz zgłoszenia"] };
    const res = run([
      { id: "acc1", url: "https://konto-alfa.example/", kit: { ...template, lander: lander(ACCOUNT_A) } },
      { id: "acc2", url: "https://konto-beta.test/", kit: { ...template, lander: lander(ACCOUNT_A) } },
      { id: "trk1", url: `https://tracker-gamma.example/lp/?clickid=${xid("0a0b0c", 50001)}`, kit: { domSimhash: "f0f0f0f0f0f0f0f0", comments: ["inny szablon: nagłówek"] } },
      { id: "trk2", url: `https://tracker-delta.test/lp/?clickid=${xid("0a0b0c", 61234)}`, kit: { domSimhash: "f0f0f0f0f0f0f0f1", comments: ["inny szablon: nagłówek"] } },
    ]);
    expect(same(res, "acc1", "acc2")).toBe(true);
    const trk = linkOf(res, "trk1", "trk2");
    expect(trk.strong).toBe(false);
    expect(trk.evidence.map((e) => e.pivotType)).toContain("click_server");
    expect(verdictOf(res, "trk1", "trk2")).toBe("campaign");
    expect(same(res, "trk1", "trk2")).toBe(true);
  });
});

describe("shared lander library of the page platform (\"666\")", () => {
  it("5: the same lander UUID under landing-cdn/666/ on pages of different accounts gives no strong path ID and no campaign", () => {
    const dir = `/_cdn/production/landing-cdn/666/${LANDER}/`;
    const res = run([
      { id: "a", url: "https://strona-alfa.example/", kit: { ...pageWithFiles("https://strona-alfa.example/", dir), lander: lander(ACCOUNT_A) } },
      { id: "b", url: "https://strona-beta.test/", kit: { ...pageWithFiles("https://strona-beta.test/", dir), lander: lander(ACCOUNT_B) } },
    ]);
    const node = res.graph.nodes.find((n) => n.id === `path_id:${LANDER}`)!;
    expect(node.discounts.map((d) => d.rule)).toEqual(["pathIdSharedPrefixes:/_cdn/production/landing-cdn/666/"]);
    expect(node.strong).toBe(false);
    expect(linkOf(res, "a", "b")?.strong ?? false).toBe(false);
    expect(same(res, "a", "b")).toBe(false);
  });

  it("6: two accounts with the same lander_template_uuid from the 666 library are not one campaign", () => {
    const dir = `/_cdn/production/action-files-test/666/${LANDER}/`;
    const res = run([
      { id: "a", url: "https://strona-alfa.example/", kit: { ...pageWithFiles("https://strona-alfa.example/", dir), lander: lander(ACCOUNT_A, LANDER) } },
      { id: "b", url: "https://strona-beta.test/", kit: { ...pageWithFiles("https://strona-beta.test/", dir), lander: lander(ACCOUNT_B, LANDER) } },
    ]);
    expect(linkOf(res, "a", "b").evidence.map((e) => e.pivotType)).toContain("page_template");
    expect(same(res, "a", "b")).toBe(false);
  });

  it("7: the same lander UUID outside the 666 library under one account is still strong evidence and one campaign", () => {
    const dir = `/_cdn/landing/${LANDER}/`;
    const res = run([
      { id: "a", url: "https://strona-alfa.example/", kit: { ...pageWithFiles("https://strona-alfa.example/", dir), lander: lander(ACCOUNT_A) } },
      { id: "b", url: "https://strona-beta.test/", kit: { ...pageWithFiles("https://strona-beta.test/", dir), lander: lander(ACCOUNT_A) } },
    ]);
    expect(linkOf(res, "a", "b").evidence.find((e) => e.pivot === `path_id:${LANDER}`)?.strong).toBe(true);
    expect(same(res, "a", "b")).toBe(true);
  });

  it("a conflict of platform accounts wins also over a strong path ID: two accounts are a group, not one campaign", () => {
    const dir = `/_cdn/landing/${LANDER}/`;
    const res = run([
      { id: "a", url: "https://strona-alfa.example/", kit: { ...pageWithFiles("https://strona-alfa.example/", dir), lander: lander(ACCOUNT_A) } },
      { id: "b", url: "https://strona-beta.test/", kit: { ...pageWithFiles("https://strona-beta.test/", dir), lander: lander(ACCOUNT_B) } },
    ]);
    const l = linkOf(res, "a", "b");
    expect(l.strong).toBe(true);
    expect(verdictOf(res, "a", "b")).toBe("account_conflict");
    expect(same(res, "a", "b")).toBe(false);
    expect(familyOf(res, "a")).not.toBeNull();
    expect(familyOf(res, "a")).toBe(familyOf(res, "b"));
  });
});
