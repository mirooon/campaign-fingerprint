/**
 * Reading the browser address bar from screenshots and screen recordings (tesseract, ffmpeg, sharp).
 *
 * The bar sits in the top strip of a phone screenshot. That strip is read on its own (not from the
 * OCR of the whole image, which is later cut down to the sponsored post and would lose the bar).
 * A screen recording is sampled every few seconds; the domains in the bar, in order, show the way
 * from the ad to the landing page and back to the platform. Optional: without the tools every
 * function returns an empty result.
 */
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { parseAddressBar, type AddressBarHit } from "../text/addressBar";
import { defaultRunner, type ToolRunner } from "./tools";

/** Share of the image height that holds the status bar and the address bar of a phone. */
export const TOP_STRIP = 0.14;

export interface ObservedAddress extends AddressBarHit {
  /** Image or video the address was read from. */
  file: string;
  source: "address_bar" | "address_bar_video";
  /** Second of the recording (video only). */
  frameTime?: number;
}

async function ocrStrip(file: string, run: ToolRunner): Promise<string | null> {
  const r = await run("tesseract", [file, "stdout", "-l", "pol", "--psm", "6"], { timeoutMs: 30_000 });
  return r.code === 0 && !r.timedOut ? r.stdout : null;
}

/** Top strip of an image as PNG (null when the image cannot be read). */
export async function topStrip(input: Buffer | string, fraction = TOP_STRIP): Promise<Buffer | null> {
  try {
    const img = sharp(input, { failOn: "none", limitInputPixels: 80_000_000 }).autoOrient();
    const meta = await img.metadata();
    if (!meta.width || !meta.height) return null;
    const height = Math.max(1, Math.round(meta.height * fraction));
    const strip = img.extract({ left: 0, top: 0, width: meta.width, height });
    // small screenshots: upscale so the address font is large enough for OCR
    return await (meta.width < 800 ? strip.resize({ width: meta.width * 2 }) : strip).png().toBuffer();
  } catch {
    return null;
  }
}

/** Addresses in the bar of one screenshot. */
export async function readAddressBar(file: string, opts: { run?: ToolRunner; bytes?: Buffer } = {}): Promise<ObservedAddress[]> {
  const run = opts.run ?? defaultRunner;
  const strip = await topStrip(opts.bytes ?? file);
  if (!strip) return [];
  const dir = await mkdtemp(path.join(os.tmpdir(), "starter-bar-"));
  try {
    const tmp = path.join(dir, "strip.png");
    await writeFile(tmp, strip);
    return parseAddressBar(await ocrStrip(tmp, run)).map((h) => ({ ...h, file, source: "address_bar" as const }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Width and height of the first video stream (ffprobe), or null. */
async function videoSize(file: string, run: ToolRunner): Promise<{ width: number; height: number } | null> {
  const r = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file], { timeoutMs: 30_000 });
  const m = /(\d+)x(\d+)/.exec(r.stdout);
  return r.code === 0 && m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/**
 * Addresses in the bar of a screen recording, one entry per change of address, in order.
 * Only portrait videos (phone recordings) are read; an ad video has no address bar.
 */
export async function readAddressBarVideo(
  file: string,
  opts: { run?: ToolRunner; everySeconds?: number; maxFrames?: number } = {},
): Promise<ObservedAddress[]> {
  const run = opts.run ?? defaultRunner;
  const every = opts.everySeconds ?? 4;
  const size = await videoSize(file, run);
  if (!size || size.height < size.width * 1.5) return [];
  const dir = await mkdtemp(path.join(os.tmpdir(), "starter-barv-"));
  try {
    const r = await run(
      "ffmpeg",
      ["-v", "error", "-y", "-i", file, "-vf", `fps=1/${every},crop=iw:ih*${TOP_STRIP}:0:0`, "-frames:v", String(opts.maxFrames ?? 120), path.join(dir, "f_%04d.png")],
      { timeoutMs: 300_000 },
    );
    if (r.code !== 0) return [];
    const frames = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
    const out: ObservedAddress[] = [];
    let last: string | null = null;
    for (const [i, f] of frames.entries()) {
      const hits = parseAddressBar(await ocrStrip(path.join(dir, f), run)).filter((h) => h.confidence === "high");
      const hit = hits[0];
      if (!hit || hit.url === last) continue;
      last = hit.url;
      out.push({ ...hit, file, source: "address_bar_video", frameTime: i * every });
    }
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
