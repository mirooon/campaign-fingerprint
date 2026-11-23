import { describe, expect, it } from "vitest";
import type { CampaignFacts, FactDomain } from "./facts";
import { renderKnfNotice, renderPreservationRequest, renderProsecutorNotice } from "./views";

const domain = (over: Partial<FactDomain> & { domain: string }): FactDomain => ({
  created_utc: "2026-08-01T00:00:00.000Z",
  registrar: "Rejestrator Testowy Ltd",
  registrar_iana_id: "9999",
  abuse_email: "abuse@rejestrator.example",
  nameservers: ["ns1.hosting.example"],
  ips: [{ ip: "192.0.2.10", asn: 64500, as_name: "HOSTING-TEST" }],
  cert_status: "absent",
  cert_insert_date: null,
  ads: 3,
  payment_identifiers: [],
  contact_points: [],
  shared_infrastructure: false,
  ...over,
});

const facts = (over: Partial<CampaignFacts> = {}): CampaignFacts => ({
  campaignId: "K07",
  packageId: "pkg-1",
  createdUtc: "2026-11-19T12:00:00.000Z",
  firstSeenUtc: "2026-09-05T00:00:00.000Z",
  lastSeenUtc: "2026-10-20T00:00:00.000Z",
  ads: [
    { item_id: "a1", platform: "facebook", ad_ids: { ad_id: "a1" }, ad_urls: [], first_seen_utc: "2026-09-05T00:00:00.000Z", last_seen_utc: "2026-09-06T00:00:00.000Z" },
    { item_id: "a2", platform: "youtube", ad_ids: { ad_id: "a2" }, ad_urls: [], first_seen_utc: "2026-10-01T00:00:00.000Z", last_seen_utc: "2026-10-20T00:00:00.000Z" },
  ],
  domains: [domain({ domain: "oferta.example" }), domain({ domain: "cdn.example", shared_infrastructure: true })],
  personas: ["Adam Testowy"],
  financialOffer: true,
  deepfake: false,
  priorReports: 0,
  ...over,
});

describe("renderPreservationRequest", () => {
  it("lists providers per platform and per domain with time ranges in UTC and the data categories", () => {
    const md = renderPreservationRequest(facts());
    expect(md).toMatch(/facebook/i);
    expect(md).toMatch(/youtube/i);
    expect(md).toContain("oferta.example");
    expect(md).toContain("abuse@rejestrator.example");
    expect(md).toContain("2026-09-05");
    expect(md).toMatch(/registrant data|subscriber data|logs/i);
    expect(md).not.toContain("[FILL IN");
  });
  it("leaves out domains on shared infrastructure, which do not identify an operator", () => {
    expect(renderPreservationRequest(facts())).not.toContain("cdn.example");
  });
});

describe("renderKnfNotice", () => {
  it("names the brands, domains, offer, payments and scale; says nothing when the offer is not financial", () => {
    const md = renderKnfNotice(facts({ domains: [domain({ domain: "oferta.example", payment_identifiers: ["btc:bc1qsyntetyczny"] })] }))!;
    expect(md).toContain("Adam Testowy");
    expect(md).toContain("oferta.example");
    expect(md).toContain("bc1qsyntetyczny");
    expect(md).toMatch(/2 ads/);
    expect(renderKnfNotice(facts({ financialOffer: false }))).toBeNull();
  });
});

describe("renderProsecutorNotice", () => {
  it("states the grounds of the campaign and who may file, with the CERT status and dates", () => {
    const md = renderProsecutorNotice(facts({ domains: [domain({ domain: "oferta.example", cert_status: "active", cert_insert_date: "2026-10-10T00:00:00.000Z" })] }));
    expect(md).toMatch(/Art\. 286/);
    expect(md).toMatch(/Art\. 190a/);
    expect(md).toMatch(/injured|person whose image/i);
    expect(md).toContain("2026-10-10");
    expect(md).not.toContain("[FILL IN");
  });
  it("does not cite the impersonation article when no person is named", () => {
    expect(renderProsecutorNotice(facts({ personas: [] }))).not.toMatch(/190a/);
  });
});
