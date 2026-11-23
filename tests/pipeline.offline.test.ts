/**
 * End-to-end offline test on the synthetic sample: ingest -> enrich (recorded fixtures,
 * no network) -> evidence graph -> clustering -> evaluation, including the hard negatives
 * (shared form service, CDN CNAME, common libraries, generic UTM values, a celebrity name).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { clusterCampaigns, explain } from "../lib/graph/cluster";
import { mergeConfig } from "../lib/graph/config";
import { buildEvidenceGraph } from "../lib/graph/link";
import { evaluateClustering } from "../lib/graph/eval";
import type { CampaignsFile, EvidenceGraph } from "../lib/graph/model";
import type { LinkConfig } from "../lib/graph/config";
import { detectFpcalc } from "../lib/media/audioFp";
import type { EnrichedDataset } from "../lib/pipeline/types";
import { runSample } from "./sampleRun";

let ds: EnrichedDataset;
let graph: EvidenceGraph;
let campaigns: CampaignsFile;
let config: LinkConfig;
const fpcalc = await detectFpcalc();

beforeAll(async () => {
  const run = await runSample();
  expect(run.warnings).toEqual([]);
  ({ ds, graph, campaigns, config } = run);
});

const node = (id: string) => graph.nodes.find((n) => n.id === id);
const pageOf = (itemId: string) => ds.pages[ds.perItem[itemId].pageKey!];
const truthOf = (itemId: string) => ds.items.find((it) => it.id === itemId)!.label;

describe("offline enrichment from raw fixtures", () => {
  it("parses redirect chains, pages, RDAP, crt.sh and Team Cymru data", () => {
    expect(ds.items).toHaveLength(43);
    expect(Object.values(ds.perItem).every((e) => e.errors.length === 0)).toBe(true);
    const c3 = ds.pages["https://wiadomosci-demo.test/artykul/marek-fikcyjny-wywiad?src=fb1"];
    expect(c3.fetch.redirectChain).toHaveLength(1);
    expect(c3.fetch.finalUrl).toBe("https://lp.oferta-fikcyjna.example/rejestracja?src=fb1&sub1=mb_kowal&offer_id=771304");
    expect(c3.extract?.trackers).toEqual([{ kind: "gtm", id: "GTM-ABC12DE" }]);
    expect(ds.domains["kryptozysk-ai.example"].rdap?.registrar).toBe("NameCheap, Inc.");
    expect(ds.domains["oferta-fikcyjna.example"].ct?.certs[0].sanDomains).toContain("szybki-zysk-teraz.example");
    expect(ds.ips["104.21.32.15"]?.asn).toBe(13335);
    expect(ds.perItem["c1-01"].image?.dhash).toMatch(/^[0-9a-f]{16}$/);
    expect(ds.perItem["c1-08"].text?.telegram).toEqual(["t.me/kryptozysk_vip"]);
  });
});

describe("campaign linking on the synthetic sample", () => {
  it("recovers the ground-truth campaigns", () => {
    const truth = Object.fromEntries(ds.items.map((it) => [it.id, it.label!]));
    const r = evaluateClustering(campaigns.assignments, truth);
    expect(r.pairwise.precision).toBe(1);
    // the one miss is c2-08 (no address, only a similar picture and copy): content alone does not join
    // an ad with infrastructure, so it is a similar campaign of C2 (see the next test)
    expect(r.pairwise.recall).toBeGreaterThanOrEqual(0.94);
    expect(r.pairwise.f1).toBeGreaterThanOrEqual(0.95);
    expect(r.ari).toBeGreaterThanOrEqual(0.95);
    const withoutC208 = Object.fromEntries(Object.entries(campaigns.assignments).filter(([id]) => id !== "c2-08"));
    expect(evaluateClustering(withoutC208, truth).pairwise.recall).toBe(1);
  });

  it("recovers every campaign with the older content reading (contentKindsWithInfrastructure: 2)", async () => {
    const loose = mergeConfig({ campaignRules: { contentKindsWithInfrastructure: 2 } }, config);
    const res = clusterCampaigns(buildEvidenceGraph(ds, { config: loose }), { config: loose });
    const truth = Object.fromEntries(ds.items.map((it) => [it.id, it.label!]));
    expect(evaluateClustering(res.campaigns.assignments, truth).pairwise.recall).toBe(1);
  });

  it("does not merge campaigns that only share Cloudflare anycast IPs and NS", () => {
    const a = campaigns.assignments;
    expect(a["c1-01"]).not.toBe(a["c2-01"]);
    expect(a["n-01"]).not.toBe(a["c1-01"]);
    expect(a["n-01"]).not.toBe(a["c2-01"]);
    const cf = graph.nodes.find((n) => n.id === "ip:104.21.32.15")!;
    expect(cf.df).toBeGreaterThan(10);
    expect(cf.weight).toBeLessThan(0.02);
  });

  it("keeps parked domains and shortener users apart", () => {
    const a = campaigns.assignments;
    expect(a["n-03"]).not.toBe(a["n-04"]);
    expect(a["n-02"]).not.toBe(a["c5-01"]);
  });

  it("puts an ad without a URL whose creative nearly repeats one campaign's into that campaign as a variant", () => {
    // image + text similarity only: content does not join an ad with infrastructure by the pair rules,
    // but the creative (a few dHash bits away) points to one campaign only (campaignRules.contentVariant)
    const ex = explain(graph, "c2-08", "c2-01");
    expect(ex.sameCampaign).toBe(true);
    expect(ex.direct.map((e) => e.edgeType)).toContain("similar_image");
    const c2 = campaigns.campaigns.find((c) => c.members.includes("c2-01"))!;
    expect(c2.members).toContain("c2-08");
    expect(c2.variants?.map((v) => v.id)).toEqual(["c2-08"]);
    expect(c2.attributes.basis).toBe("mixed");
  });
});

describe("page kit, CNAME, domain pattern, campaign parameters and personas", () => {
  it("extracts the lead backend, hidden fields, own build files and comments from landing pages", () => {
    const backendA = pageOf("c1-01").kit!.endpoints.find((e) => e.host === "leads-gate.test")!;
    const backendB = pageOf("c1-04").kit!.endpoints.find((e) => e.host === "leads-gate.test")!;
    // the UUID in the path is the client of the backend: it stays in the key
    expect(backendA.key).toBe("leads-gate.test/api/v1/submit/<uuid>/#klient=0b9a5c3e-1d2f-4a6b-9c8d-7e6f5a4b3c2d");
    expect(backendA.pathTemplate).toBe(backendB.pathTemplate);
    expect(backendB.key).not.toBe(backendA.key); // a different UUID per domain: a different client
    expect(pageOf("c1-01").kit!.cyrillicComments).toBe(true);
    expect(pageOf("c1-01").kit!.assets.map((a) => a.path)).toContain("/assets/js/kz-form.3fa9c1.js");
    expect(pageOf("c3-01").kit!.hiddenFields).toEqual(expect.arrayContaining(["device_id", "fill_time", "read_time"]));
    expect(pageOf("c2-01").kit!.endpoints.map((e) => e.key)).toEqual(expect.arrayContaining(["*/api/lead", "*/api/v2/lead/"]));
  });

  it("turns the cross-origin backend, campaign parameters, CNAME operator domain and name template into pivots", () => {
    expect(node("endpoint:leads-gate.test/api/v1/submit/<uuid>/#klient=0b9a5c3e-1d2f-4a6b-9c8d-7e6f5a4b3c2d")?.strong).toBe(true);
    expect(node("campaign_param:utm_campaign=пл_инвест_лиды_07")?.data.cyrillic).toBe(true);
    for (const id of ["campaign_param:sub1=mb_kowal", "campaign_param:offer_id=771304", "campaign_param:aff_id=kd_partner_19"]) {
      expect(node(id)?.strong, id).toBe(true);
    }
    expect(node("cname_target:tds-cname.test")?.df).toBe(4);
    expect(node("cname_target:tds-cname.test")?.data.targets).toEqual(["land2.tds-cname.test", "prx7.tds-cname.test"]);
    expect(node("domain_pattern:zwrot<n>-<lorem><n>.*")?.df).toBe(3);
    expect(node("domain_pattern:zwrot<n>-<lorem><n>.example")?.df).toBe(2);
    expect(node("hidden_fields:device_id,fill_time,read_time")?.df).toBe(8);
    // the generator's marker comment is on every page and is switched off in linking.json
    expect(node("comment:syntetyczna strona testowa (starter hacknation) — fikcyjne osoby i marki")?.weight).toBe(0);
  });

  it("hard negative: a public form service shared by C5, N1 and N2 does not merge them", () => {
    // each site has its own access key: three different clients of the service, no shared node
    const forms = graph.nodes.filter((n) => n.type === "endpoint" && n.data.host === "api.web3forms.com");
    expect(forms.map((n) => n.data.clientIdSource)).toEqual(["ukryte pole access_key", "ukryte pole access_key", "ukryte pole access_key"]);
    expect(new Set(forms.map((n) => n.data.clientId)).size).toBe(3);
    expect(node("domain:web3forms.com")?.weight ?? 0).toBeLessThan(0.05);
    const a = campaigns.assignments;
    expect(new Set([a["c5-01"], a["n-01"], a["n-02"]]).size).toBe(3);
  });

  it("hard negative: a shared CDN CNAME (Fastly) does not merge C5 with N5", () => {
    expect(node("cname_target:fastly.net")!.weight!).toBeLessThan(0.02);
    expect(campaigns.assignments["c5-01"]).not.toBe(campaigns.assignments["n-05"]);
  });

  it("hard negatives: common libraries, generic UTM values and a generic relative form path", () => {
    const a = campaigns.assignments;
    expect(node("asset:/js/jquery-3.7.1.min.js")!.weight!).toBeLessThan(0.05);
    expect(node("asset:/css/style.css")!.weight!).toBeLessThan(0.05);
    expect(node("campaign_param:utm_source=facebook")!.weight!).toBeLessThan(0.05);
    expect(node("campaign_param:utm_medium=cpc")!.weight!).toBeLessThan(0.05);
    expect(node("endpoint:*/api/lead")!.weight!).toBeLessThan(0.05);
    expect(new Set([a["c1-01"], a["c2-01"], a["n-01"]]).size).toBe(3);
    expect(a["c2-01"]).not.toBe(a["c3-01"]);
  });

  it("hard negative: N5 names C1's persona but stays a separate campaign (persona is a weak signal)", () => {
    expect(ds.perItem["n-05"].personas.map((p) => p.id)).toContain("adam-testowy");
    expect(node("persona:adam-testowy")!.weight!).toBeLessThan(config.minLinkScore);
    expect(campaigns.assignments["n-05"]).not.toBe(campaigns.assignments["c1-01"]);
  });

  it("DOM simhash only connects pages built from the same template", () => {
    const sims = graph.edges.filter((e) => e.type === "similar_dom");
    expect(sims.length).toBeGreaterThan(0);
    for (const e of sims) expect(truthOf(e.source.slice(5)), `${e.source} ~ ${e.target}`).toBe(truthOf(e.target.slice(5)));
  });

  it("reads DROZD-style columns and summarises campaign attributes (not edges)", () => {
    const c1 = ds.items.find((it) => it.id === "c1-01")!;
    expect(c1.persona).toBe("Adam Testowy");
    expect(c1.deepfakeScore).toBeCloseTo(0.93);
    expect(ds.items.find((it) => it.id === "c1-04")!.deepfakeScore).toBeCloseTo(0.88);
    expect(ds.perItem["c1-01"].personas.map((p) => p.source)).toEqual(expect.arrayContaining(["watchlist", "ingest"]));
    // one edge per persona, keeping both ways it was found
    const personaEdges = graph.edges.filter((e) => e.source === "item:c1-01" && e.type === "mentions_persona");
    expect(personaEdges).toHaveLength(1);
    expect(personaEdges[0].evidence).toBe("persona from the input data column; from the watchlist of names");
    const k = campaigns.campaigns.find((c) => c.members.includes("c1-01"))!;
    expect(k.attributes.personas[0]).toMatchObject({ id: "adam-testowy", name: "Adam Testowy" });
    expect(k.attributes.cyrillic).toBeGreaterThan(0);
    expect(k.attributes.deepfakeScoreMax).toBeCloseTo(0.93);
  });
});

