/**
 * Dataset export (one row per material) on a synthetic run: no network, no biometric vectors.
 */
import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "../lib/graph/cluster";
import { buildEvidenceGraph } from "../lib/graph/link";
import { makeDataset } from "../lib/graph/testkit";
import { emptyAdLibraryInfo } from "../lib/osint/adLibrary";
import { EXPORT_COLUMNS, exportDataset, exportRowsCsv } from "../lib/pipeline/exportDataset";
import { parse } from "csv-parse/sync";

const LIB_ID = "1000000000000101";

function run() {
  const graph = buildEvidenceGraph(
    makeDataset([
      { id: "a", url: "https://alfa-oferta.test/start", trackers: [{ kind: "ga4", id: "G-ALFA111111" }], personas: ["Jan Testowy"], deepfakeScore: 0.8, adLibrary: [{ ...emptyAdLibraryInfo(LIB_ID, null), payers: ["Testowa Spolka"] }] },
      { id: "b", url: "https://alfa-oferta.test/oferta", trackers: [{ kind: "ga4", id: "G-ALFA111111" }], speakerEmbedding: [0.1, 0.2, 0.3], imageEmbedding: [0.5, 0.5] },
      { id: "c", url: "https://inna-strona.test/" },
    ]),
    { textMethod: "none" },
  );
  const { graph: g, campaigns } = clusterCampaigns(graph);
  return exportDataset(g, campaigns);
}

describe("exportDataset", () => {
  it("gives one row per material with the campaign, basis and top premises", () => {
    const rows = run();
    expect(rows.map((r) => r.material_id)).toEqual(["a", "b", "c"]);
    const [a, b, c] = rows;
    expect(a.campaign_id).toBe(b.campaign_id);
    expect(a.campaign_id).not.toBe(c.campaign_id);
    expect(a.basis).toBe("infrastructure");
    expect(a.top_premises.length).toBeGreaterThan(0);
    expect(a.features).toMatchObject({ tracker: 1, domain: 1 });
    expect(c.top_premises).toEqual([]);
  });

  it("carries the persona, the deepfake score and the ad library link", () => {
    const [a, b] = run();
    expect(a.persona).toEqual(["Jan Testowy"]);
    expect(a.deepfake_score).toBe(0.8);
    expect(a.ad_library_url).toContain(LIB_ID);
    expect(b.ad_library_url).toBe("");
  });

  it("writes a CSV with the fixed columns and no vector fields", () => {
    const rows = run();
    const csv = exportRowsCsv(rows);
    const parsed = parse(csv, { columns: true }) as Array<Record<string, string>>;
    expect(parsed).toHaveLength(rows.length);
    expect(Object.keys(parsed[0])).toEqual([...EXPORT_COLUMNS]);
    expect(EXPORT_COLUMNS.slice(0, 5)).toEqual(["material_id", "campaign_id", "family_id", "features", "top_premises"]);
    expect(csv).not.toMatch(/embedding|voice|speaker|vector|0\.5,0\.5/i);
    expect(JSON.stringify(rows)).not.toMatch(/embedding|speaker|vector/i);
  });
});
