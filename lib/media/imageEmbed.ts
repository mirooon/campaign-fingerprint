/**
 * Semantic image embeddings for ad creatives (CLIP vision encoder, local ONNX via
 * transformers.js). dHash only matches near-identical files; CLIP also matches
 * variants of one creative template: another face or background, a new crop, a
 * re-laid-out banner. Opt-in: the model (~350 MB) downloads on first use, then
 * runs offline from the transformers.js cache. When it cannot load, callers get
 * "unavailable" and continue without embeddings.
 *
 * Video: frames sampled evenly from the interior of the clip (default 10%–90% of the
 * duration, skipping intros/outros that differ between deployments), each embedded,
 * then averaged and re-normalised. Needs ffmpeg/ffprobe; without them video is skipped.
 */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pLimit from "p-limit";
import { defaultRunner, nonEmptyFile, type ToolRunner } from "./tools";

export const DEFAULT_CLIP_MODEL = "Xenova/clip-vit-base-patch32";

export interface ClipStatus {
  available: boolean;
  model: string;
  reason: string | null;
}

type Embedder = (bytes: Buffer) => Promise<number[]>;

const loaded = new Map<string, Promise<Embedder>>();
const runLimit = pLimit(1);

function modelId(model?: string): string {
  return model || process.env.CLIP_MODEL || DEFAULT_CLIP_MODEL;
}

async function load(model: string): Promise<Embedder> {
  const { AutoProcessor, CLIPVisionModelWithProjection, RawImage } = await import("@huggingface/transformers");
  const processor = await AutoProcessor.from_pretrained(model);
  const vision = await CLIPVisionModelWithProjection.from_pretrained(model, { dtype: "fp32" });
  return async (bytes: Buffer) => {
    const image = await RawImage.fromBlob(new Blob([new Uint8Array(bytes)]));
    const inputs = await processor(image);
    const { image_embeds } = await vision(inputs);
    return normalize(Array.from(image_embeds.data as Float32Array));
  };
}

function getEmbedder(model?: string): Promise<Embedder> {
  const id = modelId(model);
  let p = loaded.get(id);
  if (!p) {
    p = load(id);
    loaded.set(id, p);
    p.catch(() => loaded.delete(id));
  }
  return p;
}

/** Loads the model once (downloading it on first use) and reports whether embeddings work. */
export async function detectClip(model?: string): Promise<ClipStatus> {
  const id = modelId(model);
  try {
    await getEmbedder(id);
    return { available: true, model: id, reason: null };
  } catch (e) {
    return { available: false, model: id, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** L2-normalised CLIP embedding of an image (any format sharp/transformers.js decodes). */
export async function embedImage(bytes: Buffer, model?: string): Promise<number[]> {
  const embedder = await getEmbedder(model);
  return runLimit(() => embedder(bytes));
}

/** Cache key for an image's embedding: model + content hash. */
export function embeddingKey(bytes: Buffer, model?: string): string {
  return `${modelId(model)}:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

/** Rounds components to keep enriched.json small (4 decimals is far below CLIP noise). */
export function compactEmbedding(v: number[]): number[] {
  return v.map((x) => Math.round(x * 1e4) / 1e4);
}

/** Cosine similarity of two embeddings (inputs need not be normalised). */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export interface FrameOptions {
  /** Number of frames to sample (default 8). */
  count?: number;
  /** Interior window as fractions of the duration (default [0.1, 0.9]). */
  window?: [number, number];
  run?: ToolRunner;
}

/** Timestamps (seconds) of `count` frames spread evenly over the interior window. */
export function frameTimestamps(duration: number, count = 8, window: [number, number] = [0.1, 0.9]): number[] {
  if (!(duration > 0) || count < 1) return [0];
  const [a, b] = window;
  const start = duration * a;
  const span = Math.max(0, duration * b - start);
  if (count === 1) return [round3(start + span / 2)];
  return Array.from({ length: count }, (_, i) => round3(start + (span * i) / (count - 1)));
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Video duration in seconds via ffprobe, or null. */
export async function videoDuration(file: string, run: ToolRunner = defaultRunner): Promise<number | null> {
  const r = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { timeoutMs: 30_000 });
  if (r.code !== 0) return null;
  const d = Number.parseFloat(r.stdout.trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

/** Extracts sampled frames as PNG buffers (empty array when ffmpeg/ffprobe fail). */
export async function extractFrames(file: string, opts: FrameOptions = {}): Promise<Buffer[]> {
  const run = opts.run ?? defaultRunner;
  const duration = await videoDuration(file, run);
  if (duration === null) return [];
  const times = frameTimestamps(duration, opts.count ?? 8, opts.window ?? [0.1, 0.9]);
  const dir = await mkdtemp(path.join(os.tmpdir(), "starter-frames-"));
  try {
    const out: Buffer[] = [];
    for (let i = 0; i < times.length; i++) {
      const target = path.join(dir, `f${i}.png`);
      const r = await run(
        "ffmpeg",
        ["-nostdin", "-loglevel", "error", "-y", "-ss", String(times[i]), "-i", file, "-frames:v", "1", "-vf", "scale=448:-2", target],
        { timeoutMs: 60_000 },
      );
      if (r.code === 0 && (await nonEmptyFile(target))) out.push(await readFile(target));
    }
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Mean of L2-normalised vectors, re-normalised (null for an empty list). */
export function meanEmbedding(vectors: number[][]): number[] | null {
  if (!vectors.length) return null;
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    if (v.length !== dim) continue;
    const n = normalize(v);
    for (let i = 0; i < dim; i++) sum[i] += n[i];
  }
  return normalize(sum);
}

/** CLIP embedding of a video: mean over sampled interior frames (null without frames). */
export async function embedVideo(file: string, opts: FrameOptions & { model?: string } = {}): Promise<number[] | null> {
  const frames = await extractFrames(file, opts);
  const vectors: number[][] = [];
  for (const f of frames) vectors.push(await embedImage(f, opts.model));
  return meanEmbedding(vectors);
}
