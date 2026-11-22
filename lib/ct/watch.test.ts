import { describe, expect, it } from "vitest";
import type { CampaignsFile } from "../graph/model";
import type { EnrichmentSources } from "../pipeline/sources";
import { DEFAULT_CT_CONFIG } from "./config";
import type { CampaignInfra } from "./confirm";
import type { CtFeedRecord } from "./feed";
import { buildFingerprints } from "./fingerprint";
import type { CtStreamEvent } from "./stream";
import { CtWatcher } from "./watch";

const campaigns = {
  campaigns: [{ id: "K01", size: 2, members: [], domains: ["finance12-dolorem51.example", "finance88-quia40.example"], advertisers: [], attributes: { personas: [] } }],
  assignments: {},
} as unknown as CampaignsFile;
const set = buildFingerprints(campaigns, { config: { ...DEFAULT_CT_CONFIG } });
const infra = new Map<string, CampaignInfra>([["K01", { campaignId: "K01", nsPairs: ["ns1.k.test|ns2.k.test"], registrars: [], registrationHours: { from: 18, to: 18 }, ips: [], pageHashes: [] }]]);
const event = (...domains: string[]): CtStreamEvent => ({ domains, seenUtc: null, issuer: null, notBefore: null, notAfter: null, fingerprint: null, serial: null, logName: null, logUrl: null, certIndex: null, updateType: null });
const sources = (ns: string[], created: string): EnrichmentSources =>
  ({
    mode: "offline",
    dns: async (name: string) => ({ name, a: [], aaaa: [], cname: [], ns, mx: [], txt: [], errors: {} }),
    rdap: async () => ({ domain: "", registrar: "R", registrarIanaId: null, created, expires: null, updated: null, status: [], nameservers: [], abuseEmail: null, source: null }),
    ct: async () => null,
  }) as unknown as EnrichmentSources;

async function run(ns: string[], created: string): Promise<CtFeedRecord> {
  const found: CtFeedRecord[] = [];
  const w = new CtWatcher({ set, feedFile: null, source: "replay", enrich: { sources: sources(ns, created) }, infra, onCandidate: (r) => found.push(r) });
  w.handle(event("finance23-voluptas94.example"));
  await w.flush();
  return found[0];
}

describe("CtWatcher: potwierdzenie infrastrukturą", () => {
  it("kandydat z parą NS i godziną rejestracji kampanii dostaje status confirmed z potwierdzeniami", async () => {
    const r = await run(["ns1.k.test", "ns2.k.test"], "2026-11-20T18:20:00Z");
    expect(r.status).toBe("confirmed");
    expect(r.candidate.confirmations).toHaveLength(2);
  });

  it("kandydat tylko z pasującą nazwą zostaje kandydatem; jedna cecha infrastruktury to jeszcze nie potwierdzenie", async () => {
    const plain = await run(["ns.inny.test"], "2026-11-20T03:00:00Z");
    expect(plain.status).toBe("candidate");
    expect(plain.candidate.confirmations).toBeUndefined();
    const one = await run(["ns1.k.test", "ns2.k.test"], "2026-11-20T03:00:00Z");
    expect(one.status).toBe("candidate");
    expect(one.candidate.confirmations).toHaveLength(1);
  });
});
