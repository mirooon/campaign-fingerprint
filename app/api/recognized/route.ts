/**
 * GET /api/recognized — the closed list of people the tool compares faces and voices with: name, role, number of
 * reference photos and voice windows, and the public source that put the person on the list. Counts only, never
 * the reference vectors. Galleries live in the project's `data/` (the same place `--faces` and `--speaker` read).
 */
import path from "node:path";
import { connection } from "next/server";
import { loadRecognized } from "@/lib/viewer/recognizedFile";

/** GET /api/recognized: `{ people, notes }`; `notes` says which gallery is missing or unreadable. */
export async function GET(): Promise<Response> {
  // Render per request: without it `next build` prerenders this response once from the repository's data/.
  await connection();
  return Response.json(loadRecognized(path.join(/*turbopackIgnore: true*/ process.cwd(), "data")), { headers: { "cache-control": "no-store" } });
}
