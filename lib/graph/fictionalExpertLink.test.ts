import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset, type TestItemSpec } from "./testkit";

// Fictional experts of B-313 on synthetic cases: invented names, reserved domains only.

function run(specs: TestItemSpec[]) {
  return clusterCampaigns(buildEvidenceGraph(makeDataset(specs), { textMethod: "none" }));
}
const same = (res: ReturnType<typeof run>, a: string, b: string) => res.campaigns.assignments[a] === res.campaigns.assignments[b];
const experts = (res: ReturnType<typeof run>) => res.graph.nodes.filter((n) => n.type === "fictional_expert");

describe("fictional expert as a pivot", () => {
  it("a name and its typo on different domains give one fictional_expert node that links the cases", () => {
    const res = run([
      { id: "a", url: "https://alpha.example/", text: "Metodę poleca dr Jan Testowy z kliniki." },
      { id: "b", url: "https://beta.test/", text: "Według dr Jan Testowyy to działa." },
      { id: "c", url: "https://gamma.test/", text: "Zupełnie inna reklama bez eksperta." },
    ]);
    expect(experts(res)).toHaveLength(1);
    expect(same(res, "a", "b")).toBe(true);
    expect(same(res, "a", "c")).toBe(false);
  });

  it("a person of the public list is no pivot", () => {
    const res = run([
      { id: "a", url: "https://alpha.example/", text: "Prof. Rafał Brzóska radzi inwestować." },
      { id: "b", url: "https://beta.test/", text: "Prof. Rafał Brzóska radzi inwestować." },
    ]);
    expect(experts(res)).toHaveLength(0);
  });

  it("the same name in the OCR text of a screenshot counts like text", () => {
    const res = run([
      { id: "a", url: "https://alpha.example/", ocrText: "dr Jan Testowy: bierz to codziennie" },
      { id: "b", url: "https://beta.test/", text: "Dr Jan Testowy ostrzega" },
    ]);
    expect(experts(res)).toHaveLength(1);
  });

  it("a name in a large share of the cases is damped by IDF", () => {
    const score = (r: ReturnType<typeof run>, a: string, b: string) => r.graph.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))?.score ?? 0;
    const rare = run([
      { id: "a", url: "https://alpha.example/", text: "dr Jan Testowy radzi" },
      { id: "b", url: "https://beta.test/", text: "dr Jan Testowy radzi" },
      ...Array.from({ length: 28 }, (_, i) => ({ id: `x${i}`, url: `https://x${i}.test/`, text: `reklama numer ${i}` })),
    ]);
    const common = run(Array.from({ length: 30 }, (_, i) => ({ id: i === 0 ? "a" : i === 1 ? "b" : `y${i}`, url: `https://y${i}.test/`, text: "dr Jan Testowy radzi" })));
    expect(score(rare, "a", "b")).toBeGreaterThan(0.6);
    expect(score(common, "a", "b")).toBeLessThan(score(rare, "a", "b"));
  });
});
