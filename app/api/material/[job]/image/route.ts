/**
 * GET /api/material/<job>/image?path=<file> — an image of the job, only from the job folder.
 * `path` is relative to the job's case folders (or an absolute path inside the job folder, as the
 * import writes it into provenance.json).
 */
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { getJob } from "@/lib/viewer/jobs";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

export async function GET(request: Request, ctx: { params: Promise<{ job: string }> }): Promise<Response> {
  const { job: id } = await ctx.params;
  const job = getJob(id);
  const rel = new URL(request.url).searchParams.get("path");
  if (!job || !rel) return new Response("not found", { status: 404 });
  const type = TYPES[path.extname(rel).toLowerCase()];
  if (!type || rel.includes("\0")) return new Response("forbidden", { status: 403 });
  const root = path.resolve(/*turbopackIgnore: true*/ job.dir);
  const candidates = path.isAbsolute(rel) ? [path.resolve(rel)] : [path.resolve(root, "sprawy", rel), path.resolve(root, "praca", "import", rel), path.resolve(root, rel)];
  for (const file of candidates) {
    try {
      const real = await realpath(file);
      const realRoot = await realpath(root);
      if (!real.startsWith(realRoot + path.sep)) continue;
      const data = await readFile(real);
      return new Response(new Uint8Array(data), { headers: { "content-type": type, "cache-control": "private, max-age=3600" } });
    } catch {
      // try the next location
    }
  }
  return new Response("not found", { status: 404 });
}
