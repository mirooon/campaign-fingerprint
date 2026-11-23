/** bun run export-dataset -- --data <katalog przebiegu> (--out <katalog> [--csv] | --neo4j <katalog>) */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CampaignsFile, EvidenceGraph } from "../lib/graph/model";
import { exportDataset, exportRowsCsv } from "../lib/pipeline/exportDataset";
import { neo4jEdgesCsv, neo4jNodesCsv } from "../lib/pipeline/exportNeo4j";
import { readJson, writeJson } from "../lib/pipeline/steps";
import { cli, main } from "./_cli";

const args = cli(
  {
    data: { type: "string" },
    out: { type: "string" },
    csv: { type: "boolean" },
    neo4j: { type: "string" },
  } as const,
  `Usage: bun run export-dataset -- --data <run folder> (--out <folder> [--csv] | --neo4j <folder>)
Enriched dataset: one row per sample (material_id, campaign_id, family_id, features, top_premises, ad_library_url, basis, persona, deepfake_score).
--data: folder with graph.json and campaigns.json (default VIEWER_DATA_DIR or data/). --out: result folder (dataset.json, with --csv also dataset.csv).
No voice, face or image vectors: only the persona and the deepfake score from the input data.
--neo4j: the graph as nodes.csv and edges.csv for neo4j-admin database import (headers :ID, :LABEL, :START_ID, :END_ID, :TYPE); can go together with --out.`,
);

void main(() => {
  if (!args.out && !args.neo4j) throw new Error("required: --out or --neo4j (see --help)");
  const dataDir = path.resolve(args.data ?? process.env.VIEWER_DATA_DIR ?? "data");
  const graph = readJson<EvidenceGraph>(path.join(dataDir, "graph.json"));
  if (args.out) {
    const outDir = path.resolve(args.out);
    const rows = exportDataset(graph, readJson<CampaignsFile>(path.join(dataDir, "campaigns.json")));
    mkdirSync(outDir, { recursive: true });
    writeJson(path.join(outDir, "dataset.json"), rows);
    if (args.csv) writeFileSync(path.join(outDir, "dataset.csv"), exportRowsCsv(rows), "utf8");
    console.log(`[export-dataset] ${rows.length} ${rows.length === 1 ? "sample" : "samples"} → ${outDir}${args.csv ? " (JSON and CSV)" : " (JSON)"}`);
  }
  if (args.neo4j) {
    const neoDir = path.resolve(args.neo4j);
    mkdirSync(neoDir, { recursive: true });
    writeFileSync(path.join(neoDir, "nodes.csv"), neo4jNodesCsv(graph), "utf8");
    writeFileSync(path.join(neoDir, "edges.csv"), neo4jEdgesCsv(graph), "utf8");
    console.log(`[export-dataset] graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges → ${neoDir}`);
  }
});
