/**
 * Records of two ad libraries (Meta and Google) become materials and join into campaigns by their
 * infrastructure, whatever the platform: one campaign for a shared landing site and form backend, and
 * only a group of similar campaigns for one impersonated person on different infrastructure.
 */
import { describe, expect, it } from "vitest";
import { adRecordToItem } from "../lib/adlib/toItem";
import type { AdRecord } from "../lib/adlib/types";
import { clusterCampaigns } from "../lib/graph/cluster";
import { buildEvidenceGraph } from "../lib/graph/link";
import { endpointRef, makeDataset, type TestItemSpec } from "../lib/graph/testkit";

const AD_TEXT = "Adam Testowy zdradza: platforma KryptoZysk zarabia za mnie dziennie, zarejestruj się dziś";
const BACKEND = "https://leads-api.test/api/v1/submit/0b9a5c3e-1d2f-4a6b-9c8d-7e6f5a4b3c2d/";

const meta = (adId: string, landingUrl: string): AdRecord => ({
  platform: "meta",
  adId,
  libraryUrl: `https://library.example/meta?id=${adId}`,
  fetchedAt: "2026-11-21T10:00:00.000Z",
  advertiser: { name: "Strona Meta", id: "900000000001" },
  creatives: [{ kind: "text", text: AD_TEXT }],
  landingUrl,
});
const google = (adId: string, landingUrl: string, advertiserId = "AR0000000000000000001"): AdRecord => ({
  platform: "google",
  adId,
  libraryUrl: `https://atc.example/advertiser/${advertiserId}/creative/${adId}`,
  fetchedAt: "2026-11-21T10:00:00.000Z",
  advertiser: { name: "Konto Google", id: advertiserId, legalName: "Fikcyjna Firma Sp. z o.o.", location: "PL", verified: true },
  creatives: [{ kind: "text", text: AD_TEXT }],
  landingUrl,
});

/** Dataset spec of a record, the way the pipeline reads it: the material (`adRecordToItem`) plus what the captured page adds. */
function spec(rec: AdRecord, page: Pick<TestItemSpec, "kit" | "personas">): TestItemSpec {
  const it = adRecordToItem(rec);
  return { id: it.id, url: it.landingUrl ?? undefined, text: it.text ?? undefined, advertiser: it.advertiser ?? undefined, extra: it.extra, ...page };
}

function run(specs: TestItemSpec[]) {
  const graph = buildEvidenceGraph(makeDataset(specs));
  return clusterCampaigns(graph);
}

describe("records of different ad libraries", () => {
  it("join one campaign when they share the landing site and the form backend with the client ID", () => {
    const a = meta("1000000000000501", "https://oferta-wspolna.example/a?utm_source=fb");
    const b = google("CR0000000000000000101", "https://oferta-wspolna.example/b");
    const { campaigns } = run([
      spec(a, { kit: { endpoints: [endpointRef(BACKEND, "https://oferta-wspolna.example/a")] } }),
      spec(b, { kit: { endpoints: [endpointRef(BACKEND, "https://oferta-wspolna.example/b")] } }),
    ]);
    expect(campaigns.assignments["meta_1000000000000501"]).toBe(campaigns.assignments["google_CR0000000000000000101"]);
  });

  it("stay in different campaigns of one group of similar campaigns when only the impersonated person is shared", () => {
    const a = meta("1000000000000501", "https://pierwsza-strona.example/");
    const b = google("CR0000000000000000101", "https://druga-strona.example/");
    const persona = { personas: ["Adam Testowy"] };
    const { campaigns } = run([
      spec(a, { ...persona, kit: { endpoints: [endpointRef("https://leads-a.test/api/v1/submit/11111111-1111-4111-8111-111111111111/", "https://pierwsza-strona.example/")] } }),
      spec(b, { ...persona, kit: { endpoints: [endpointRef("https://leads-b.test/api/v1/submit/22222222-2222-4222-8222-222222222222/", "https://druga-strona.example/")] } }),
    ]);
    const idA = "meta_1000000000000501";
    const idB = "google_CR0000000000000000101";
    expect(campaigns.assignments[idA]).not.toBe(campaigns.assignments[idB]);
    expect(campaigns.families?.some((f) => f.members.includes(idA) && f.members.includes(idB))).toBe(true);
  });

  it("make one advertiser node of two Google records with one advertiser ID, with the legal name, country and verification", () => {
    const graph = buildEvidenceGraph(
      makeDataset([
        spec({ ...google("CR0000000000000000101", "https://a.example/"), advertiser: { name: "Nazwa Pierwsza", id: "AR0000000000000000001", legalName: "Fikcyjna Firma Sp. z o.o.", location: "PL", verified: true } }, {}),
        spec({ ...google("CR0000000000000000102", "https://b.example/"), advertiser: { name: "Nazwa Druga", id: "AR0000000000000000001", legalName: "Fikcyjna Firma Sp. z o.o.", location: "PL", verified: true } }, {}),
      ]),
      { textMethod: "none" },
    );
    const advertisers = graph.nodes.filter((n) => n.type === "advertiser");
    expect(advertisers).toHaveLength(1);
    expect(advertisers[0].data).toMatchObject({ legalName: "Fikcyjna Firma Sp. z o.o.", location: "PL", verified: true, names: ["Nazwa Pierwsza", "Nazwa Druga"] });
  });
});
