/** GET /api/material/<job> — status, state of every case, log and (when done) the result. */
import { getJob, publicJob } from "@/lib/viewer/jobs";

export async function GET(_request: Request, ctx: { params: Promise<{ job: string }> }): Promise<Response> {
  const { job: id } = await ctx.params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "Nie ma takiego zadania (serwer mógł zostać uruchomiony ponownie)" }, { status: 404, headers: { "cache-control": "no-store" } });
  return Response.json(publicJob(job), { headers: { "cache-control": "no-store" } });
}
