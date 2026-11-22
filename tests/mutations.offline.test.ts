/**
 * Robustness to deliberate mutations (B-291): an operator who randomises link parameters, edits the copy,
 * swaps the background or adds a sticker, and moves to a new domain behind the same tracker and backend
 * stays one campaign; two operators who share only a link and page template stay two campaigns (at most
 * one group of similar campaigns). Guards the content and variant rules. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { encodeXid } from "../lib/osint/clickIds";
import type { LanderConfig } from "../lib/osint/landerConfig";
import { clusterCampaigns } from "../lib/graph/cluster";
import { buildEvidenceGraph } from "../lib/graph/link";
import { endpointRef, makeDataset, type TestInfra, type TestItemSpec } from "../lib/graph/testkit";

const xid = (machine: string, counter: number) => encodeXid({ time: "2026-10-02T09:00:00Z", machine, pid: 4242, counter });
const PIXEL = { kind: "meta_pixel" as const, id: "990011223344556" };
const BACKEND = "https://leady.operator-k.example/api/9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f/lead";
const COPY = "Pan Adam Testowy zdradził w wywiadzie, jak zarobić na nowej platformie inwestycyjnej. Zarejestruj się dziś.";

/** One ad of operator K: tracker pixel, xid machine and form backend are the operator's; the rest mutates. */
function k(id: string, host: string, over: Partial<TestItemSpec> = {}): TestItemSpec {
  const url = `https://${host}/lp/?sub1=${id}x${id.length}q&clickid=${xid("a1b2c3", 1000 + id.length * 37)}`;
  return { id, url, text: COPY, dhash: "f0f0f0f0f0f0f0f0", trackers: [PIXEL], kit: { endpoints: [endpointRef(BACKEND, url)] }, ...over };
}

function run(specs: TestItemSpec[], infra: TestInfra = {}) {
  return clusterCampaigns(buildEvidenceGraph(makeDataset(specs, infra)));
}

describe("one operator under deliberate mutations stays one campaign", () => {
  const specs = [
    k("k0", "zdrowie-k.example"),
    k("k1", "zdrowie-k.example", { url: "https://zdrowie-k.example/lp/?sub1=Zq81Lm&sub2=pp0912&clickid=" + xid("a1b2c3", 77) }),
    k("k2", "zdrowie-k.example", { text: "Pan Adam Testowy zdradził w rozmowie, jak zarobić na nowej platformie inwestycyjnej. Zapisz się jeszcze dziś!" }),
    k("k3", "zdrowie-k.example", { dhash: "f0f0f0f0f0f0f0ff" }),
    k("k4", "zdrowie-k.example", { dhash: "f0f0f0f0f0f0f0f7" }),
    k("k5", "nowa-domena-k.test"),
    k("k6", "trzecia-domena-k.example", { text: "Zupełnie inny tekst o oszczędzaniu i emeryturze, bez nazwisk.", dhash: "0f0f0f0f0f0f0f0f" }),
  ];

  it("keeps all seven mutations in one campaign", () => {
    const res = run(specs);
    const ids = specs.map((s) => res.campaigns.assignments[s.id]);
    expect(new Set(ids).size).toBe(1);
    expect(res.campaigns.campaigns[0].attributes.basis).toBe("infrastructure");
  });
});

describe("two operators sharing only a link and page template stay apart", () => {
  const owner = (id: string, uuid: string): LanderConfig => ({
    platform: "aio",
    ownerId: uuid,
    campaignId: null,
    campaignName: null,
    campaignNumber: null,
    landingId: null,
    landingName: null,
    templateId: "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a",
    landerTypeId: null,
    sourceId: id,
    sourceName: null,
  });
  const asset = (host: string) => ({ key: "/szablon/app-portal.js", url: `https://${host}/szablon/app-portal.js`, host, path: "/szablon/app-portal.js", basename: "app-portal.js", kind: "js" as const, sameOrigin: true });
  const op = (id: string, host: string, account: string, n: number): TestItemSpec => ({
    id,
    url: `https://${host}/?sub1=Qw${n}Er${n}Ty&sub2=As${n}Df${n}Gh&clickid=Zx${n}Cv${n}Bn${n}`,
    text: COPY,
    kit: { lander: owner(id, account), assets: [asset(host)], domSimhash: "00ff00ff00ff00ff" },
  });
  const infra: TestInfra = {
    hosts: { "portal-x.example": ["192.0.2.10"], "kurier-x.example": ["192.0.2.10"], "portal-y.test": ["192.0.2.200"] },
    ns: { "portal-x.example": ["ns1.dns-x.example", "ns2.dns-x.example"], "kurier-x.example": ["ns1.dns-x.example", "ns2.dns-x.example"], "portal-y.test": ["ns1.dns-y.test", "ns2.dns-y.test"] },
  };

  it("makes two campaigns and at most one group of similar campaigns", () => {
    const X = "11111111-2222-4333-8444-555555555555";
    const Y = "66666666-7777-4888-9999-aaaaaaaaaaaa";
    const res = run([op("x1", "portal-x.example", X, 1), op("x2", "kurier-x.example", X, 2), op("y1", "portal-y.test", Y, 3)], infra);
    const a = res.campaigns.assignments;
    expect(a.x1).toBe(a.x2);
    expect(a.y1).not.toBe(a.x1);
    const families = (res.campaigns.families ?? []).filter((f) => f.campaigns.includes(a.x1) || f.campaigns.includes(a.y1));
    expect(families.length).toBeLessThanOrEqual(1);
  });
});
