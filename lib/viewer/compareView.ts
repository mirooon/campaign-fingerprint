/**
 * Logic of the comparison view (B-035): the share of each feature family in the pair's score, and the stretches of
 * text two ads have in common. Pure functions.
 */
import type { PairEvidence } from "@/lib/graph/model";
import { contribution } from "./contribution";
import { familyOf, type FeatureFamily } from "./families";

/** A shared stretch of at least this many words is marked; shorter ones are common phrases, not a copied text. */
export const MIN_SHARED_WORDS = 4;

export interface FamilyShare {
  family: FeatureFamily;
  /** Share of the score, 0–1. */
  share: number;
  /** Whole percent; the shares of all families add up to exactly 100. */
  percent: number;
}

/**
 * Share of each feature family (Content, Look, Page, Infrastructure) in the pair's score: the contribution of
 * each premise to the noisy-OR score (skipped premises do not count), summed per family and shown in whole percents
 * that add up to 100 (largest remainder). Premises of unknown type are left out.
 */
export function familyShares(evidence: PairEvidence[]): FamilyShare[] {
  const known = evidence.filter((e) => !e.discounted && familyOf(e.pivotType ?? e.edgeType ?? null));
  const c = contribution(known, (e) => e.weight);
  const byFamily = new Map<FeatureFamily, number>();
  for (const s of c.segments) {
    const f = s.item ? familyOf(s.item.pivotType ?? s.item.edgeType ?? null) : null;
    if (f) byFamily.set(f, (byFamily.get(f) ?? 0) + s.length);
  }
  const total = [...byFamily.values()].reduce((n, v) => n + v, 0);
  if (total <= 0) return [];
  const raw = [...byFamily].map(([family, v]) => ({ family, share: v / total, exact: (v / total) * 100 }));
  const floors = raw.map((r) => Math.floor(r.exact));
  let left = 100 - floors.reduce((n, v) => n + v, 0);
  const order = raw.map((r, i) => ({ i, frac: r.exact - floors[i] })).sort((x, y) => y.frac - x.frac);
  for (const o of order) {
    if (left <= 0) break;
    floors[o.i] += 1;
    left -= 1;
  }
  return raw.map((r, i) => ({ family: r.family, share: r.share, percent: floors[i] })).sort((x, y) => y.percent - x.percent);
}

export interface TextSegment {
  text: string;
  shared: boolean;
}

/** Word for comparison: lower case, letters and digits only; "" for a token with none. */
function norm(token: string): string {
  return token.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Pieces of `text` (words with the white space that follows them) joined into segments: shared runs and the rest. */
function segments(text: string, marked: boolean[]): TextSegment[] {
  const pieces = text.match(/\S+\s*/g) ?? [];
  const out: TextSegment[] = [];
  pieces.forEach((p, i) => {
    const last = out[out.length - 1];
    if (last && last.shared === marked[i]) last.text += p;
    else out.push({ text: p, shared: marked[i] });
  });
  return out;
}

/**
 * Marks the stretches of at least `MIN_SHARED_WORDS` words that both texts contain (case and punctuation ignored):
 * repeatedly takes the longest common run of words not yet marked, so a copied sentence is marked in both ads.
 * Returns each text split into segments that join back to the original.
 */
export function markShared(a: string, b: string, minWords = MIN_SHARED_WORDS): { a: TextSegment[]; b: TextSegment[] } {
  const ta = a.match(/\S+/g) ?? [];
  const tb = b.match(/\S+/g) ?? [];
  const na = ta.map(norm);
  const nb = tb.map(norm);
  const markA = ta.map(() => false);
  const markB = tb.map(() => false);
  for (;;) {
    let best = { len: 0, i: 0, j: 0 };
    let prev = new Array<number>(nb.length + 1).fill(0);
    for (let i = 1; i <= na.length; i++) {
      const row = new Array<number>(nb.length + 1).fill(0);
      for (let j = 1; j <= nb.length; j++) {
        if (na[i - 1] && na[i - 1] === nb[j - 1] && !markA[i - 1] && !markB[j - 1]) {
          row[j] = prev[j - 1] + 1;
          if (row[j] > best.len) best = { len: row[j], i: i - row[j], j: j - row[j] };
        }
      }
      prev = row;
    }
    if (best.len < minWords) break;
    for (let k = 0; k < best.len; k++) {
      markA[best.i + k] = true;
      markB[best.j + k] = true;
    }
  }
  return { a: segments(a, markA), b: segments(b, markB) };
}
