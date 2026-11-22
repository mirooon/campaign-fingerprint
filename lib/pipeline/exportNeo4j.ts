/**
 * Evidence graph as two CSV files for `neo4j-admin database import` (nodes and relationships).
 * Pure functions: the script writes the files. Every graph node is one row and every graph edge is one
 * row; similarity links between items (graph.links) are not edges of the graph and stay out.
 */
import type { EvidenceGraph } from "../graph/model";
import { cell } from "./materialCsv";

export const NEO4J_NODE_COLUMNS = ["id:ID", ":LABEL", "key", "label", "weight:double", "df:int", "strong:boolean", "campaign_id"] as const;
export const NEO4J_EDGE_COLUMNS = [":START_ID", ":END_ID", ":TYPE", "weight:double", "evidence"] as const;

/** Nodes file: id, label (entity type), key, display label, pivot weight, document frequency, strong flag, campaign of an item node. */
export function neo4jNodesCsv(graph: EvidenceGraph): string {
  const rows = graph.nodes.map((n) => [n.id, n.type, n.key, n.label, n.weight ?? "", n.df, String(n.strong), n.campaignId ?? ""]);
  return `${[[...NEO4J_NODE_COLUMNS], ...rows].map((r) => r.map(cell).join(",")).join("\n")}\n`;
}

/** Relationships file: start and end node id, edge type, weight, and the human-readable evidence text. */
export function neo4jEdgesCsv(graph: EvidenceGraph): string {
  const rows = graph.edges.map((e) => [e.source, e.target, e.type, e.weight, e.evidence]);
  return `${[[...NEO4J_EDGE_COLUMNS], ...rows].map((r) => r.map(cell).join(",")).join("\n")}\n`;
}
