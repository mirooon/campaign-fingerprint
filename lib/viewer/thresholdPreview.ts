/**
 * Preview of the link threshold (B-026): how many campaigns the saved links give at other values of
 * `minLinkScore`. It runs the backend's own clustering (`clusterCampaigns`) on the stored graph with the base's
 * weights, so the numbers follow the real rules; an approximation only because `graph.json` keeps the strongest
 * links of each ad (top-K per item), not every pair.
 */
import { clusterCampaigns } from "@/lib/graph/cluster";
import type { LinkConfig } from "@/lib/graph/config";
import type { EvidenceGraph } from "@/lib/graph/model";

/** Values offered by the preview next to the current threshold. */
export const THRESHOLD_PREVIEW_VALUES = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5];

export interface ThresholdRow {
  value: number;
  /** Campaigns of two or more materials. */
  campaigns: number;
  /** Materials left alone. */
  singletons: number;
  /** Size of the biggest campaign. */
  largest: number;
}

/** Steps of the preview: the standard values plus the current threshold, sorted and without repeats. */
export function thresholdSteps(current: number): number[] {
  return [...new Set([...THRESHOLD_PREVIEW_VALUES, current])].sort((a, b) => a - b);
}

/** Campaign counts of the graph at each threshold in `values` (the rest of `config` unchanged). */
export function previewThresholds(graph: EvidenceGraph, config: LinkConfig, values: number[]): ThresholdRow[] {
  return values.map((value) => {
    const { campaigns } = clusterCampaigns(graph, { config: { ...config, minLinkScore: value } }).campaigns;
    const multi = campaigns.filter((c) => c.size > 1);
    return { value, campaigns: multi.length, singletons: campaigns.length - multi.length, largest: Math.max(0, ...campaigns.map((c) => c.size)) };
  });
}
