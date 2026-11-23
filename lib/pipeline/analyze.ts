/**
 * "Do której kampanii należy ta reklama?" — enrich ONE new ad (live passive lookups or
 * recorded fixtures) and match it against the existing evidence graph: shared pivots
 * (same entity ids, weighted as in the graph) plus image (dHash) and text (TF-IDF)
 * similarity to existing ads. Nearest-neighbour linkage per campaign.
 */
import { DEFAULT_LINK_CONFIG, type LinkConfig } from "../graph/config";
import { buildEvidenceGraph } from "../graph/link";
import type { CampaignsFile, EvidenceGraph, GraphNode } from "../graph/model";
import { combineScores } from "../graph/weights";
import { hammingDistance } from "../media/imageHash";
import { cosineSparse, fitTfidf } from "../text/similarity";
import { enrichItems } from "./enrich";
import type { EnrichmentSources } from "./sources";
import type { Item } from "./types";

export interface AnalyzeInput {
  url?: string;
  text?: string;
  imageUrl?: string;
}

export interface AnalyzeEvidence {
  evidence: string;
  weight: number;
  strong: boolean;
  discounted: boolean;
  /** Existing ads that share this evidence. */
  items: string[];
}

export interface AnalyzeCandidate {
  campaignId: string;
  size: number;
  score: number;
  strong: boolean;
  nearestItem: string;
  evidence: AnalyzeEvidence[];
}

export interface AnalyzeResult {
  input: AnalyzeInput;
  mode: "live" | "offline";
  enrichment: {
    landingUrl: string | null;
    finalUrl: string | null;
    redirectChain: string[];
    status: number | null;
    title: string | null;
    trackers: string[];
    ips: string[];
    domains: string[];
    contacts: string[];
    wallets: string[];
    imageDhash: string | null;
    errors: string[];
  };
  best: AnalyzeCandidate | null;
  candidates: AnalyzeCandidate[];
  verdict: string;
}

function holdersIndex(graph: EvidenceGraph): (id: string) => string[] {
  const incoming = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.type === "similar_image" || e.type === "similar_text") continue;
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e.source);
  }
  const memo = new Map<string, string[]>();
  return (id: string) => {
    if (memo.has(id)) return memo.get(id)!;
    const items = new Set<string>();
    const seen = new Set([id]);
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const src of incoming.get(cur) ?? []) {
        if (seen.has(src)) continue;
        seen.add(src);
        if (src.startsWith("item:")) items.add(src.slice(5));
        else stack.push(src);
      }
    }
    const out = [...items];
    memo.set(id, out);
    return out;
  };
}

