/**
 * POST /api/analyze  { url?, text?, imageUrl?, offline? }
 * Enriches one new ad (passive lookups, SSRF-guarded; or recorded fixtures when
 * offline) and returns the nearest campaign with evidence.
 */
import path from "node:path";
import { z } from "zod";
import { analyzeAd } from "@/lib/pipeline/analyze";
import { fixtureSources, liveSources } from "@/lib/pipeline/sources";
import { loadLinkConfig } from "@/lib/pipeline/steps";
import { DATA_DIR, loadViewerData } from "@/lib/viewer/data";

const Body = z
  .object({
    url: z.string().trim().max(2048).optional(),
    text: z.string().trim().max(5000).optional(),
    imageUrl: z.string().trim().max(2048).optional(),
    offline: z.boolean().optional(),
  })
  .refine((b) => !!(b.url || b.text || b.imageUrl), { message: "Podaj url, text lub imageUrl" });

export async function POST(request: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Niepoprawny JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }
  const { graph, campaigns, error } = loadViewerData();
  if (!graph || !campaigns) return Response.json({ error }, { status: 503 });

  const offline = parsed.data.offline ?? process.env.ANALYZE_OFFLINE === "1";
  const sources = offline ? fixtureSources(path.join(DATA_DIR, "sample", "fixtures")) : liveSources({ skipCt: true });
  const config = loadLinkConfig(process.env.LINK_CONFIG ?? path.join(DATA_DIR, "sample", "linking.json"));
  try {
    const result = await analyzeAd(
      { url: parsed.data.url, text: parsed.data.text, imageUrl: parsed.data.imageUrl },
      { graph, campaigns, sources, config },
    );
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: `Analiza nie powiodła się: ${(e as Error).message}` }, { status: 500 });
  }
}
