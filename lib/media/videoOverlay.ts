/**
 * Overlays on a stolen video (B-326, B-327).
 *
 *  - Replaced subtitles (B-326): the operator blurs or covers the original captions at the bottom of a
 *    borrowed recording (an interview, a news item) and lays their own text on it. Detected on frames
 *    sampled every 2 s: a bottom band that is flat (a solid strip, white or black) or much blurrier than
 *    the rest of the frame, in the same place for at least MIN_FRAMES frames. The fingerprint of the
 *    montage (kind, colour, position and size relative to the frame) is the key `overlay_template`.
 *  - Source watermark (B-327): a logo or the name of the studio or station of the original recording in
 *    a corner of the frame, read by OCR of the corners. A mark of an editor or a platform is a mask.
 *
 * Attributes of the material; the keys are template traces, never a link on their own.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { ocrImage } from "./ocr";
import { defaultRunner, type ToolRunner } from "./tools";

/** Seconds between sampled frames. */
export const FRAME_EVERY_SECONDS = 2;
/** Most frames sampled per video. */
export const MAX_OVERLAY_FRAMES = 30;
/** Frames in which the same overlay must appear. */
export const MIN_FRAMES = 3;
/** Size of the grayscale grid the overlay search runs on. */
const GRID = 120;
/** Share of the bottom rows searched for an overlay. */
const BOTTOM_SHARE = 0.4;
/** A row is solid when this share of its pixels lies within SOLID_TOLERANCE of the row median. */
const SOLID_SHARE = 0.8;
const SOLID_TOLERANCE = 14;
/** A solid strip is white or black (original captions are covered by a plain bar). */
const STRIP_LIGHT = 215;
const STRIP_DARK = 40;
/** Thinnest overlay (share of the frame height) worth reporting. */
const MIN_BAND = 0.06;
/** A blurred band has less than this share of the detail (Laplacian energy) of the upper frame. */
const BLUR_RATIO = 0.2;
/** Detail of the upper frame below which a blur cannot be told from a plain picture. */
const MIN_UPPER_ENERGY = 4;
/** Quantisation of the fingerprint (share of the frame). */
const QUANT = 0.05;

export interface OverlayBox {
  /** Left edge, top edge, width and height as shares of the frame (0..1), quantised. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SubtitleOverlay {
  kind: "strip" | "blur";
  /** Colour of a solid strip. */
  color?: "white" | "black";
  box: OverlayBox;
  /** Frames (of those sampled) in which the overlay was found. */
  frames: number;
  /** Fingerprint of the montage: `kind:colour:x,y,w,h`. */
  key: string;
}

export interface SourceWatermark {
  /** Normalised text of the mark (lower-case words). */
  text: string;
  corner: "top_left" | "top_right" | "bottom_left" | "bottom_right";
  frames: number;
}

export type OcrFn = (file: string) => Promise<string | null>;

/** Marks of editors and platforms: they say where the video was edited or posted, not where it came from. */
export const PLATFORM_MARKS = new Set(["capcut", "tiktok", "instagram", "facebook", "youtube", "reels", "shorts", "meta", "inshot", "canva", "kinemaster", "filmora", "vn", "vllo", "snapchat", "twitter", "x"]);

