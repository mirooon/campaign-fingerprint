import { describe, expect, it } from "vitest";
import type { CampaignFacts, FactDomain } from "./facts";
import { recipientFiles } from "./recipients";

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
  ads: [{ item_id: "a1", platform: "facebook", ad_ids: { ad_id: "a1", ad_library_id: "1000000000000101" }, ad_urls: ["https://www.facebook.com/ads/library/?id=1000000000000101"], first_seen_utc: null, last_seen_utc: null }],
  domains: [
    domain({ domain: "oferta.example", payment_identifiers: ["btc:bc1qsyntetyczny"], contact_points: ["+48 600 000 000", "kontakt@oferta.example"] }),
    domain({ domain: "druga.example", registrar: null, abuse_email: null }),
    domain({ domain: "cdn.example", shared_infrastructure: true }),
  ],
  personas: ["Adam Testowy"],
  financialOffer: true,
  deepfake: false,
  priorReports: 0,
  ...over,
});

const byName = (files: Array<{ file: string; content: string }>) => Object.fromEntries(files.map((f) => [f.file, f.content]));

describe("recipientFiles", () => {
  const files = byName(recipientFiles(facts()));

  it("writes the registrar file with domains and the abuse contact, and leaves shared infrastructure out", () => {
    const csv = files["wskazniki/rejestrator.csv"];
    expect(csv.split("\n")[0]).toBe("domena,rejestrator,iana_id,abuse_email,utworzona_utc,reklam_w_kampanii");
    expect(csv).toContain("oferta.example,Rejestrator Testowy Ltd,9999,abuse@rejestrator.example");
    expect(csv).not.toContain("cdn.example");
  });

  it("writes hosting, platform, payment and operator files with the right indicators only", () => {
    expect(files["wskazniki/hosting.csv"]).toContain("192.0.2.10,64500,HOSTING-TEST,oferta.example");
    expect(files["wskazniki/platforma.csv"]).toContain("facebook,a1,1000000000000101,https://www.facebook.com/ads/library/?id=1000000000000101");
    expect(files["wskazniki/platnosci.csv"]).toContain("btc,bc1qsyntetyczny,oferta.example");
    expect(files["wskazniki/operator.csv"]).toContain("+48 600 000 000,oferta.example");
    expect(files["wskazniki/operator.csv"]).not.toContain("kontakt@oferta.example");
  });

  it("proposes recipients with a reason, conditionally", () => {
    const md = files["odbiorcy.md"];
    expect(md).toMatch(/UODO[\s\S]*Adam Testowy/);
    expect(md).toMatch(/KNF[\s\S]*ofert/);
    expect(md).toMatch(/UKE[^\n]*po wcześniejszym zgłoszeniu/);
    const none = byName(recipientFiles(facts({ personas: [], financialOffer: false })))["odbiorcy.md"];
    expect(none).not.toMatch(/UODO/);
    expect(none).not.toMatch(/KNF/);
  });

  it("does not write a file for an indicator the campaign lacks", () => {
    const names = recipientFiles(facts({ domains: [domain({ domain: "x.example" })] })).map((f) => f.file);
    expect(names).not.toContain("wskazniki/platnosci.csv");
    expect(names).not.toContain("wskazniki/operator.csv");
  });
});
