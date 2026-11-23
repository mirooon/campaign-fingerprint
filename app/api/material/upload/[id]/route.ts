/**
 * PUT /api/material/upload/<id>?case=<case>&path=<relative path> — one file of the batch, body = file bytes.
 * Streamed to disk; no size limit unless MATERIAL_MAX_MB / MATERIAL_MAX_FILES are set.
 */
import { getUploadSession } from "@/lib/viewer/uploadSession";
import { addUploadFile } from "@/lib/viewer/uploadSession";
import { UploadError } from "@/lib/viewer/upload";

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const s = getUploadSession(id);
  if (!s) return Response.json({ error: "No such upload session (the server may have been restarted)" }, { status: 404 });
  const q = new URL(request.url).searchParams;
  const rel = q.get("path") ?? "";
  try {
    await addUploadFile(s, q.get("case") ?? "sprawa", rel, request.body, Number(request.headers.get("content-length")) || 0);
    return Response.json({ ok: true, files: s.files, bytes: s.bytes });
  } catch (e) {
    const status = e instanceof UploadError ? (/limit/.test(e.message) ? 413 : 400) : 500;
    return Response.json({ error: e instanceof UploadError ? e.message : `Could not save the file ${rel}: ${(e as Error).message}` }, { status });
  }
}