const q = (v: number) => Math.round(v / QUANT) * QUANT;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Frames sampled every FRAME_EVERY_SECONDS as PNG buffers (empty without ffmpeg or on error). */
export async function sampleFrames(file: string, run: ToolRunner = defaultRunner): Promise<Buffer[]> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "starter-overlay-"));
  try {
    const r = await run(
      "ffmpeg",
      ["-nostdin", "-loglevel", "error", "-y", "-i", file, "-vf", `fps=1/${FRAME_EVERY_SECONDS},scale=800:-2`, "-frames:v", String(MAX_OVERLAY_FRAMES), path.join(dir, "f%03d.png")],
      { timeoutMs: 120_000 },
    );
    if (r.code !== 0) return [];
    const names = (await readdir(dir)).filter((n) => n.endsWith(".png")).sort();
    return await Promise.all(names.map((n) => readFile(path.join(dir, n))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Grayscale GRID x GRID pixels of a frame (the aspect ratio is dropped: positions are shares of the frame). */
async function grid(frame: Buffer): Promise<number[][]> {
  const { data } = await sharp(frame, { failOn: "none" }).grayscale().resize(GRID, GRID, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  return Array.from({ length: GRID }, (_, y) => Array.from({ length: GRID }, (_, x) => data[y * GRID + x]));
}

/** Per-pixel Laplacian energy of a row (interior pixels only). */
function rowDetail(px: number[][], y: number): number[] {
  const out: number[] = [];
  for (let x = 1; x < GRID - 1; x++) out.push(Math.abs(4 * px[y][x] - px[y - 1][x] - px[y + 1][x] - px[y][x - 1] - px[y][x + 1]));
  return out;
}

const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

/** Solid colour of a row (its median) when SOLID_SHARE of the pixels stay within SOLID_TOLERANCE of it, else null. */
function solidRow(row: number[]): number | null {
  const sorted = [...row].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const near = row.filter((v) => Math.abs(v - med) <= SOLID_TOLERANCE).length;
  return near / row.length >= SOLID_SHARE ? med : null;
}

/** Overlay (solid strip or blurred band) at the bottom of one frame, or null. */
export function overlayInFrame(px: number[][]): Omit<SubtitleOverlay, "frames" | "key"> | null {
  const firstRow = Math.floor(GRID * (1 - BOTTOM_SHARE));
  // detail of the picture above the searched band: the reference for "blurred"
  const upperRows = Array.from({ length: Math.max(1, firstRow - 2) }, (_, i) => mean(rowDetail(px, i + 1)));
  const upper = mean(upperRows);

  // solid strip: contiguous run of solid rows ending at the bottom edge, white or black
  let top = GRID;
  let color: "white" | "black" | null = null;
  for (let y = GRID - 1; y >= firstRow; y--) {
    const c = solidRow(px[y]);
    const kind = c === null ? null : c >= STRIP_LIGHT ? "white" : c <= STRIP_DARK ? "black" : null;
    if (kind === null || (color !== null && kind !== color)) break;
    color = kind;
    top = y;
  }
  if (color && (GRID - top) / GRID >= MIN_BAND && upper >= MIN_UPPER_ENERGY) {
    return { kind: "strip", color, box: { x: 0, y: q(top / GRID), w: 1, h: q((GRID - top) / GRID) } };
  }

  // blurred band: rows of the bottom part with little detail where the upper frame has plenty
  if (upper < MIN_UPPER_ENERGY) return null;
  let blurTop = GRID;
  for (let y = GRID - 2; y >= firstRow; y--) {
    if (mean(rowDetail(px, y)) / upper > BLUR_RATIO) break;
    blurTop = y;
  }
  if ((GRID - blurTop) / GRID < MIN_BAND) return null;
  const cols: number[] = [];
  for (let x = 1; x < GRID - 1; x++) {
    let e = 0;
    for (let y = blurTop; y < GRID - 1; y++) e += Math.abs(4 * px[y][x] - px[y - 1][x] - px[y + 1][x] - px[y][x - 1] - px[y][x + 1]);
    if (e / (GRID - 1 - blurTop) / upper <= BLUR_RATIO) cols.push(x);
  }
  if (!cols.length) return null;
  const x0 = Math.min(...cols);
  const x1 = Math.max(...cols);
  return { kind: "blur", box: { x: q(x0 / GRID), y: q(blurTop / GRID), w: q((x1 - x0 + 1) / GRID), h: q((GRID - blurTop) / GRID) } };
}

/** The subtitle overlay present in at least MIN_FRAMES frames in the same place (kind, colour, quantised box), or null. */
export async function detectSubtitleOverlay(frames: Buffer[]): Promise<SubtitleOverlay | null> {
  const counts = new Map<string, { o: Omit<SubtitleOverlay, "frames" | "key">; n: number }>();
  for (const f of frames) {
    const o = overlayInFrame(await grid(f));
    if (!o) continue;
    const key = `${o.kind}:${o.color ?? "-"}:${r2(o.box.x)},${r2(o.box.y)},${r2(o.box.w)},${r2(o.box.h)}`;
    const cur = counts.get(key);
    if (cur) cur.n++;
    else counts.set(key, { o, n: 1 });
  }
  const best = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  if (!best || best[1].n < MIN_FRAMES) return null;
  return { ...best[1].o, frames: best[1].n, key: best[0] };
}

const CORNERS: Array<SourceWatermark["corner"]> = ["top_left", "top_right", "bottom_left", "bottom_right"];

/** Crop of a corner of the frame (28% x 14%), enlarged and in gray, as PNG bytes. */
async function cornerCrop(frame: Buffer, corner: SourceWatermark["corner"]): Promise<Buffer> {
  const meta = await sharp(frame, { failOn: "none" }).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const w = Math.max(8, Math.floor(W * 0.28));
  const h = Math.max(8, Math.floor(H * 0.14));
  const left = corner.endsWith("left") ? 0 : W - w;
  const top = corner.startsWith("top") ? 0 : H - h;
  return sharp(frame, { failOn: "none" }).extract({ left, top, width: w, height: h }).grayscale().normalise().resize({ width: w * 3 }).png().toBuffer();
}

/** Lower-case words of at least 3 letters of an OCR result. */
function markWords(text: string): string[] {
  return (text.toLowerCase().match(/\p{L}{3,}/gu) ?? []).slice(0, 4);
}

/**
 * The name or logo text of the original recording in a corner, seen in at least 2 frames; null when the
 * corner words are only a mark of an editor or a platform (a mask) or nothing stable is read.
 */
export async function detectSourceWatermark(frames: Buffer[], ocr: OcrFn): Promise<SourceWatermark | null> {
  if (frames.length < 2) return null;
  const dir = await mkdtemp(path.join(os.tmpdir(), "starter-wm-"));
  try {
    const seen = new Map<string, { n: number; corner: SourceWatermark["corner"] }>();
    for (const corner of CORNERS) {
      const inCorner = new Map<string, number>();
      for (const [i, f] of frames.entries()) {
        const file = path.join(dir, `${corner}${i}.png`);
        await writeFile(file, await cornerCrop(f, corner));
        for (const w of new Set(markWords((await ocr(file)) ?? ""))) inCorner.set(w, (inCorner.get(w) ?? 0) + 1);
      }
      for (const [w, n] of inCorner) if (n >= 2 && !PLATFORM_MARKS.has(w)) seen.set(`${corner}:${w}`, { n, corner });
    }
    const words = new Map<SourceWatermark["corner"], Array<{ w: string; n: number }>>();
    for (const [k, v] of seen) words.set(v.corner, [...(words.get(v.corner) ?? []), { w: k.slice(v.corner.length + 1), n: v.n }]);
    const best = [...words.entries()].sort((a, b) => Math.max(...b[1].map((x) => x.n)) - Math.max(...a[1].map((x) => x.n)))[0];
    if (!best) return null;
    const list = best[1].sort((a, b) => b.n - a.n || a.w.localeCompare(b.w));
    return { text: list.map((x) => x.w).sort().join(" "), corner: best[0], frames: Math.max(...list.map((x) => x.n)) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** OCR of a cropped corner: a single block of text, English letters and digits (logos of stations and studios). */
export function cornerOcr(run: ToolRunner = defaultRunner): OcrFn {
  return (file) => ocrImage(file, { run, lang: "eng", psm: 6 });
}

/** Overlay and watermark of one video from one pass of frame sampling (`ocr` null skips the watermark). */
export async function analyzeVideoOverlays(file: string, opts: { run?: ToolRunner; ocr?: OcrFn | null } = {}): Promise<{ overlay: SubtitleOverlay | null; watermark: SourceWatermark | null }> {
  const frames = await sampleFrames(file, opts.run ?? defaultRunner);
  if (!frames.length) return { overlay: null, watermark: null };
  const overlay = await detectSubtitleOverlay(frames);
  const watermark = opts.ocr ? await detectSourceWatermark(frames, opts.ocr) : null;
  return { overlay, watermark };
}
