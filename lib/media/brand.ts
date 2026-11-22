/**
 * Impersonated brand on a creative (B-199, cheap variant): CLIP zero-shot over a short list of media,
 * banks and institutions whose look scams copy. The creative's CLIP image embedding (already computed with
 * `--clip`) is compared with text prompts of each brand and with neutral prompts (a person, a social post,
 * a product); a brand is named only when it clearly wins. A trait of the brand the scam hides behind and of
 * the group of campaigns, never a link: unrelated operators copy the same portal or bank.
 */
import { embedTexts } from "./imageEmbed";

export interface BrandEntry {
  id: string;
  name: string;
  kind: "media" | "bank" | "institution";
}

export interface BrandConfig {
  brands: BrandEntry[];
  /** Prompt templates; "{name}" is replaced by the brand name. */
  prompts: string[];
  /** Prompts of what a creative usually is when no brand is shown. */
  neutral: string[];
  /** CLIP logit scale (cosine × this before softmax). */
  logitScale: number;
  /** Softmax probability the winning brand needs over all brands and neutral prompts. */
  minProbability: number;
}

export const DEFAULT_BRAND_CONFIG: BrandConfig = {
  brands: [
    { id: "tvn24", name: "TVN24", kind: "media" },
    { id: "polsat-news", name: "Polsat News", kind: "media" },
    { id: "tvp-info", name: "TVP Info", kind: "media" },
    { id: "onet", name: "Onet", kind: "media" },
    { id: "wp", name: "Wirtualna Polska", kind: "media" },
    { id: "interia", name: "Interia", kind: "media" },
    { id: "gazeta-pl", name: "Gazeta.pl", kind: "media" },
    { id: "business-insider", name: "Business Insider", kind: "media" },
    { id: "forbes", name: "Forbes", kind: "media" },
    { id: "money-pl", name: "Money.pl", kind: "media" },
    { id: "bankier", name: "Bankier.pl", kind: "media" },
    { id: "rzeczpospolita", name: "Rzeczpospolita", kind: "media" },
    { id: "pko-bp", name: "PKO Bank Polski", kind: "bank" },
    { id: "pekao", name: "Bank Pekao", kind: "bank" },
    { id: "mbank", name: "mBank", kind: "bank" },
    { id: "ing", name: "ING Bank", kind: "bank" },
    { id: "santander", name: "Santander", kind: "bank" },
    { id: "nbp", name: "Narodowy Bank Polski", kind: "institution" },
    { id: "zus", name: "ZUS", kind: "institution" },
    { id: "knf", name: "KNF", kind: "institution" },
    { id: "orlen", name: "Orlen", kind: "institution" },
  ],
  prompts: ["the {name} logo", "a screenshot of the {name} website", "a news article from {name}"],
  neutral: ["a photo of a person", "a screenshot of a social media post", "a photo of a product", "an advertisement with text", "a video frame of a person talking"],
  logitScale: 100,
  minProbability: 0.6,
};

/** Text embeddings of the prompts: per brand (one per template) and the neutral ones. */
export interface BrandVectors {
  brands: Array<BrandEntry & { vectors: number[][] }>;
  neutral: number[][];
}

export interface BrandHit {
  id: string;
  name: string;
  kind: BrandEntry["kind"];
  /** Softmax probability of the brand among all brands and neutral prompts (0–1). */
  probability: number;
}

/** Dot product of two vectors of the same length (cosine for L2-normalised ones). */
function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) s += a[i] * b[i];
  return s;
}

/**
 * Brand on a creative from its L2-normalised CLIP image embedding: each brand scores its best prompt, each
 * neutral prompt scores alone, softmax over all with `logitScale`; the top brand is named when it wins and
 * reaches `minProbability`. Null when a neutral prompt wins or no brand is clear. Pure.
 */
export function matchBrand(image: number[], vectors: BrandVectors, config: Pick<BrandConfig, "logitScale" | "minProbability"> = DEFAULT_BRAND_CONFIG): BrandHit | null {
  const scored = [
    ...vectors.brands.map((b) => ({ brand: b as BrandEntry | null, logit: config.logitScale * Math.max(...b.vectors.map((v) => dot(image, v))) })),
    ...vectors.neutral.map((v) => ({ brand: null as BrandEntry | null, logit: config.logitScale * dot(image, v) })),
  ];
  if (!scored.length) return null;
  const max = Math.max(...scored.map((s) => s.logit));
  const exp = scored.map((s) => Math.exp(s.logit - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  let best = 0;
  for (let i = 1; i < scored.length; i++) if (exp[i] > exp[best]) best = i;
  const top = scored[best];
  const probability = exp[best] / sum;
  if (!top.brand || probability < config.minProbability) return null;
  return { id: top.brand.id, name: top.brand.name, kind: top.brand.kind, probability: Math.round(probability * 1000) / 1000 };
}

const loaded = new Map<string, Promise<BrandVectors>>();

/**
 * Text embeddings of the brand and neutral prompts (CLIP text tower, same model as the image embeddings),
 * computed once per process and model. Rejects when the model cannot load (callers record the reason).
 */
export function brandVectors(config: BrandConfig = DEFAULT_BRAND_CONFIG, model?: string): Promise<BrandVectors> {
  const key = `${model ?? ""}|${config.brands.map((b) => b.id).join(",")}|${config.prompts.join("|")}|${config.neutral.join("|")}`;
  let p = loaded.get(key);
  if (!p) {
    p = (async () => {
      const texts = config.brands.flatMap((b) => config.prompts.map((t) => t.replace("{name}", b.name)));
      const all = await embedTexts([...texts, ...config.neutral], model);
      const per = config.prompts.length;
      return {
        brands: config.brands.map((b, i) => ({ ...b, vectors: all.slice(i * per, (i + 1) * per) })),
        neutral: all.slice(texts.length),
      };
    })();
    loaded.set(key, p);
    p.catch(() => loaded.delete(key));
  }
  return p;
}
