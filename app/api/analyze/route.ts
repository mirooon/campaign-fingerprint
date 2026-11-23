/**
 * POST /api/analyze  { url?, text?, imageUrl?, offline? }
 * Enriches one new ad (passive lookups, SSRF-guarded; or recorded fixtures when
 * offline) and returns the nearest campaign with evidence.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { analyzeAd } from "@/lib/pipeline/analyze";
import { fixtureSources, liveSources } from "@/lib/pipeline/sources";
import { resolveLinkConfigFile } from "@/lib/pipeline/linkConfigFile";
import { loadLinkConfig } from "@/lib/pipeline/steps";
import { DATA_DIR, loadViewerData, SAMPLE_BASE } from "@/lib/viewer/data";
import { rateLimitResponse } from "@/lib/viewer/rateLimit";

const Body = z
  .object({
    url: z.string().trim().max(2048).optional(),
    text: z.string().trim().max(5000).optional(),
    imageUrl: z.string().trim().max(2048).optional(),
    offline: z.boolean().optional(),
  })
  .refine((b) => !!(b.url || b.text || b.imageUrl), { message: "Give url, text or imageUrl" });

export async function POST(request: Request): Promise<Response> {
  const limited = rateLimitResponse(request);
  if (limited) return limited;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }
  const { graph, campaigns, error } = loadViewerData();
  if (!graph || !campaigns) return Response.json({ error }, { status: 503 });

  // ANALYZE_OFFLINE=1 (a public address) cannot be switched off by the request.
  const offline = process.env.ANALYZE_OFFLINE === "1" || (parsed.data.offline ?? false);
  const sources = offline ? fixtureSources(path.join(DATA_DIR, "sample", "fixtures")) : liveSources({ skipCt: true });
  const sampleConfig = path.join(DATA_DIR, "sample", "linking.json");
  const config = loadLinkConfig(
    resolveLinkConfigFile({ env: process.env.LINK_CONFIG, dataDir: DATA_DIR, sampleConfig: SAMPLE_BASE ? sampleConfig : undefined, exists: existsSync }) ?? undefined,
  );
  try {
    const result = await analyzeAd(
      { url: parsed.data.url, text: parsed.data.text, imageUrl: parsed.data.imageUrl },
      { graph, campaigns, sources, config },
    );
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: `The analysis failed: ${(e as Error).message}` }, { status: 500 });
  }
}
