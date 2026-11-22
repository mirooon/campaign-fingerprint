/**
 * POST /api/add-to-base  { jobId, ids: string[], force? }
 * Adds materials of a finished analysis job to the base of known campaigns (`addToBase`), so the next analysis
 * sees them. Answers `{ result, messages }`: what was added and what was not, with the reasons. The bundled
 * sample base is read-only (403 with an explanation): point VIEWER_DATA_DIR at a copy to let it grow.
 */
import path from "node:path";
import { z } from "zod";
import { addJobToBase } from "@/lib/viewer/addToBaseJob";
import { addToBaseRefusal } from "@/lib/viewer/addToBaseView";
import { DATA_DIR, SAMPLE_BASE } from "@/lib/viewer/data";
import { getJob } from "@/lib/viewer/jobs";
import { rateLimitResponse } from "@/lib/viewer/rateLimit";

const Body = z.object({
  jobId: z.string().trim().min(1).max(60),
  ids: z.array(z.string().trim().min(1).max(200)).min(1).max(500),
  force: z.boolean().optional(),
});

/** POST /api/add-to-base: adds the chosen materials of a job to the base; errors come as `{ error }` with 400, 403, 404, 409 or 500. */
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
  const refusal = addToBaseRefusal(SAMPLE_BASE);
  if (refusal) return Response.json({ error: refusal }, { status: 403 });
  const { jobId, ids, force } = parsed.data;
  const job = getJob(jobId);
  if (!job) return Response.json({ error: "Nie ma takiego zadania (serwer mógł zostać uruchomiony ponownie)" }, { status: 404 });
  if (job.status !== "done" || !job.result) return Response.json({ error: "Analiza tego zadania jeszcze się nie skończyła" }, { status: 409 });
  const out = await addJobToBase({ dataDir: DATA_DIR, workDir: path.join(/*turbopackIgnore: true*/ job.dir, "praca"), result: job.result, ids, force });
  if (!out.ok) return Response.json({ error: out.error }, { status: out.status });
  return Response.json({ result: out.result, messages: out.messages }, { headers: { "cache-control": "no-store" } });
}
