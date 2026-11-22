/**
 * Per-shot perceptual hashes of a video (B-329).
 *
 * The frame-mean CLIP embedding of a video changes when the same shots are cut in a different
 * order or mixed with other shots. A video is split into shots at scene changes (ffmpeg
 * `select=gt(scene,T)`), the middle frame of every shot is hashed (dHash), and two videos that
 * share at least one shot (the same stolen recording, the same AI insert) are linked.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hammingDistance, dHash } from "./imageHash";
import { videoDuration } from "./imageEmbed";
import { defaultRunner, nonEmptyFile, type ToolRunner } from "./tools";

/** Scene-change score above which a new shot starts. */
export const SHOT_SCENE_THRESHOLD = 0.3;
/** Shots shorter than this (seconds) are skipped: transitions, flashes. */
export const MIN_SHOT_SECONDS = 0.4;
/** Most shots hashed per video. */
export const MAX_SHOTS = 40;
/** Hamming distance (of 64 bits) up to which two shot hashes count as the same shot. */
export const SHOT_HAMMING = 6;

/** A hash of a flat frame (black, white, a solid colour) carries no picture: never a shared shot. */
const FLAT_HASHES = new Set(["0000000000000000", "ffffffffffffffff"]);

/** Scene-change timestamps (seconds) parsed from `ffmpeg ... showinfo` output. */
export function parseSceneCuts(stderr: string): number[] {
  const out: number[] = [];
  for (const m of stderr.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)) out.push(Number.parseFloat(m[1]));
  return out.filter((t) => Number.isFinite(t) && t > 0).sort((a, b) => a - b);
}

/** Middle timestamps of the shots between the cuts; shots under MIN_SHOT_SECONDS are dropped, at most MAX_SHOTS kept (evenly thinned). */
export function shotMidpoints(cuts: number[], duration: number): number[] {
  const bounds = [0, ...cuts.filter((c) => c < duration), duration];
  const mids: number[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const len = bounds[i + 1] - bounds[i];
    if (len >= MIN_SHOT_SECONDS) mids.push(Math.round((bounds[i] + len / 2) * 1000) / 1000);
  }
  if (mids.length <= MAX_SHOTS) return mids;
  return Array.from({ length: MAX_SHOTS }, (_, i) => mids[Math.floor((i * mids.length) / MAX_SHOTS)]);
}

/** dHashes of the middle frame of every shot of the video (empty without ffmpeg/ffprobe; flat frames and duplicates dropped). */
export async function videoShotHashes(file: string, run: ToolRunner = defaultRunner): Promise<string[]> {
  const duration = await videoDuration(file, run);
  if (duration === null) return [];
  const scene = await run(
    "ffmpeg",
    ["-nostdin", "-hide_banner", "-i", file, "-vf", `select='gt(scene,${SHOT_SCENE_THRESHOLD})',showinfo`, "-an", "-f", "null", "-"],
    { timeoutMs: 120_000 },
  );
  const times = shotMidpoints(scene.code === 0 ? parseSceneCuts(scene.stderr) : [], duration);
  const dir = await mkdtemp(path.join(os.tmpdir(), "starter-shots-"));
  try {
    const hashes = new Set<string>();
    for (let i = 0; i < times.length; i++) {
      const target = path.join(dir, `s${i}.png`);
      const r = await run(
        "ffmpeg",
        ["-nostdin", "-loglevel", "error", "-y", "-ss", String(times[i]), "-i", file, "-frames:v", "1", "-vf", "scale=448:-2", target],
        { timeoutMs: 60_000 },
      );
      if (r.code !== 0 || !(await nonEmptyFile(target))) continue;
      const h = await dHash(await readFile(target));
      if (!FLAT_HASHES.has(h)) hashes.add(h);
    }
    return [...hashes];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Shots of `a` that have a match (Hamming <= SHOT_HAMMING) among the shots of `b`, with the closest distance of each pair. */
export function sharedShots(a: string[], b: string[], maxDistance = SHOT_HAMMING): { count: number; best: number } {
  let count = 0;
  let best = 64;
  for (const x of a) {
    let d = 64;
    for (const y of b) d = Math.min(d, hammingDistance(x, y));
    if (d <= maxDistance) {
      count++;
      best = Math.min(best, d);
    }
  }
  return { count, best };
}
