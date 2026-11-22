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
  `Użycie: bun run export-dataset -- --data <katalog przebiegu> (--out <katalog> [--csv] | --neo4j <katalog>)
Wzbogacony zbiór danych: wiersz na materiał (material_id, campaign_id, family_id, features, top_premises, ad_library_url, basis, persona, deepfake_score).
--data: katalog z graph.json i campaigns.json (domyślnie VIEWER_DATA_DIR albo data/). --out: katalog wyniku (dataset.json, z --csv także dataset.csv).
Bez wektorów głosu, twarzy i obrazu: tylko persona i wynik deepfake z danych wejściowych.
--neo4j: graf jako nodes.csv i edges.csv do neo4j-admin database import (nagłówki :ID, :LABEL, :START_ID, :END_ID, :TYPE); można razem z --out.`,
);

void main(() => {
  if (!args.out && !args.neo4j) throw new Error("wymagane: --out albo --neo4j (zob. --help)");
  const dataDir = path.resolve(args.data ?? process.env.VIEWER_DATA_DIR ?? "data");
  const graph = readJson<EvidenceGraph>(path.join(dataDir, "graph.json"));
  if (args.out) {
    const outDir = path.resolve(args.out);
    const rows = exportDataset(graph, readJson<CampaignsFile>(path.join(dataDir, "campaigns.json")));
    mkdirSync(outDir, { recursive: true });
    writeJson(path.join(outDir, "dataset.json"), rows);
    if (args.csv) writeFileSync(path.join(outDir, "dataset.csv"), exportRowsCsv(rows), "utf8");
    console.log(`[export-dataset] ${rows.length} materiałów → ${outDir}${args.csv ? " (JSON i CSV)" : " (JSON)"}`);
  }
  if (args.neo4j) {
    const neoDir = path.resolve(args.neo4j);
    mkdirSync(neoDir, { recursive: true });
    writeFileSync(path.join(neoDir, "nodes.csv"), neo4jNodesCsv(graph), "utf8");
    writeFileSync(path.join(neoDir, "edges.csv"), neo4jEdgesCsv(graph), "utf8");
    console.log(`[export-dataset] graf: ${graph.nodes.length} węzłów, ${graph.edges.length} krawędzi → ${neoDir}`);
  }
});
