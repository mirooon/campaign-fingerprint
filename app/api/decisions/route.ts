/**
 * GET /api/decisions → `{ decisions }` (campaign id → { status, decidedAt }).
 * POST /api/decisions { campaign, status } sets the analyst's decision for a campaign of the base ("to_report",
 * "reported", "rejected", "to_verify"), `status: null` removes it. Kept in `decyzje.json` next to the base (for the
 * bundled sample in the work folder), never in the repository. Only gates the export of the evidence pack.
 */
import { z } from "zod";
import { DECISIONS, type Decision } from "@/lib/viewer/decisions";
import { currentDecisionsFile, loadDecisions, saveDecision } from "@/lib/viewer/decisionsFile";

const Body = z.object({
  campaign: z.string().trim().regex(/^[A-Za-z0-9_-]{1,32}$/, "Niepoprawny identyfikator kampanii"),
  status: z.custom<Decision>((v) => typeof v === "string" && (DECISIONS as string[]).includes(v), "Niepoprawna decyzja").nullable(),
});

/** GET /api/decisions: all decisions of the base; an unreadable file answers `{ error }` with 500. */
export async function GET(): Promise<Response> {
  const out = loadDecisions(currentDecisionsFile());
  return out.ok ? Response.json({ decisions: out.file.decisions }, { headers: { "cache-control": "no-store" } }) : Response.json({ error: out.error }, { status: 500 });
}

/** POST /api/decisions: sets or removes one decision; 400 for a bad body, 500 with the reason when the file cannot be read or written. */
export async function POST(request: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Niepoprawny JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  const out = saveDecision(currentDecisionsFile(), parsed.data.campaign, parsed.data.status);
  return out.ok ? Response.json({ decisions: out.file.decisions }) : Response.json({ error: out.error }, { status: 500 });
}
