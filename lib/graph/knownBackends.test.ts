import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { knownBackendLabel } from "./knownBackends";
import { endpointRef, makeDataset } from "./testkit";

const premiseOf = (host: string) => {
  const ep = (page: string) => endpointRef(`https://${host}/api/v1/submit/0b9a5c3e-1d2f-4a6b-9c8d-7e6f5a4b3c2d/`, page);
  const { graph } = clusterCampaigns(
    buildEvidenceGraph(makeDataset([{ id: "a", url: "https://alpha.example/", kit: { endpoints: [ep("https://alpha.example/")] } }, { id: "b", url: "https://beta.example/", kit: { endpoints: [ep("https://beta.example/")] } }]), { textMethod: "none" }),
  );
  return graph.links[0].evidence.find((e) => e.pivotType === "endpoint")!;
};

describe("known lead backends", () => {
  it("labels a host from the list, subdomains too, and nothing else", () => {
    expect(knownBackendLabel("getyourapi.site")).toContain("Infoblox");
    expect(knownBackendLabel("v2.GetYourApi.site")).toContain("source");
    expect(knownBackendLabel("nieznany.example")).toBeNull();
  });

  it("puts the label and the source on the premise without changing its weight", () => {
    const known = premiseOf("getyourapi.site");
    const other = premiseOf("leads-api.test");
    expect(known.evidence).toContain("known lead backend");
    expect(known.evidence).toContain("Infoblox");
    expect(other.evidence).not.toContain("known lead backend");
    expect(known.weight).toBe(other.weight);
  });
});
