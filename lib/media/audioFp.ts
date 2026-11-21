/**
 * Audio fingerprint adapter (Chromaprint `fpcalc`): two ads that reuse the same
 * voice-over or music track get near-identical raw fingerprints.
 *
 * Similarity is 1 - bit error rate of the raw uint32 fingerprints, maximised over a
 * small time offset. Unrelated audio scores around 0.5 (chance level), so a linking
 * threshold belongs well above that (e.g. >= 0.8).
 */
import { defaultRunner, type ToolRunner } from "./tools";

export interface AudioFingerprint {
  /** Duration in seconds reported by fpcalc. */
  duration: number;
  /** Raw (uncompressed) Chromaprint values as unsigned 32-bit integers. */
  fingerprint: number[];
}

export async function detectFpcalc(opts: { run?: ToolRunner } = {}): Promise<{ available: boolean; version: string | null }> {
  const run = opts.run ?? defaultRunner;
  const r = await run("fpcalc", ["-version"], { timeoutMs: 15_000 });
  if (r.code !== 0) return { available: false, version: null };
  return { available: true, version: /fpcalc version\s+(\d+(?:\.\d+)*)/i.exec(`${r.stdout}\n${r.stderr}`)?.[1] ?? null };
}

/** `fpcalc -raw -json -length <sec> <file>`; null on any failure. */
export async function fingerprintAudio(
  file: string,
  opts: { run?: ToolRunner; timeoutMs?: number; lengthSec?: number } = {},
): Promise<AudioFingerprint | null> {
  const run = opts.run ?? defaultRunner;
  const r = await run("fpcalc", ["-raw", "-json", "-length", String(opts.lengthSec ?? 120), file], { timeoutMs: opts.timeoutMs ?? 60_000 });
  if (r.code !== 0 || r.timedOut) return null;
  try {
    const json = JSON.parse(r.stdout) as { duration?: unknown; fingerprint?: unknown };
    if (!Array.isArray(json.fingerprint)) return null;
    const fingerprint = json.fingerprint
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x))
      .map((x) => x >>> 0);
    if (!fingerprint.length) return null;
    const duration = Number(json.duration);
    return { duration: Number.isFinite(duration) ? duration : 0, fingerprint };
  } catch {
    return null;
  }
}

function popcount32(x: number): number {
  let v = x >>> 0;
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return Math.imul(v, 0x01010101) >>> 24;
}

/**
 * Best (1 - bit error rate) over offsets in [-maxOffset, maxOffset]; offsets whose
 * overlap is shorter than minOverlap values are ignored (0 when none qualifies).
 */
export function fingerprintSimilarity(a: number[], b: number[], opts: { maxOffset?: number; minOverlap?: number } = {}): number {
  const maxOffset = opts.maxOffset ?? 40;
  const minOverlap = opts.minOverlap ?? 20;
  let best = 0;
  for (let off = -maxOffset; off <= maxOffset; off++) {
    const start = Math.max(0, -off);
    const end = Math.min(a.length, b.length - off);
    const n = end - start;
    if (n < minOverlap) continue;
    let errors = 0;
    for (let i = start; i < end; i++) errors += popcount32((a[i] ^ b[i + off]) >>> 0);
    const sim = 1 - errors / (32 * n);
    if (sim > best) best = sim;
  }
  return best;
}
