/**
 * Evidence pack as a ZIP for the GUI and `POST /api/evidence`: the same pack as `bun run evidence`
 * (lib/evidence/pack.ts), written to a scratch folder and zipped in memory. The campaign comes from
 * the run in `dataDir` (K01...) or from the batch of an analysis job (N1...). Any problem comes back
 * as a message with an HTTP status, never as an exception, so the button can show it.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import { loadCertList } from "../evidence/certListFile";
import { exportEvidencePack, type Submitter } from "../evidence/pack";
import type { PackProvenance } from "../evidence/sourceFiles";
import type { CampaignsFile, EvidenceGraph } from "../graph/model";
import { evidenceInputsDir, findEnriched } from "../pipeline/analyzeMaterial";
import type { CampaignSummary } from "../pipeline/summary";
import type { EnrichedDataset } from "../pipeline/types";

export interface EvidenceExportInput {
  /** Campaign of the run (K01) or of the batch of the job (N1). */
  campaignId: string;
  /** Folder of the run: graph.json, campaigns.json, enriched.json (or work/enriched.json) and optionally summaries.json. */
  dataDir: string;
  /** Work folder of the analysis job (<job>/praca); needed for campaigns N1... */
  jobWorkDir?: string;
  submitter?: Partial<Submitter>;
  /** Project root against which relative paths of the run are resolved. */
  root?: string;
  now?: () => Date;
}

export type EvidenceExportResult = { ok: true; zip: Uint8Array; fileName: string; files: number } | { ok: false; status: 404 | 409 | 500; error: string };

/** Parsed JSON file; a missing or broken file throws, and the caller turns that into an answer. */
function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

/** Relative paths (with "/") of all files under `dir`. */
function listFiles(dir: string, rel = ""): string[] {
  return readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(dir, `${rel}${e.name}/`) : [`${rel}${e.name}`]));
}

/** Inputs of the pack: the run for K-campaigns, the job's batch for N-campaigns; a message when they cannot be found. */
function loadInputs(input: EvidenceExportInput): { graph: EvidenceGraph; campaigns: CampaignsFile; enriched: EnrichedDataset; campaignId: string; provenance: PackProvenance | null } | { error: string; status: 404 | 409 } {
  const provenanceIn = (dir: string): PackProvenance | null => (existsSync(path.join(dir, "provenance.json")) ? readJson<PackProvenance>(path.join(dir, "provenance.json")) : null);
  const isNew = /^N\d+$/.test(input.campaignId);
  if (isNew) {
    if (!input.jobWorkDir) return { status: 404, error: `Kampania ${input.campaignId} pochodzi z analizy materiału: podaj zadanie, w którym powstała.` };
    const dir = evidenceInputsDir(input.jobWorkDir);
    const mapFile = path.join(dir, "nowe-kampanie.json");
    if (!existsSync(mapFile)) return { status: 409, error: "Zadanie nie zachowało danych do paczki dowodów (uruchom analizę ponownie)." };
    const campaignId = readJson<Record<string, string>>(mapFile)[input.campaignId];
    if (!campaignId) return { status: 404, error: `Zadanie nie ma kampanii ${input.campaignId}.` };
    return { graph: readJson(path.join(dir, "graph.json")), campaigns: readJson(path.join(dir, "campaigns.json")), enriched: readJson(path.join(dir, "enriched.json")), campaignId, provenance: provenanceIn(dir) };
  }
  const campaignsFile = path.join(input.dataDir, "campaigns.json");
  const graphFile = path.join(input.dataDir, "graph.json");
  if (!existsSync(campaignsFile) || !existsSync(graphFile)) return { status: 409, error: "Brak bazy znanych kampanii (graph.json, campaigns.json)." };
  const campaigns = readJson<CampaignsFile>(campaignsFile);
  if (!campaigns.campaigns.some((c) => c.id === input.campaignId)) return { status: 404, error: `Nie ma kampanii ${input.campaignId} w bazie.` };
  const enrichedFile = findEnriched(input.dataDir);
  if (!enrichedFile) return { status: 409, error: "Brak enriched.json bazy: paczka dowodów potrzebuje danych wzbogaconych (bun run pipeline)." };
  return { graph: readJson(graphFile), campaigns, enriched: readJson(enrichedFile), campaignId: input.campaignId, provenance: provenanceIn(input.dataDir) };
}

/** Builds the pack of one campaign and returns it as a ZIP (evidence.json, evidence.md, cert-domains.txt, dsa-art16-notice.md, manifest.sha256, files/). */
export function buildEvidenceZip(input: EvidenceExportInput): EvidenceExportResult {
  const inputs = loadInputs(input);
  if ("error" in inputs) return { ok: false, status: inputs.status, error: inputs.error };
  const summariesFile = path.join(input.dataDir, "summaries.json");
  const cert = loadCertList();
  const outDir = mkdtempSync(path.join(os.tmpdir(), "paczka-dowodow-"));
  try {
    exportEvidencePack({
      campaignId: inputs.campaignId,
      graph: inputs.graph,
      campaigns: inputs.campaigns,
      enriched: inputs.enriched,
      provenance: inputs.provenance,
      summaries: existsSync(summariesFile) ? readJson<{ summaries: Record<string, CampaignSummary> }>(summariesFile).summaries : undefined,
      outDir,
      submitter: input.submitter,
      certList: cert.snapshot,
      certListNote: cert.reason ?? undefined,
      root: input.root,
      now: input.now,
    });
    const names = listFiles(outDir);
    const zip = zipSync(Object.fromEntries(names.map((n) => [n, new Uint8Array(readFileSync(path.join(outDir, n)))])));
    return { ok: true, zip, fileName: `paczka-dowodow-${input.campaignId}.zip`, files: names.length };
  } catch (e) {
    return { ok: false, status: 500, error: `Nie udało się zbudować paczki: ${(e as Error).message}` };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}
