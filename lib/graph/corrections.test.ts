import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "./cluster";
import { ANALYST_PREMISE, clusterWithCorrections, emptyCorrections, loadCorrections, parseCorrections } from "./corrections";
import { buildEvidenceGraph } from "./link";
import { makeDataset } from "./testkit";

/** Three ads on one domain (a strong link each) and one unrelated ad. */
const graph = () =>
  buildEvidenceGraph(
    makeDataset([
      { id: "a", url: "https://lander-one.example/x" },
      { id: "b", url: "https://lander-one.example/y" },
      { id: "c", url: "https://lander-one.example/z" },
      { id: "d", url: "https://other-site.example/q" },
    ]),
    { textMethod: "none" },
  );

const premises = (g: ReturnType<typeof graph>, a: string, b: string) =>
  g.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))?.evidence.map((e) => e.evidence) ?? [];

describe("analyst corrections (B-281)", () => {
  it("is plain clustering without corrections", () => {
    const g = graph();
    const plain = clusterCampaigns(g).campaigns.assignments;
    const corrected = clusterWithCorrections(g, emptyCorrections()).campaigns.assignments;
    expect(corrected).toEqual(plain);
    expect(plain.a).toBe(plain.b);
  });

  it("puts a cannot-link pair into different campaigns, with the analyst premise", () => {
    const res = clusterWithCorrections(graph(), { ...emptyCorrections(), cannotLink: [{ a: "a", b: "b" }] });
    const as = res.campaigns.assignments;
    expect(as.a).not.toBe(as.b);
    expect(premises(res.graph, "a", "b").some((p) => p.startsWith(ANALYST_PREMISE))).toBe(true);
    const ca = res.campaigns.campaigns.find((c) => c.id === as.a)!;
    expect(ca.analystNotes?.[0]).toContain(ANALYST_PREMISE);
    expect(res.campaigns.method.rules?.at(-1)).toContain(ANALYST_PREMISE);
  });

  it("joins a must-link pair with a strong analyst link", () => {
    const res = clusterWithCorrections(graph(), { ...emptyCorrections(), mustLink: [{ a: "a", b: "d", note: "ten sam operator" }] });
    expect(res.campaigns.assignments.a).toBe(res.campaigns.assignments.d);
    expect(premises(res.graph, "a", "d").some((p) => p.startsWith(`${ANALYST_PREMISE}: linked`))).toBe(true);
  });

  it("lets cannot-link win over must-link", () => {
    const res = clusterWithCorrections(graph(), { ...emptyCorrections(), mustLink: [{ a: "a", b: "b" }], cannotLink: [{ a: "b", b: "a" }] });
    expect(res.campaigns.assignments.a).not.toBe(res.campaigns.assignments.b);
  });

  it("stops counting a disabled pivot", () => {
    const g = graph();
    const pivot = g.links.find((l) => l.a === "a" && l.b === "b")!.evidence.find((e) => e.pivotType === "domain")!.pivot!;
    const res = clusterWithCorrections(g, { ...emptyCorrections(), disabledPivots: [{ pivot }] });
    const remaining = res.graph.links.find((l) => l.a === "a" && l.b === "b");
    expect(remaining?.evidence.some((e) => e.pivot === pivot) ?? false).toBe(false);
    expect(premises(res.graph, "a", "b").some((p) => p === `${ANALYST_PREMISE}: disabled trace ${pivot}`)).toBe(true);
  });

  it("parses short forms and rejects broken pairs", () => {
    expect(parseCorrections({ cannotLink: [["a", "b"]], disabledPivots: ["domain:x.example"] })).toEqual({
      version: 1,
      mustLink: [],
      cannotLink: [{ a: "a", b: "b" }],
      disabledPivots: [{ pivot: "domain:x.example" }],
    });
    expect(() => parseCorrections({ mustLink: [{ a: "a", b: "a" }] })).toThrow();
  });

  it("reads a missing file as no corrections and a file from disk", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "corr-"));
    expect(loadCorrections(path.join(dir, "none.json"))).toEqual(emptyCorrections());
    const file = path.join(dir, "corrections.json");
    writeFileSync(file, JSON.stringify({ version: 1, cannotLink: [{ a: "a", b: "c" }] }));
    expect(loadCorrections(file).cannotLink).toHaveLength(1);
  });
});
