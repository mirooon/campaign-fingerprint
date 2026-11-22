import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset, type TestInfra, type TestItemSpec } from "./testkit";

// MX records as a pivot (B-177) on synthetic domains: reserved names only.

/** Clusters synthetic items with the given DNS data. */
function run(specs: TestItemSpec[], infra: TestInfra) {
  return clusterCampaigns(buildEvidenceGraph(makeDataset(specs, infra), { textMethod: "none" }));
}
const same = (res: ReturnType<typeof run>, a: string, b: string) => res.campaigns.assignments[a] === res.campaigns.assignments[b];
const mxLink = (res: ReturnType<typeof run>) => res.graph.links.find((l) => l.evidence.some((e) => e.pivotType === "mx"));
const alpha = { id: "a", url: "https://alpha.test/" };
const beta = { id: "b", url: "https://beta.test/" };

describe("MX pivot (B-177)", () => {
  it("the same own mail server plus another shared trace links the domains", () => {
    const res = run(
      [{ ...alpha, emails: ["kontakt@shared.example.test"] }, { ...beta, emails: ["kontakt@shared.example.test"] }],
      { mx: { "alpha.test": ["mail.own-mx.test"], "beta.test": ["mail.own-mx.test"] } },
    );
    expect(mxLink(res)).toBeDefined();
    expect(same(res, "a", "b")).toBe(true);
  });

  it("the same own mail server alone does not join a campaign (notAlone)", () => {
    const res = run([alpha, beta], { mx: { "alpha.test": ["mail.own-mx.test"], "beta.test": ["mail.own-mx.test"] } });
    expect(res.graph.nodes.filter((n) => n.type === "mx")).toHaveLength(1);
    expect(same(res, "a", "b")).toBe(false);
  });

  it("a Google MX gives nothing, even with another shared trace", () => {
    const res = run(
      [{ ...alpha, emails: ["kontakt@shared.example.test"] }, { ...beta, emails: ["kontakt@shared.example.test"] }],
      { mx: { "alpha.test": ["aspmx.l.google.com"], "beta.test": ["aspmx.l.google.com"] } },
    );
    const ev = mxLink(res)?.evidence.find((e) => e.pivotType === "mx");
    expect(!ev || (ev.discounted && ev.weight < 0.1)).toBe(true);
  });
});
