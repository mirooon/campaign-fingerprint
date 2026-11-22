/** POST /api/material/upload — opens an upload session for a batch (files then go one by one with PUT). */
import { rateLimitResponse } from "@/lib/viewer/rateLimit";
import { createUploadSession } from "@/lib/viewer/uploadSession";

export async function POST(request: Request): Promise<Response> {
  const limited = rateLimitResponse(request);
  if (limited) return limited;
  const s = await createUploadSession();
  return Response.json({ uploadId: s.id });
}
