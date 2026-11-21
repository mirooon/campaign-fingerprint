/**
 * Contribution bar of the premises (§6.3). The pair score is a noisy-OR: s = 1 − Π(1 − wᵢ).
 * Weights sorted from the largest: s_k = 1 − Π_{i≤k}(1 − wᵢ); segment k has length s_k − s_{k−1},
 * so the segments add up exactly to the score.
 *
 * When the stored score of the pair differs from the computed one by more than 0.01:
 * - stored > computed (the stored evidence list is shortened): a "pozostałe przesłanki" segment
 *   fills the gap;
 * - stored < computed (the rules left some premises out, e.g. modus operandi): the segments are
 *   scaled down to the stored score.
 */

export const SCORE_TOLERANCE = 0.01;

export interface Segment<T> {
  /** Premise behind the segment (null for "pozostałe przesłanki"). */
  item: T | null;
  weight: number;
  from: number;
  to: number;
  length: number;
}

export interface Contribution<T> {
  segments: Segment<T>[];
  /** Score from the weights. */
  computed: number;
  /** Score shown (stored when it differs). */
  total: number;
  /** A "pozostałe przesłanki" segment was added. */
  rest: boolean;
}

export function noisyOr(weights: number[]): number {
  let p = 1;
  for (const w of weights) p *= 1 - Math.min(1, Math.max(0, w));
  return 1 - p;
}

export function contribution<T>(items: T[], weightOf: (t: T) => number, stored?: number | null): Contribution<T> {
  const sorted = [...items].sort((a, b) => weightOf(b) - weightOf(a));
  const segments: Segment<T>[] = [];
  let prev = 0;
  let p = 1;
  for (const item of sorted) {
    const w = Math.min(1, Math.max(0, weightOf(item)));
    p *= 1 - w;
    const s = 1 - p;
    segments.push({ item, weight: w, from: prev, to: s, length: s - prev });
    prev = s;
  }
  const computed = prev;
  if (stored === undefined || stored === null || Math.abs(stored - computed) <= SCORE_TOLERANCE) {
    return { segments, computed, total: computed, rest: false };
  }
  if (stored > computed) {
    segments.push({ item: null, weight: 0, from: computed, to: stored, length: stored - computed });
    return { segments, computed, total: stored, rest: true };
  }
  const k = computed > 0 ? stored / computed : 0;
  let at = 0;
  const scaled = segments.map((s) => {
    const length = s.length * k;
    const seg = { ...s, from: at, to: at + length, length };
    at += length;
    return seg;
  });
  return { segments: scaled, computed, total: stored, rest: false };
}
