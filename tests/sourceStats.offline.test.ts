/**
 * Source statistics (how many in-campaign links each pivot type gave) on a synthetic graph.json.
 */
import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "../lib/graph/cluster";
import { buildEvidenceGraph } from "../lib/graph/link";
import { makeDataset } from "../lib/graph/testkit";
import type { EvidenceGraph } from "../lib/graph/model";
import { sourceStats, sourceStatsMarkdown } from "../lib/pipeline/sourceStats";

function graph(): EvidenceGraph {
  const ds = makeDataset(
    [
      { id: "a", url: "https://alfa-oferta.test/1", trackers: [{ kind: "ga4", id: "G-ALFA111111" }] },
      { id: "b", url: "https://alfa-oferta.test/2", trackers: [{ kind: "ga4", id: "G-ALFA111111" }] },
      { id: "c", url: "https://beta-oferta.test/1", trackers: [{ kind: "ga4", id: "G-BETA222222" }] },
      { id: "d", url: "https://beta-oferta.test/2", trackers: [{ kind: "ga4", id: "G-BETA222222" }] },
      { id: "e", url: "https://gamma.test/" },
    ],
    {},
  );
  return clusterCampaigns(buildEvidenceGraph(ds, { textMethod: "none" })).graph;
}

describe("sourceStats", () => {
  it("counts the in-campaign links and the campaigns per pivot type", () => {
    const s = sourceStats(graph());
    expect(s.campaigns).toBe(2);
    expect(s.links).toBe(2);
    const tracker = s.rows.find((r) => r.type === "tracker")!;
    expect(tracker).toMatchObject({ source: "HTML/HAR", links: 2, campaigns: 2 });
    expect(s.rows.find((r) => r.type === "domain")).toMatchObject({ links: 2, campaigns: 2 });
    expect(s.rows.find((r) => r.type === "asn")).toBeUndefined();
  });

  it("renders a Markdown table with one row per type", () => {
    const md = sourceStatsMarkdown(sourceStats(graph()));
    expect(md).toContain("| tracker |");
    expect(md.split("\n").filter((l) => l.startsWith("| "))).toHaveLength(1 + sourceStats(graph()).rows.length);
  });
});
