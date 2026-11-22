import { describe, expect, it } from "vitest";
import type { CampaignFacts, FactDomain } from "./facts";
import { buildStixBundle, type StixExtras } from "./stix";

const domain = (over: Partial<FactDomain> & { domain: string }): FactDomain => ({
  created_utc: "2026-08-01T00:00:00.000Z",
  registrar: "Rejestrator Testowy Ltd",
  registrar_iana_id: "9999",
  abuse_email: null,
  nameservers: [],
  ips: [{ ip: "192.0.2.10", asn: 64500, as_name: "HOSTING-TEST" }],
  cert_status: "active",
  cert_insert_date: "2026-10-10T00:00:00.000Z",
  ads: 2,
  payment_identifiers: ["btc:bc1qsyntetyczny"],
  contact_points: ["+48 600 000 000"],
  shared_infrastructure: false,
  ...over,
});

const facts: CampaignFacts = {
  campaignId: "K07",
  packageId: "pkg-1",
  createdUtc: "2026-11-19T12:00:00.000Z",
  firstSeenUtc: "2026-09-05T00:00:00.000Z",
  lastSeenUtc: "2026-10-20T00:00:00.000Z",
  ads: [{ item_id: "a1", platform: "facebook", ad_ids: { ad_id: "a1", ad_library_id: "1000000000000101" }, ad_urls: [], first_seen_utc: null, last_seen_utc: null }],
  domains: [domain({ domain: "oferta.example" }), domain({ domain: "cdn.example", shared_infrastructure: true })],
  personas: ["Adam Testowy"],
  financialOffer: true,
  deepfake: true,
  priorReports: 0,
};
const extras: StixExtras = { tlp: "TLP:AMBER", urls: ["https://oferta.example/start?x=1"], imageHashes: ["ffff0000ffff0000"], modelNotes: ["wynik deepfake 0,93 (wynik modelu, wskazówka)"], certRegisterIds: { "oferta.example": "4711" } };

type Obj = Record<string, unknown> & { type: string; id: string };
const bundle = buildStixBundle(facts, extras);
const objs = bundle.objects as Obj[];
const of = (t: string) => objs.filter((o) => o.type === t);

describe("buildStixBundle", () => {
  it("is a STIX 2.1 bundle with well-formed ids and the required properties on every object", () => {
    expect(bundle.type).toBe("bundle");
    expect(bundle.id).toMatch(/^bundle--[0-9a-f-]{36}$/);
    for (const o of objs) {
      expect(o.id, o.type).toMatch(new RegExp(`^${o.type}--[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`));
      if (o.type !== "marking-definition") {
        expect(o.spec_version).toBe("2.1");
        expect(o.created).toMatch(/Z$/);
        expect(o.modified).toMatch(/Z$/);
      }
    }
  });

  it("has a Campaign, indicators for domain, URL, IP, wallet, phone, ad ID and image hash, and the person as a target", () => {
    expect(of("campaign")).toHaveLength(1);
    const patterns = of("indicator").map((i) => String(i.pattern));
    expect(patterns).toEqual(
      expect.arrayContaining([
        "[domain-name:value = 'oferta.example']",
        "[url:value = 'https://oferta.example/start?x=1']",
        "[ipv4-addr:value = '192.0.2.10']",
        expect.stringContaining("bc1qsyntetyczny"),
        expect.stringContaining("+48 600 000 000"),
        expect.stringContaining("1000000000000101"),
        expect.stringContaining("ffff0000ffff0000"),
      ]),
    );
    expect(patterns.some((p) => p.includes("cdn.example"))).toBe(false);
    expect(of("indicator").every((i) => i.pattern_type === "stix" && typeof i.valid_from === "string")).toBe(true);
    expect(of("identity")[0]).toMatchObject({ name: "Adam Testowy", identity_class: "individual" });
    expect(of("note")).toHaveLength(1);
  });

  it("links every indicator to the campaign and the campaign to the person, with all references resolvable", () => {
    const ids = new Set(objs.map((o) => o.id));
    const rels = of("relationship") as Array<Obj & { relationship_type: string; source_ref: string; target_ref: string }>;
    for (const r of rels) {
      expect(ids.has(r.source_ref), r.source_ref).toBe(true);
      expect(ids.has(r.target_ref), r.target_ref).toBe(true);
    }
    const campaign = of("campaign")[0].id;
    expect(rels.filter((r) => r.relationship_type === "indicates" && r.target_ref === campaign)).toHaveLength(of("indicator").length);
    expect(rels.some((r) => r.relationship_type === "targets" && r.source_ref === campaign && r.target_ref === of("identity")[0].id)).toBe(true);
  });

  it("carries the TLP 2.0 marking on every object and the custom fields for the ad library and CERT register", () => {
    const marking = of("marking-definition")[0];
    expect(marking).toMatchObject({ name: "TLP:AMBER" });
    for (const o of objs.filter((x) => x.type !== "marking-definition")) expect(o.object_marking_refs, o.type).toEqual([marking.id]);
    expect(of("indicator").find((i) => String(i.pattern).includes("1000000000000101"))).toMatchObject({ x_ad_library_id: "1000000000000101" });
    expect(of("indicator").find((i) => String(i.pattern).includes("oferta.example'"))).toMatchObject({ x_cert_register_position_id: "4711" });
  });

  it("escapes quotes and backslashes in pattern values and is deterministic", () => {
    const b = buildStixBundle({ ...facts, domains: [] }, { ...extras, urls: ["https://x.example/it's\\a"] });
    expect(JSON.stringify(b)).toContain("it\\\\'s\\\\\\\\a");
    expect(JSON.stringify(buildStixBundle(facts, extras))).toBe(JSON.stringify(bundle));
  });
});