describe("opt-in checks on the sample", () => {
  it("cloaking: two GETs with different user agents flag the redirector that shows crawlers a harmless page", async () => {
    const run = await runSample({ only: ["c3-01", "c3-07", "c1-01"], enrich: { cloaking: true } });
    const page = (id: string) => run.ds.pages[run.ds.perItem[id].pageKey!];
    expect(page("c3-01").cloaking?.suspected).toBe(true);
    expect(page("c3-01").cloaking?.finalUrlDiffers).toBe(true);
    expect(page("c3-01").cloaking?.crawler.finalUrl).toBe("https://wiadomosci-demo.test/artykul/marek-fikcyjny-wywiad?src=fb1");
    expect(page("c3-07").cloaking?.suspected).toBe(false);
    expect(page("c1-01").cloaking?.suspected).toBe(false);
    expect(run.graph.nodes.find((n) => n.id === "item:c3-01")?.data.cloakingSuspected).toBe(true);
  });

  it.skipIf(!fpcalc.available)("audio fingerprints connect the two C5 videos with the same jingle, not N5", async () => {
    const run = await runSample({ only: ["c5-01", "c5-04", "n-05"], enrich: { audio: true } });
    const audio = run.graph.edges.filter((e) => e.type === "similar_audio");
    expect(audio.map((e) => [e.source, e.target].sort().join(" "))).toEqual(["item:c5-01 item:c5-04"]);
  });
});
