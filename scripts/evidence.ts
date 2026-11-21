/**
 * bun run evidence -- --campaign K01 [--out data/evidence/K01] [--submitter-name ...] [--submitter-email ...]
 * Writes evidence.json + evidence.md, cert-domains.txt, dsa-art16-notice.md, copied files and manifest.sha256.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { exportEvidencePack } from "../lib/evidence/pack";
import type { CampaignsFile, EvidenceGraph } from "../lib/graph/model";
import { DEFAULTS, loadLinkConfig, readJson } from "../lib/pipeline/steps";
import type { CampaignSummary } from "../lib/pipeline/summary";
import type { EnrichedDataset } from "../lib/pipeline/types";
import { cli, main } from "./_cli";

const args = cli(
  {
    campaign: { type: "string" },
    out: { type: "string" },
    graph: { type: "string" },
    campaigns: { type: "string" },
    enriched: { type: "string" },
    config: { type: "string" },
    tlp: { type: "string" },
    "submitter-name": { type: "string" },
    "submitter-email": { type: "string" },
    "submitter-address": { type: "string" },
    "submitter-role": { type: "string" },
  } as const,
  `Użycie: bun run evidence -- --campaign K01 [--out data/evidence/K01] [--enriched data/work/enriched.json] [--config linking.json]
  [--submitter-name "…"] [--submitter-email "…"] [--submitter-address "…"] [--submitter-role "…"] [--tlp TLP:AMBER]
Paczka wg sekcji 5 raportu prawnego: evidence.json, evidence.md, cert-domains.txt, dsa-art16-notice.md, files/, manifest.sha256.`,
);

void main(() => {
  if (!args.campaign) throw new Error("podaj --campaign (np. K01)");
  const enrichedFile = args.enriched ?? DEFAULTS.enriched;
  if (!existsSync(enrichedFile)) throw new Error(`brak ${enrichedFile} — najpierw uruchom enrich (np. bun run pipeline --offline)`);
  let gitCommit: string | null = null;
  try {
    gitCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    gitCommit = null;
  }
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { name: string; version: string };
  const summariesFile = "data/summaries.json";
  const res = exportEvidencePack({
    campaignId: args.campaign,
    graph: readJson<EvidenceGraph>(args.graph ?? DEFAULTS.graph),
    campaigns: readJson<CampaignsFile>(args.campaigns ?? DEFAULTS.campaigns),
    enriched: readJson<EnrichedDataset>(enrichedFile),
    summaries: existsSync(summariesFile) ? readJson<{ summaries: Record<string, CampaignSummary> }>(summariesFile).summaries : undefined,
    config: loadLinkConfig(args.config ?? DEFAULTS.config),
    outDir: args.out ?? path.join(DEFAULTS.evidence, args.campaign),
    tlp: args.tlp,
    submitter: {
      name: args["submitter-name"],
      email: args["submitter-email"],
      address: args["submitter-address"],
      role: args["submitter-role"],
    },
    toolVersion: { name: pkg.name, version: pkg.version, gitCommit },
  });
  console.log(`[evidence] paczka kampanii ${args.campaign} -> ${res.outDir}`);
  console.log(`[evidence] pliki: ${res.files.length}; domeny dla CERT: ${res.certDomains.length} (${res.certDomains.slice(0, 6).join(", ")}${res.certDomains.length > 6 ? ", …" : ""})`);
  console.log(`[evidence] weryfikacja: (cd ${res.outDir} && shasum -a 256 -c manifest.sha256)`);
});
