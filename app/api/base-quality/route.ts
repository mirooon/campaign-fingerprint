/**
 * GET /api/base-quality — quality of the data of the whole base: per sample the five checks (screenshot, page, HAR,
 * address, video) with the reason and effect of a gap, and counts per check. Reads `provenance.json` of the base when
 * it has one; without it the picture rests on the data of the samples and says so in `note`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { connection } from "next/server";
import { baseQuality } from "@/lib/viewer/baseQuality";
import type { CaseProvenance } from "@/lib/viewer/completeness";
import { DATA_DIR, loadViewerData } from "@/lib/viewer/data";

/** GET /api/base-quality: `BaseQuality`, or `{ error }` (503 without a base, 500 when provenance.json cannot be read). */
export async function GET(): Promise<Response> {
  // Render per request: without it `next build` prerenders this response once from the repository's data/.
  await connection();
  const { graph, error } = loadViewerData();
  if (!graph) return Response.json({ error: error ?? "No base" }, { status: 503 });
  const file = path.join(DATA_DIR, "provenance.json");
  let provenance: CaseProvenance[] | null = null;
  if (existsSync(file)) {
    try {
      provenance = (JSON.parse(readFileSync(file, "utf8")) as { cases?: CaseProvenance[] }).cases ?? [];
    } catch (e) {
      return Response.json({ error: `Could not read provenance.json: ${(e as Error).message}` }, { status: 500 });
    }
  }
  return Response.json(baseQuality({ provenance, nodes: graph.nodes }), { headers: { "cache-control": "no-store" } });
}
