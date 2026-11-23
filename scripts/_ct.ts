/** Shared setup of the CT watcher scripts: campaign fingerprints from campaigns.json/graph.json. */
import { existsSync } from "node:fs";
import path from "node:path";
import { loadCtConfig } from "../lib/ct/config";
import { buildCampaignInfra, type CampaignInfra } from "../lib/ct/confirm";
import { buildFingerprints, type FingerprintSet } from "../lib/ct/fingerprint";
import type { CampaignsFile, EvidenceGraph } from "../lib/graph/model";
import { Discounter } from "../lib/graph/weights";
import { findEnriched } from "../lib/pipeline/analyzeMaterial";
import type { EnrichedDataset } from "../lib/pipeline/types";
import { DEFAULTS, loadLinkConfig, readJson } from "../lib/pipeline/steps";

/** Local certstream-server-go first, then the public CertStream (the order the stream client tries them). */
export const LOCAL_STREAM = "ws://127.0.0.1:8181/";
export const PUBLIC_STREAM = "wss://certstream.calidog.io/";

export interface FingerprintArgs {
  campaigns?: string;
  graph?: string;
  lexicon?: string;
  config?: string;
  threshold?: string;
}

/**
 * Fingerprints of the base's campaigns for the CT scripts. The lexicon is `--lexicon`, else the brands of the base
 * (`ct-lexicon.json` next to `campaigns.json`, written by `bun run base`), else the sample's.
 */
export function loadFingerprints(args: FingerprintArgs): FingerprintSet {
  const campaignsFile = args.campaigns ?? DEFAULTS.campaigns;
  if (!existsSync(campaignsFile)) throw new Error(`no ${campaignsFile} — build the graph first (bun run pipeline --offline)`);
  const graphFile = args.graph ?? DEFAULTS.graph;
  // The brands of a base (written by `bun run base`) next to its campaigns.json; else the sample's lexicon.
  const baseLexicon = path.join(path.dirname(path.resolve(campaignsFile)), "ct-lexicon.json");
  const config = loadCtConfig(args.lexicon ?? (existsSync(baseLexicon) ? baseLexicon : DEFAULTS.ctLexicon));
  if (args.threshold) {
    const t = Number(args.threshold);
    if (!Number.isFinite(t) || t < 0 || t > 1) throw new Error("--threshold must be a number 0..1");
    config.threshold = t;
  }
  // Platforms, shorteners and public services from linking.json are not campaign-owned domains.
  const discounter = new Discounter(loadLinkConfig(args.config ?? DEFAULTS.config));
  return buildFingerprints(readJson<CampaignsFile>(campaignsFile), {
    config,
    graph: existsSync(graphFile) ? readJson<EvidenceGraph>(graphFile) : null,
    isExcludedDomain: (d) => discounter.domainDiscount(d) !== null,
  });
}

/** Infrastructure of the base's campaigns for confirming CT candidates; null when the base has no enriched.json (the candidates then stay unconfirmed). */
export function loadCampaignInfra(dataDir: string, campaignsFile: string): Map<string, CampaignInfra> | null {
  const enriched = findEnriched(dataDir);
  return enriched && existsSync(campaignsFile) ? buildCampaignInfra(readJson<EnrichedDataset>(enriched), readJson<CampaignsFile>(campaignsFile)) : null;
}

export function printFingerprints(set: FingerprintSet): void {
  console.log(`[ct] campaign fingerprints: ${set.campaigns.length} (threshold ${set.config.threshold}; platform/service domains skipped: ${set.excluded.join(", ") || "none"})`);
  for (const fp of set.campaigns) {
    const parts = [
      fp.templates.length ? `templates: ${fp.templates.map((t) => t.template).join(", ")}` : null,
      fp.brands.length ? `brands: ${fp.brands.join(", ")}` : null,
      fp.media.length ? `media: ${fp.media.join(", ")}` : null,
    ].filter(Boolean);
    console.log(`  ${fp.campaignId.padEnd(5)} ${parts.join(" · ") || "(no name pattern — campaign words only)"}`);
  }
}
