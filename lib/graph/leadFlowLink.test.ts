import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset, type TestItemSpec } from "./testkit";

function run(specs: TestItemSpec[]) {
  return clusterCampaigns(buildEvidenceGraph(makeDataset(specs), { textMethod: "none" }));
}
const FORM = "form:0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("lead funnel of a landing-page platform (B-332)", () => {
  it("the same form on two pages is a lead_flow node, a page-kit trait that does not merge campaigns alone", () => {
    const res = run([
      { id: "a", url: "https://alpha.example/", kit: { leadFlow: [FORM, "key:KEY-001"] } },
      { id: "b", url: "https://beta.test/", kit: { leadFlow: [FORM, "key:KEY-001"] } },
      { id: "c", url: "https://gamma.test/", kit: { leadFlow: ["form:ffffffff-4e5f-4a6b-8c7d-9e0f1a2b3c4d"] } },
    ]);
    const nodes = res.graph.nodes.filter((n) => n.type === "lead_flow");
    expect(nodes.map((n) => n.key)).toEqual(expect.arrayContaining([FORM, "key:KEY-001"]));
    expect(res.campaigns.assignments.a).not.toBe(res.campaigns.assignments.b);
  });
});

describe("page and creative attributes (B-334, B-335, B-337, B-338)", () => {
  it("back library, SVG script and the address in it end up as attributes and a url node", () => {
    const res = run([{ id: "a", url: "https://alpha.example/", kit: { backLib: ["vitBack"], svgScript: { urls: ["https://cdn.example.test/x.js"] } } }]);
    const item = res.graph.nodes.find((n) => n.type === "item" && n.key === "a");
    expect(item?.data.backLib).toEqual(["vitBack"]);
    expect(item?.data.svgScript).toBe(true);
    expect(res.graph.nodes.some((n) => n.type === "url" && n.key.includes("cdn.example.test"))).toBe(true);
  });
});
