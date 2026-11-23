/** GET /api/material/<job> — status, state of every case, log and (when done) the result. */
import { getJob, publicJob } from "@/lib/viewer/jobs";

export async function GET(_request: Request, ctx: { params: Promise<{ job: string }> }): Promise<Response> {
  const { job: id } = await ctx.params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "No such job (the server may have been restarted)" }, { status: 404, headers: { "cache-control": "no-store" } });
  return Response.json(publicJob(job), { headers: { "cache-control": "no-store" } });
}
