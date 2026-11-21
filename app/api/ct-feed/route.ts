/**
 * GET /api/ct-feed?limit=50 — newest candidates from the CT watcher's append-only feed
 * (data/ct-watch.jsonl or CT_FEED_FILE). A missing or empty feed gives { records: [] }.
 */
import path from "node:path";
import { DEFAULT_FEED_FILE, readFeedTail } from "@/lib/ct/feed";

export async function GET(request: Request): Promise<Response> {
  const raw = Number(new URL(request.url).searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(raw) ? Math.min(500, Math.max(1, Math.floor(raw))) : 50;
  const feed = process.env.CT_FEED_FILE || DEFAULT_FEED_FILE;
  // Read at request time on purpose: the watcher appends to this file while the app runs.
  const file = path.resolve(/*turbopackIgnore: true*/ process.cwd(), feed);
  const headers = { "cache-control": "no-store" };
  try {
    return Response.json({ feed, records: readFeedTail(file, limit), updatedAt: new Date().toISOString() }, { headers });
  } catch (e) {
    return Response.json({ feed, records: [], updatedAt: new Date().toISOString(), error: (e as Error).message }, { headers });
  }
}