export async function analyzeAd(
  input: AnalyzeInput,
  ctx: { graph: EvidenceGraph; campaigns: CampaignsFile; sources: EnrichmentSources; config?: LinkConfig },
): Promise<AnalyzeResult> {
  const config = ctx.config ?? DEFAULT_LINK_CONFIG;
  const id = "nowa-reklama";
  const item: Item = {
    id,
    platform: null,
    advertiser: null,
    text: input.text?.trim() || null,
    imageUrl: input.imageUrl?.trim() || null,
    imagePath: null,
    landingUrl: input.url?.trim() || null,
    firstSeen: null,
    lastSeen: null,
    label: null,
    persona: null,
    deepfakeScore: null,
    videoPath: null,
    extra: {},
  };
  const ds = await enrichItems([item], { sources: ctx.sources, baseDir: ".", concurrency: 1 });
  const mini = buildEvidenceGraph(ds, { config, textMethod: "none", includeItemPivots: true });
  const pivots = mini.itemPivots?.[id] ?? [];
  const enr = ds.perItem[id];
  const page = enr.pageKey ? ds.pages[enr.pageKey] : null;

  const nodeById = new Map(ctx.graph.nodes.map((n) => [n.id, n]));
  const holders = holdersIndex(ctx.graph);
  const itemCampaign = ctx.campaigns.assignments;

  // Evidence per existing item
  const perItem = new Map<string, Array<{ key: string; evidence: string; weight: number; strong: boolean; discounted: boolean }>>();
  const push = (other: string, ev: { key: string; evidence: string; weight: number; strong: boolean; discounted: boolean }) => {
    if (!perItem.has(other)) perItem.set(other, []);
    perItem.get(other)!.push(ev);
  };
  for (const p of pivots) {
    const stored: GraphNode | undefined = nodeById.get(p.pivot);
    if (!stored || stored.type === "item") continue;
    const weight = (stored.weight ?? 0) * p.relation;
    if (weight <= 0) continue;
    const discountText = stored.discounts.length ? ` — zdyskontowane: ${stored.discounts.map((d) => d.reason).join("; ")}` : "";
    for (const other of holders(p.pivot)) {
      push(other, { key: p.pivot, evidence: `${p.how}${discountText}`, weight, strong: stored.strong && p.relation >= 1, discounted: stored.discounts.length > 0 });
    }
  }
  // Image similarity
  const dhash = enr.image?.dhash ?? null;
  if (dhash) {
    for (const n of ctx.graph.nodes) {
      if (n.type !== "item" || typeof n.data.dhash !== "string") continue;
      const d = hammingDistance(dhash, n.data.dhash);
      if (d > config.similarity.imageHamming) continue;
      const weight = config.similarity.imageWeight * (1 - (0.5 * d) / Math.max(1, config.similarity.imageHamming));
      push(n.key, { key: "similar_image", evidence: `prawie identyczna kreacja (dHash, odległość ${d}/64)`, weight, strong: false, discounted: false });
    }
  }
  // Text similarity (TF-IDF fitted on existing ad texts + the new one)
  if (item.text && item.text.length >= config.similarity.text.minChars) {
    const others = ctx.graph.nodes.filter((n) => n.type === "item" && typeof n.data.text === "string" && (n.data.text as string).length >= config.similarity.text.minChars);
    const model = fitTfidf([...others.map((n) => n.data.text as string), item.text]);
    const v = model.transform(item.text);
    const thr = config.similarity.text.tfidfThreshold;
    for (const n of others) {
      const c = cosineSparse(v, model.transform(n.data.text as string));
      if (c < thr) continue;
      const weight = config.similarity.text.weight * (0.5 + (0.5 * (c - thr)) / (1 - thr));
      push(n.key, { key: "similar_text", evidence: `podobna treść (cosinus ${c.toFixed(2)})`, weight, strong: false, discounted: false });
    }
  }

  // Campaign scores: best linked member (nearest neighbour)
  const byCampaign = new Map<string, AnalyzeCandidate>();
  for (const [other, evs] of perItem) {
    const campaignId = itemCampaign[other];
    if (!campaignId) continue;
    const score = combineScores(evs.map((e) => e.weight));
    const strong = evs.some((e) => e.strong);
    const cur = byCampaign.get(campaignId);
    const size = ctx.campaigns.campaigns.find((c) => c.id === campaignId)?.size ?? 1;
    if (!cur || score > cur.score) {
      byCampaign.set(campaignId, { campaignId, size, score, strong: strong || (cur?.strong ?? false), nearestItem: other, evidence: [] });
    } else if (strong) cur.strong = true;
  }
  // Aggregate evidence across all members of each candidate campaign
  for (const cand of byCampaign.values()) {
    const agg = new Map<string, AnalyzeEvidence>();
    for (const [other, evs] of perItem) {
      if (itemCampaign[other] !== cand.campaignId) continue;
      for (const e of evs) {
        const k = `${e.key}|${e.evidence.split(" (cosine")[0].split(" (dHash")[0]}`;
        const a = agg.get(k) ?? { evidence: e.evidence, weight: e.weight, strong: e.strong, discounted: e.discounted, items: [] };
        a.weight = Math.max(a.weight, e.weight);
        a.items.push(other);
        agg.set(k, a);
      }
    }
    cand.evidence = [...agg.values()].sort((x, y) => y.weight - x.weight || y.items.length - x.items.length).slice(0, 8);
    cand.score = Math.round(cand.score * 1e4) / 1e4;
  }
  const candidates = [...byCampaign.values()]
    .filter((c) => c.score >= 0.05 || c.strong)
    .sort((x, y) => Number(y.strong) - Number(x.strong) || y.score - x.score)
    .slice(0, 5);
  const best = candidates.find((c) => c.strong || c.score >= config.minLinkScore) ?? null;

  const verdict = best
    ? best.strong
      ? `Reklama należy do kampanii ${best.campaignId} (silny dowód: ${best.evidence.find((e) => e.strong)?.evidence ?? best.evidence[0]?.evidence}).`
      : `Reklama najprawdopodobniej należy do kampanii ${best.campaignId} (wynik ${best.score.toFixed(2)}, dowody średniej siły — wymaga weryfikacji).`
    : "Brak wystarczających dowodów łączących reklamę z istniejącymi kampaniami (nowa kampania albo za mało danych).";

  return {
    input,
    mode: ctx.sources.mode,
    enrichment: {
      landingUrl: enr.landing?.url ?? null,
      finalUrl: page?.fetch.finalUrl ?? null,
      redirectChain: page?.fetch.redirectChain.map((h) => `${h.status} ${h.url}`) ?? [],
      status: page?.fetch.status ?? null,
      title: page?.extract?.title ?? null,
      trackers: page?.extract?.trackers.map((t) => `${t.kind}:${t.id}`) ?? [],
      ips: Object.values(ds.hosts).flatMap((h) => h.ips),
      domains: Object.keys(ds.domains),
      contacts: [...new Set([...(enr.text?.emails ?? []), ...(enr.text?.phones ?? []), ...(enr.text?.telegram ?? []), ...(page?.extract?.emails ?? []), ...(page?.extract?.telegram ?? [])])],
      wallets: [...new Set([...(enr.text?.wallets ?? []), ...(page?.extract?.wallets ?? [])].map((w) => `${w.kind}:${w.address}`))],
      imageDhash: dhash,
      errors: [...enr.errors, ...(page?.fetch.error ? [page.fetch.error] : [])],
    },
    best,
    candidates,
    verdict,
  };
}
