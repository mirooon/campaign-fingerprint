/** Shared setup of the CT watcher scripts: campaign fingerprints from campaigns.json/graph.json. */
import { existsSync } from "node:fs";
import { loadCtConfig } from "../lib/ct/config";
import { buildFingerprints, type FingerprintSet } from "../lib/ct/fingerprint";
import type { CampaignsFile, EvidenceGraph } from "../lib/graph/model";
import { Discounter } from "../lib/graph/weights";
import { DEFAULTS, loadLinkConfig, readJson } from "../lib/pipeline/steps";

export interface FingerprintArgs {
  campaigns?: string;
  graph?: string;
  lexicon?: string;
  config?: string;
  threshold?: string;
}

export function loadFingerprints(args: FingerprintArgs): FingerprintSet {
  const campaignsFile = args.campaigns ?? DEFAULTS.campaigns;
  if (!existsSync(campaignsFile)) throw new Error(`brak ${campaignsFile} — najpierw zbuduj graf (bun run pipeline --offline)`);
  const graphFile = args.graph ?? DEFAULTS.graph;
  const config = loadCtConfig(args.lexicon ?? DEFAULTS.ctLexicon);
  if (args.threshold) {
    const t = Number(args.threshold);
    if (!Number.isFinite(t) || t < 0 || t > 1) throw new Error("--threshold musi być liczbą 0..1");
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

export function printFingerprints(set: FingerprintSet): void {
  console.log(`[ct] odciski kampanii: ${set.campaigns.length} (próg ${set.config.threshold}; pominięte domeny platform/usług: ${set.excluded.join(", ") || "brak"})`);
  for (const fp of set.campaigns) {
    const parts = [
      fp.templates.length ? `szablony: ${fp.templates.map((t) => t.template).join(", ")}` : null,
      fp.brands.length ? `marki: ${fp.brands.join(", ")}` : null,
      fp.media.length ? `media: ${fp.media.join(", ")}` : null,
    ].filter(Boolean);
    console.log(`  ${fp.campaignId.padEnd(5)} ${parts.join(" · ") || "(brak wzorca nazw — tylko słowa kampanii)"}`);
  }
}
