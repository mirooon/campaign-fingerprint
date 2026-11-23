/**
 * Guiding texts of the GUI (B-034): "How to read" captions under every visualisation, the "What next?" actions and the
 * anchor of the methodology section ("How did we compute this?").
 */
import type { Campaign } from "@/lib/graph/model";
import type { Decision } from "./decisions";

/** Anchor of the methodology section in "How it works" (an id in the URL, kept as it is). */
export const METHOD_ANCHOR = "jak-policzylismy";

/** Visualisations that carry a "How to read" caption. */
export type VisualId = "graph" | "evolution" | "threshold" | "compare" | "strength";

/** "How to read" caption of each visualisation: one or two plain sentences. */
export const READ_HOW: Record<VisualId, string> = {
  graph: "Dots are samples and shared traces (domain, tracker, phone…); lines show who shares what. The outline color is the campaign; the thicker the line, the stronger the evidence. Click a dot to see the evidence.",
  evolution: "Campaign timeline: each row is a trace (domain, creative, account), and the bar shows when we first and last saw it. A new bar in the middle of a campaign means the same operator changed infrastructure or creative.",
  threshold: "The numbers show how many campaigns there would be at a different linking threshold. When the result barely changes, the split is stable; a big jump means campaigns held together by weak evidence.",
  compare: "Two samples side by side: shared traces with their strength at the top, features that differ below. One strong shared trace is enough to link them; weak ones only count if together they cross the threshold.",
  strength: "The bar is the pair score from 0 to 1: it combines the strength of all shared traces. Above the linking threshold the samples can end up in one campaign.",
};

/** One action of the "What next?" box. */
export interface NextStep {
  id: "decide" | "compare" | "weakest" | "evidence" | "analyze";
  label: string;
}

/**
 * The 1–3 actions of the "What next?" box of an opened campaign: decide first when nothing is decided, check the weakest
 * link of a campaign standing on a bridge or a weak link, compare two samples, and download the evidence pack once the
 * campaign is marked for reporting.
 */
export function campaignNextSteps(c: Pick<Campaign, "size" | "bridge" | "minInternalScore">, decision: Decision | null, minLinkScore: number): NextStep[] {
  const out: NextStep[] = [];
  if (!decision) out.push({ id: "decide", label: "Assess the campaign: choose “to report”, “to verify” or “rejected” (Analyst decision below)." });
  const weak = Boolean(c.bridge) || (typeof c.minInternalScore === "number" && c.minInternalScore < minLinkScore + 0.1);
  if (c.size > 1 && weak) out.push({ id: "weakest", label: "Check the weakest link: compare the samples joined by the weakest evidence before you report the whole campaign." });
  if (c.size > 1) out.push({ id: "compare", label: "Compare two samples from the campaign to see their shared traces side by side." });
  if (decision === "to_report" || decision === "reported") out.push({ id: "evidence", label: "Download the evidence pack and attach it to the report." });
  if (!out.length) out.push({ id: "analyze", label: "Upload another sample in “Analyze sample” to check whether it belongs to this campaign." });
  return out.slice(0, 3);
}
