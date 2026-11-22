/**
 * On-screen text of ad videos (burned-in captions, persona names, programme claims).
 *
 * Frames are sampled every few seconds (ffmpeg), each one is read whole with tesseract, and the unique
 * normalised lines are kept (deduplicated across frames, garbage and player-control labels dropped).
 * Optional: without ffmpeg or tesseract the result is null and the caller continues without it.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectOcr, ocrImage } from "./ocr";
import { defaultRunner, type ToolRunner } from "./tools";

/** Sampling and limits of the video text reader (kept low so the import stays fast). */
export const VIDEO_OCR_CONFIG = {
  /** Seconds between sampled frames. */
  everySeconds: 2,
  /** Hard cap of OCR-ed frames per video. */
  maxFrames: 30,
  /** Hard cap of the video seconds read. */
  maxSeconds: 60,
  /** Lines shorter than this (letters only) are dropped. */
  minLetters: 5,
  /** Cap of kept lines. */
  maxLines: 60,
  /** Frame width the frames are scaled to (OCR needs legible captions, not full HD). */
  frameWidth: 960,
};

/** Player controls and platform labels that say nothing about the ad. */
const UI_LABELS = /^(?:sponsorowane|sponsored|learn more|dowiedz się więcej|zobacz więcej|see more|więcej|share|udostępnij|like|comment|skomentuj|lubię to|play|pause|mute|unmute|replay|skip(?: ad)?|pomiń(?: reklamę)?|reklama|ad|\d{1,2}:\d{2}(?: ?\/ ?\d{1,2}:\d{2})?)$/i;

/**
 * Cleans OCR lines of video frames: normalises whitespace, drops very short/garbage lines and
 * UI labels, deduplicates across frames (case/punctuation-insensitive) and keeps the first spelling.
 */
export function filterVideoLines(lines: string[], opts: { minLetters?: number; maxLines?: number } = {}): string[] {
  const minLetters = opts.minLetters ?? VIDEO_OCR_CONFIG.minLetters;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.!?%)"”]+$/gu, "").trim();
    const letters = (line.match(/\p{L}/gu) ?? []).length;
    if (letters < minLetters) continue;
    // garbage: mostly symbols/digits, or no word of 3+ letters
    if (letters / line.replace(/\s/g, "").length < 0.6) continue;
    if (!/\p{L}{3,}/u.test(line)) continue;
    if (UI_LABELS.test(line)) continue;
    const key = line.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!key || seen.has(key)) continue;
    // a line repeated with one trailing/leading OCR slip counts as the same line
    if ([...seen].some((k) => k.length > 12 && (k.includes(key) || key.includes(k)))) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= (opts.maxLines ?? VIDEO_OCR_CONFIG.maxLines)) break;
  }
  return out;
}

let langPromise: Promise<string | null> | null = null;

/** Tesseract language for video frames: `pol+eng` when both packs exist, else `pol`, null when OCR is unavailable. */
async function videoLang(run: ToolRunner): Promise<string | null> {
  if (run !== defaultRunner) {
    return (await detectOcr({ run, lang: "pol+eng" })).available ? "pol+eng" : (await detectOcr({ run, lang: "pol" })).available ? "pol" : null;
  }
  langPromise ??= (async () => ((await detectOcr({ lang: "pol+eng" })).available ? "pol+eng" : (await detectOcr({ lang: "pol" })).available ? "pol" : null))();
  return langPromise;
}

/**
 * Reads the on-screen text of a video: frames every `everySeconds`, whole-frame OCR, unique lines joined by newlines.
 * Returns null without ffmpeg/tesseract, on failure or when nothing legible is found.
 */
export async function readVideoText(
  file: string,
  opts: { run?: ToolRunner; everySeconds?: number; maxFrames?: number; maxSeconds?: number } = {},
): Promise<string | null> {
  const run = opts.run ?? defaultRunner;
  const lang = await videoLang(run);
  if (!lang) return null;
  const every = opts.everySeconds ?? VIDEO_OCR_CONFIG.everySeconds;
  const maxSeconds = opts.maxSeconds ?? VIDEO_OCR_CONFIG.maxSeconds;
  const maxFrames = Math.min(opts.maxFrames ?? VIDEO_OCR_CONFIG.maxFrames, Math.ceil(maxSeconds / every));
  const dir = await mkdtemp(path.join(os.tmpdir(), "starter-vocr-"));
  try {
    const r = await run(
      "ffmpeg",
      ["-v", "error", "-y", "-t", String(maxSeconds), "-i", file, "-vf", `fps=1/${every},scale='min(iw,${VIDEO_OCR_CONFIG.frameWidth})':-2`, "-frames:v", String(maxFrames), path.join(dir, "f_%04d.png")],
      { timeoutMs: 180_000 },
    );
    if (r.code !== 0) return null;
    const frames = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
    const lines: string[] = [];
    for (const f of frames) {
      const t = await ocrImage(path.join(dir, f), { run, lang, psm: 11, lines: true, timeoutMs: 30_000 });
      if (t) lines.push(...t.split("\n"));
    }
    const kept = filterVideoLines(lines);
    return kept.length ? kept.join("\n") : null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
