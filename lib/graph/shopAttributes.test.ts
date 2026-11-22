/**
 * Attributes of a shop page in the graph: they explain and never link. Synthetic data only (.example/.test hosts).
 */
import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset, type TestItemSpec } from "./testkit";

function run(specs: TestItemSpec[], infra = {}) {
  return clusterCampaigns(buildEvidenceGraph(makeDataset(specs, infra), { textMethod: "none" }));
}
const data = (res: ReturnType<typeof run>, id: string) => res.graph.nodes.find((n) => n.id === `item:${id}`)!.data;
const tls = { issuer: "Let's Encrypt R10", validFrom: "2026-10-01T00:00:00Z", validTo: "2026-10-20T00:00:00Z", sanList: ["inny.test"], subjectName: "inny.test" };

describe("infrastructure attributes of the landing page", () => {
  it("keeps the certificate flags and the issuer as features of the material", () => {
    const res = run([{ id: "a", url: "https://sklep.test/", firstSeen: "2026-11-01T00:00:00Z", tls }]);
    expect(data(res, "a")).toMatchObject({ certIssuer: "Let's Encrypt R10", certMismatch: true, certExpired: true });
  });

  it("names the brand in the path and the platform, without linking pages that share them", () => {
    const res = run([
      { id: "a", url: "https://x7k2qp.test/inpost/odbior", cms: ["wordpress"] },
      { id: "b", url: "https://r9m4zt.example/inpost/odbior", cms: ["wordpress"] },
    ]);
    expect(data(res, "a")).toMatchObject({ brandInPath: "inpost", pagePlatforms: ["wordpress"] });
    expect(res.graph.links.filter((l) => l.evidence.some((e) => e.pivotType === "technique"))).toEqual([]);
    expect(res.campaigns.assignments.a).not.toBe(res.campaigns.assignments.b);
  });

  it("marks hosting outside the EU only from the country the enrichment already has", () => {
    const infra = { hosts: { "sklep.test": ["192.0.2.10"], "sklep.example": ["192.0.2.20"] }, asns: { "192.0.2.10": { asn: 64500, asName: "X", country: "US" }, "192.0.2.20": { asn: 64501, asName: "Y", country: "DE" } } };
    const res = run([{ id: "a", url: "https://sklep.test/" }, { id: "b", url: "https://sklep.example/" }], infra);
    expect(data(res, "a").hostingOutsideEu).toBe("US");
    expect(data(res, "b").hostingOutsideEu).toBeUndefined();
  });
});
