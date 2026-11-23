import { describe, expect, it } from "vitest";
import type { CampaignsFile } from "../graph/model";
import type { EnrichedDataset } from "../pipeline/types";
import { buildCampaignInfra, confirmCandidate } from "./confirm";
import type { CandidateEnrichment } from "./feed";

const camp = (id: string, domains: string[]) => ({ id, size: domains.length, members: [], domains }) as unknown as CampaignsFile["campaigns"][number];
const campaigns = { campaigns: [camp("K01", ["a1.example", "a2.example"]), camp("K02", ["b1.example"])] } as unknown as CampaignsFile;
const rdap = (registrar: string, created: string) => ({ domain: "", registrar, registrarIanaId: null, created, expires: null, updated: null, status: [], nameservers: [], abuseEmail: null, source: null });
const ds = {
  items: [],
  perItem: {},
  pages: {
    "https://a1.example/": { requestedUrl: "https://a1.example/", fetch: { bodySha256: "h".repeat(64) } },
    "https://b1.example/": { requestedUrl: "https://b1.example/", fetch: { bodySha256: "g".repeat(64) } },
  },
  hosts: {
    "a1.example": { host: "a1.example", registrableDomain: "a1.example", ips: ["192.0.2.10"] },
    "b1.example": { host: "b1.example", registrableDomain: "b1.example", ips: ["192.0.2.20"] },
  },
  domains: {
    "a1.example": { domain: "a1.example", ns: ["ns1.k.test", "ns2.k.test"], rdap: rdap("Registrar Jeden", "2026-11-01T18:10:00Z") },
    "a2.example": { domain: "a2.example", ns: ["ns1.k.test", "ns2.k.test"], rdap: rdap("Registrar Jeden", "2026-11-02T18:40:00Z") },
    "b1.example": { domain: "b1.example", ns: ["ns1.wspolny.test"], rdap: rdap("Registrar Jeden", "2026-11-03T03:00:00Z") },
  },
  ips: {},
} as unknown as EnrichedDataset;

const candidate = (over: Partial<CandidateEnrichment> = {}): CandidateEnrichment => ({
  dns: { a: ["192.0.2.99"], aaaa: [], cname: [], ns: ["NS1.K.TEST.", "ns2.k.test"], mx: [] },
  hosts: [],
  rdap: { registrar: "Registrar Jeden", created: "2026-11-20T18:20:00Z", expires: null, status: [], nameservers: [] },
  ct: null,
  page: null,
  errors: [],
  skipped: null,
  ...over,
});

describe("potwierdzenie kandydata CT po infrastrukturze kampanii", () => {
  const infra = buildCampaignInfra(ds, campaigns);

  it("kampania ma parę NS i okno godzin rejestracji; rejestrator wspólny z inną kampanią nie jest jej cechą", () => {
    expect(infra.get("K01")).toMatchObject({ nsPairs: ["ns1.k.test|ns2.k.test"], registrationHours: { from: 18, to: 18 }, ips: ["192.0.2.10"] });
    expect(infra.get("K01")?.registrars).toEqual([]);
    expect(infra.get("K02")?.registrationHours).toBeNull();
  });

  it("ta sama para NS i godzina rejestracji w oknie → confirmed, z opisem każdej cechy", () => {
    const r = confirmCandidate(candidate(), infra.get("K01")!);
    expect(r.confirmed).toBe(true);
    expect(r.confirmations).toEqual(["same name server pair (ns1.k.test, ns2.k.test)", "registered at 18:00 UTC, within the campaign hour window (17–19)"]);
  });

  it("jedna cecha to jeszcze nie potwierdzenie, a domena innej infrastruktury nie ma żadnej", () => {
    const oneKind = confirmCandidate(candidate({ rdap: { registrar: "X", created: "2026-11-20T03:00:00Z", expires: null, status: [], nameservers: [] } }), infra.get("K01")!);
    expect(oneKind.confirmations).toHaveLength(1);
    expect(oneKind.confirmed).toBe(false);
    const other = confirmCandidate(candidate({ dns: { a: [], aaaa: [], cname: [], ns: ["ns.inny.test"], mx: [] }, rdap: null }), infra.get("K01")!);
    expect(other).toEqual({ confirmations: [], confirmed: false });
  });

  it("ten sam adres IP i ten sam skrót strony (przy --fetch-page) to cechy kampanii", () => {
    const e = candidate({
      dns: { a: ["192.0.2.10"], aaaa: [], cname: [], ns: [], mx: [] },
      rdap: null,
      page: { url: "https://x.example/", status: 200, final_url: null, title: "Dowolny tytuł", body_sha256: "h".repeat(64), error: null },
    });
    const r = confirmCandidate(e, infra.get("K01")!);
    expect(r.confirmed).toBe(true);
    expect(r.confirmations.join(" | ")).toContain("192.0.2.10");
    expect(r.confirmations.join(" | ")).toContain("page body hash");
    expect(r.confirmations.join(" | ")).not.toContain("title");
  });
});
