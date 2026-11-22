/**
 * GET /api/recognized — the closed list of people the tool compares faces and voices with: name, role, number of
 * reference photos and voice windows, and the public source that put the person on the list. Counts only, never
 * the reference vectors. Galleries live in the project's `data/` (the same place `--faces` and `--speaker` read).
 */
import path from "node:path";
import { loadRecognized } from "@/lib/viewer/recognizedFile";

/** Read the galleries on every request: without this `next build` prerenders the response once, and galleries added after the build never show. */
export const dynamic = "force-dynamic";

/** GET /api/recognized: `{ people, notes }`; `notes` says which gallery is missing or unreadable. */
export async function GET(): Promise<Response> {
  return Response.json(loadRecognized(path.join(/*turbopackIgnore: true*/ process.cwd(), "data")), { headers: { "cache-control": "no-store" } });
}
