/**
 * Structured campaign summary produced by an LLM (scripts/summarize.ts).
 * The schema is shared by the LLM call (structured output) and the viewer.
 */
import { z } from "zod";

export const CampaignSummarySchema = z.object({
  persona: z.string().describe("Person or brand the campaign impersonates (e.g. a well-known person); 'none' if not visible"),
  narrative: z.string().describe("Narrative/lure: what the ad promises and how it prompts the click (1-2 sentences)"),
  infrastructure: z.string().describe("The main shared infrastructure linking the ads (domains, trackers, IPs, contacts, wallets)"),
  timeSpan: z.string().describe("Period the campaign was active, in a readable form"),
  riskNotes: z.string().describe("Short note for the analyst: what to check or block first"),
});

export type CampaignSummary = z.infer<typeof CampaignSummarySchema> & {
  campaignId: string;
  model: string;
  generatedAt: string;
};
