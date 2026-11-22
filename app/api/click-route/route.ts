/**
 * GET /api/click-route?id=<materiał>[&job=<zadanie>] — click route of one material (ad → tracking link →
 * redirects → lure page): the links with role, status, age of the domain against the ad and cloaking warning.
 * Without `job` the material comes from the base, with it from the batch of that analysis job.
 */
import path from "node:path";
import { loadClickRoute } from "@/lib/viewer/clickRouteFile";
import { DATA_DIR } from "@/lib/viewer/data";
import { getJob } from "@/lib/viewer/jobs";

const ID = /^[\w.\-/ ]{1,200}$/;

/** GET /api/click-route: `{ route: RouteLink[] }`, or `{ error }` with 400/404/409/500. */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const jobId = params.get("job");
  if (!id || !ID.test(id)) return Response.json({ error: "Podaj poprawny identyfikator materiału (id)." }, { status: 400 });
  const job = jobId ? getJob(jobId) : undefined;
  if (jobId && !job) return Response.json({ error: "Nie ma takiego zadania (serwer mógł zostać uruchomiony ponownie)" }, { status: 404 });
  const out = loadClickRoute({ dataDir: DATA_DIR, jobWorkDir: job ? path.join(/*turbopackIgnore: true*/ job.dir, "praca") : undefined, itemId: id });
  if (!out.ok) return Response.json({ error: out.error }, { status: out.status, headers: { "cache-control": "no-store" } });
  return Response.json({ route: out.route }, { headers: { "cache-control": "no-store" } });
}
