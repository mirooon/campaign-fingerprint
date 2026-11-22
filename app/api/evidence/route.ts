/**
 * POST /api/evidence  { campaign, jobId?, submitter? { name?, email?, address?, role? } }
 * Evidence pack of one campaign as a ZIP (evidence.json, evidence.md, cert-domains.txt,
 * dsa-art16-notice.md, manifest.sha256, files/). `campaign` is a campaign of the run (K01...) or,
 * with `jobId`, a campaign of new materials of that analysis job (N1...). An unknown id answers
 * with an error message (404), not a server error. Nothing is sent anywhere: the pack only prepares documents.
 */
import path from "node:path";
import { z } from "zod";
import { buildEvidenceZip } from "@/lib/viewer/evidenceExport";
import { DATA_DIR } from "@/lib/viewer/data";
import { getJob } from "@/lib/viewer/jobs";
import { rateLimitResponse } from "@/lib/viewer/rateLimit";

const text = z.string().trim().max(300).optional();
const Body = z.object({
  campaign: z.string().trim().regex(/^[A-Za-z0-9_-]{1,32}$/, "Niepoprawny identyfikator kampanii"),
  jobId: z.string().trim().max(60).optional(),
  submitter: z.object({ name: text, email: text, address: text, role: text }).optional(),
});

/** POST /api/evidence: ZIP of the evidence pack of one campaign (body `{ campaign, jobId? }`); an unknown campaign or a failed build answers with a JSON `{ error }` and a status, never an exception. */
export async function POST(request: Request): Promise<Response> {
  const limited = rateLimitResponse(request);
  if (limited) return limited;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Niepoprawny JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  const { campaign, jobId, submitter } = parsed.data;
  const job = jobId ? getJob(jobId) : undefined;
  if (jobId && !job) return Response.json({ error: "Nie ma takiego zadania (serwer mógł zostać uruchomiony ponownie)" }, { status: 404 });
  if (job && job.status !== "done") return Response.json({ error: "Analiza tego zadania jeszcze się nie skończyła" }, { status: 409 });
  const out = buildEvidenceZip({
    campaignId: campaign,
    dataDir: DATA_DIR,
    jobWorkDir: job ? path.join(/*turbopackIgnore: true*/ job.dir, "praca") : undefined,
    submitter,
  });
  if (!out.ok) return Response.json({ error: out.error }, { status: out.status });
  return new Response(new Uint8Array(out.zip), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${out.fileName}"`, "cache-control": "no-store" },
  });
}
