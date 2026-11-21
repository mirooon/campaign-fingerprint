/**
 * Structured campaign summary produced by an LLM (scripts/summarize.ts).
 * The schema is shared by the LLM call (structured output) and the viewer.
 */
import { z } from "zod";

export const CampaignSummarySchema = z.object({
  persona: z.string().describe("Osoba lub marka, pod którą podszywa się kampania (np. znana osoba); 'brak' jeśli nie widać"),
  narrative: z.string().describe("Narracja/przynęta: co obiecuje reklama i jak skłania do kliknięcia (1-2 zdania)"),
  infrastructure: z.string().describe("Najważniejsze wspólne elementy infrastruktury łączące reklamy (domeny, trackery, IP, kontakty, portfele)"),
  timeSpan: z.string().describe("Okres aktywności kampanii w czytelnej formie"),
  riskNotes: z.string().describe("Krótka uwaga dla analityka: co sprawdzić lub zablokować w pierwszej kolejności"),
});

export type CampaignSummary = z.infer<typeof CampaignSummarySchema> & {
  campaignId: string;
  model: string;
  generatedAt: string;
};
