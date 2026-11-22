/**
 * GET /api/image?id=<itemId> — serves a local ad image from the dataset directory.
 * Only files inside the dataset's baseDir (or CASES_DIR, for a run with relative case paths) with image extensions are served.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveCasePath } from "@/lib/pipeline/casePath";
import { loadViewerData } from "@/lib/viewer/data";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("missing id", { status: 400 });
  const { graph } = loadViewerData();
  const node = graph?.nodes.find((n) => n.type === "item" && n.key === id);
  const rel = node?.data.imagePath;
  if (!graph || typeof rel !== "string") return new Response("not found", { status: 404 });
  // Dynamic on purpose; the files are declared in next.config outputFileTracingIncludes.
  const base = path.resolve(/*turbopackIgnore: true*/ process.cwd(), graph.baseDir || "data/sample");
  // A run from the non-public pack keeps paths relative to the evaluator's own copy of the cases (CASES_DIR).
  const casesDir = process.env.CASES_DIR ? path.resolve(/*turbopackIgnore: true*/ process.env.CASES_DIR) : undefined;
  const found = resolveCasePath(rel, { baseDir: base, casesDir, exists: existsSync });
  if (!found.file) return new Response(found.reason, { status: 404 });
  const file = path.resolve(/*turbopackIgnore: true*/ found.file);
  const type = TYPES[path.extname(file).toLowerCase()];
  // An absolute path comes from the pipeline's own output (case folders kept outside the dataset directory).
  const inside = [base, casesDir].some((dir) => dir && file.startsWith(dir + path.sep));
  if ((!path.isAbsolute(rel) && !inside) || !type) return new Response("forbidden", { status: 403 });
  try {
    const data = await readFile(file);
    return new Response(new Uint8Array(data), { headers: { "content-type": type, "cache-control": "public, max-age=3600" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
