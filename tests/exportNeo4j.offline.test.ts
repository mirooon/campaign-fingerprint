/**
 * Neo4j export (CSV for `neo4j-admin database import`) on a synthetic graph: one row per node and per edge.
 */
import { describe, expect, it } from "vitest";
import { parse } from "csv-parse/sync";
import { clusterCampaigns } from "../lib/graph/cluster";
import { buildEvidenceGraph } from "../lib/graph/link";
import { makeDataset } from "../lib/graph/testkit";
import { neo4jEdgesCsv, neo4jNodesCsv } from "../lib/pipeline/exportNeo4j";

const { graph } = clusterCampaigns(
  buildEvidenceGraph(
    makeDataset([
      { id: "a", url: "https://alfa-oferta.test/1", trackers: [{ kind: "ga4", id: "G-ALFA111111" }] },
      { id: "b", url: "https://alfa-oferta.test/2, \"z cudzysłowem\"", trackers: [{ kind: "ga4", id: "G-ALFA111111" }] },
    ]),
    { textMethod: "none" },
  ),
);

describe("neo4j export", () => {
  it("writes one node row per graph node with the import headers", () => {
    const csv = neo4jNodesCsv(graph);
    const rows = parse(csv, { columns: true }) as Array<Record<string, string>>;
    expect(rows).toHaveLength(graph.nodes.length);
    expect(Object.keys(rows[0]).slice(0, 2)).toEqual(["id:ID", ":LABEL"]);
    expect(rows.find((r) => r["id:ID"] === "item:a")![":LABEL"]).toBe("item");
    expect(new Set(rows.map((r) => r["id:ID"])).size).toBe(rows.length);
  });

  it("writes one edge row per graph edge, every end pointing at a node", () => {
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    const rows = parse(neo4jEdgesCsv(graph), { columns: true }) as Array<Record<string, string>>;
    expect(rows).toHaveLength(graph.edges.length);
    expect(Object.keys(rows[0]).slice(0, 3)).toEqual([":START_ID", ":END_ID", ":TYPE"]);
    for (const r of rows) {
      expect(nodeIds.has(r[":START_ID"])).toBe(true);
      expect(nodeIds.has(r[":END_ID"])).toBe(true);
    }
  });
});
