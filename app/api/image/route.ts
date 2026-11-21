/**
 * GET /api/image?id=<itemId> — serves a local ad image from the dataset directory.
 * Only files inside the dataset's baseDir with image extensions are served.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
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
  const file = path.resolve(/*turbopackIgnore: true*/ base, rel);
  const type = TYPES[path.extname(file).toLowerCase()];
  // An absolute path comes from the pipeline's own output (case folders kept outside the dataset directory).
  if ((!path.isAbsolute(rel) && !file.startsWith(base + path.sep)) || !type) return new Response("forbidden", { status: 403 });
  try {
    const data = await readFile(file);
    return new Response(new Uint8Array(data), { headers: { "content-type": type, "cache-control": "public, max-age=3600" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
