import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE_CONFIG } from "./speaker";
import { evaluateRule, type GalleryRecording } from "./voiceEval";

/** Unit vector of 192 dimensions from the first coordinates. */
function vec(...head: number[]): number[] {
  const v = new Array<number>(192).fill(0);
  head.forEach((x, i) => (v[i] = x));
  return v;
}

/** Two neighbouring windows with the same vector: the shortest stretch that can name a person. */
const win = (embedding: number[]) => [
  { start: 0, end: 4, levelDb: -20, speech: 0.8, embedding },
  { start: 2, end: 6, levelDb: -20, speech: 0.8, embedding },
];

/** Two people with two recordings each: A near e0, B near e1. */
const GALLERY: GalleryRecording[] = [
  { person: "a", key: "a1", vector: vec(1), windows: win(vec(0.8, 0.1, 0.59)) },
  { person: "a", key: "a2", vector: vec(0.95, 0.1, 0.29), windows: win(vec(0.7, 0, 0.71)) },
  { person: "b", key: "b1", vector: vec(0, 1), windows: win(vec(0, 0.8, 0.6)) },
  { person: "b", key: "b2", vector: vec(0, 0.95, 0.31), windows: win(vec(0.7, 0.7)) },
];

describe("voice rule measurement", () => {
  it("counts held-out recordings named right, named as somebody else, and strangers named at all", () => {
    const stranger = { key: "s1", windows: win(vec(0, 0, 1)) };
    const strangerClose = { key: "s2", windows: win(vec(0.9, 0.1, 0.42)) };
    const r = evaluateRule(GALLERY, [stranger, strangerClose], DEFAULT_VOICE_CONFIG);
    // a1 and a2 are named "a"; b1 is named "b"; b2 sits between both people and names nobody
    expect(r.sameHit).toEqual({ n: 3, total: 4 });
    expect(r.sameWrong).toEqual({ n: 0, total: 4 });
    expect(r.strangerHit).toEqual({ n: 1, total: 2 });
    expect(r.strangerWindows).toEqual({ n: 2, total: 4 });
  });
});
