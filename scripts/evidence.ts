/**
 * bun run evidence -- --campaign K01 [--out data/evidence/K01] [--submitter-name ...] [--submitter-email ...]
 * Writes evidence.json + evidence.md, cert-domains.txt, dsa-art16-notice.md, copied files and manifest.sha256.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadCertList } from "../lib/evidence/certListFile";
import { exportEvidencePack } from "../lib/evidence/pack";
import type { PackProvenance } from "../lib/evidence/sourceFiles";
import { parseReports } from "../lib/evidence/reports";
import { stampManifest } from "../lib/evidence/tsa";
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
    "cert-list": { type: "string" },
    tsa: { type: "string" },
    prior: { type: "string" },
    provenance: { type: "string" },
    "submitter-name": { type: "string" },
    "submitter-email": { type: "string" },
    "submitter-address": { type: "string" },
    "submitter-role": { type: "string" },
  } as const,
  `Usage: bun run evidence -- --campaign K01 [--out data/evidence/K01] [--enriched data/work/enriched.json] [--config linking.json]
  [--submitter-name "…"] [--submitter-email "…"] [--submitter-address "…"] [--submitter-role "…"] [--tlp TLP:AMBER]
  [--provenance data/provenance.json] (checksums of the case input files from the import; default data/provenance.json, if it exists)
  [--tsa https://…] (RFC 3161 timestamp on the manifest through openssl and the network; without it or without a network timestamp_token = null with the reason)
  [--prior reports.jsonl] (register of earlier reports: JSON lines or an array; recipient, reported_utc, category, status)
  [--cert-list domains.json] (local copy of the CERT Warning List; default CERT_LIST_FILE; no online queries)
Pack per section 5 of the legal report: evidence.json, evidence.md, cert-domains.txt, dsa-art16-notice.md, files/, manifest.sha256.`,
);

void main(async () => {
  if (!args.campaign) throw new Error("give --campaign (e.g. K01)");
  const enrichedFile = args.enriched ?? DEFAULTS.enriched;
  if (!existsSync(enrichedFile)) throw new Error(`no ${enrichedFile} — run enrich first (e.g. bun run pipeline --offline)`);
  let gitCommit: string | null = null;
  try {
    gitCommit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    gitCommit = null;
  }
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { name: string; version: string };
  const summariesFile = "data/summaries.json";
  const cert = loadCertList(args["cert-list"]);
  const provenanceFile = args.provenance ?? path.join(path.dirname(args.graph ?? DEFAULTS.graph), "provenance.json");
  const prior = args.prior ? parseReports(readFileSync(args.prior, "utf8")) : null;
  for (const e of prior?.errors ?? []) console.warn(`[evidence] ${args.prior} row ${e.line}: ${e.reason}`);
  const res = exportEvidencePack({
    campaignId: args.campaign,
    graph: readJson<EvidenceGraph>(args.graph ?? DEFAULTS.graph),
    campaigns: readJson<CampaignsFile>(args.campaigns ?? DEFAULTS.campaigns),
    enriched: readJson<EnrichedDataset>(enrichedFile),
    summaries: existsSync(summariesFile) ? readJson<{ summaries: Record<string, CampaignSummary> }>(summariesFile).summaries : undefined,
    config: loadLinkConfig(args.config ?? DEFAULTS.config),
    outDir: args.out ?? path.join(DEFAULTS.evidence, args.campaign),
    tlp: args.tlp,
    provenance: existsSync(provenanceFile) ? readJson<PackProvenance>(provenanceFile) : null,
    priorReports: prior?.entries,
    certList: cert.snapshot,
    certListNote: cert.reason ?? undefined,
    submitter: {
      name: args["submitter-name"],
      email: args["submitter-email"],
      address: args["submitter-address"],
      role: args["submitter-role"],
    },
    toolVersion: { name: pkg.name, version: pkg.version, gitCommit },
  });
  if (args.tsa) {
    const stamp = await stampManifest(res.outDir, args.tsa);
    console.log(stamp.ok ? `[evidence] timestamp: ${stamp.file}` : `[evidence] no timestamp: ${stamp.reason}`);
  }
  console.log(`[evidence] pack of campaign ${args.campaign} -> ${res.outDir}`);
  console.log(`[evidence] files: ${res.files.length}; domains for CERT: ${res.certDomains.length} (${res.certDomains.slice(0, 6).join(", ")}${res.certDomains.length > 6 ? ", …" : ""})`);
  console.log(`[evidence] verification: (cd ${res.outDir} && shasum -a 256 -c manifest.sha256)`);
});
