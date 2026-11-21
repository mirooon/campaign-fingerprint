import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { detectFpcalc, fingerprintAudio, fingerprintSimilarity } from "./audioFp";
import type { RunResult, ToolRunner } from "./tools";

type Call = { cmd: string; args: string[]; timeoutMs?: number };

function fakeRunner(handler: (cmd: string, args: string[]) => Partial<RunResult>, calls: Call[] = []): ToolRunner {
  return async (cmd, args, opts) => {
    calls.push({ cmd, args, timeoutMs: opts?.timeoutMs });
    return { code: 0, stdout: "", stderr: "", timedOut: false, ...handler(cmd, args) };
  };
}

/** Deterministic PRNG for synthetic test data. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("detectFpcalc / fingerprintAudio (fake runner)", () => {
  it("parses the version and the raw JSON fingerprint", async () => {
    expect(await detectFpcalc({ run: fakeRunner(() => ({ stdout: "fpcalc version 1.6.2 (FFmpeg Lavc63.1.102)" })) })).toEqual({ available: true, version: "1.6.2" });
    expect(await detectFpcalc({ run: fakeRunner(() => ({ code: null, stderr: "spawn fpcalc ENOENT" })) })).toEqual({ available: false, version: null });

    const calls: Call[] = [];
    const fp = await fingerprintAudio("/data/lektor.wav", {
      run: fakeRunner(() => ({ stdout: JSON.stringify({ duration: 12.5, fingerprint: [1, 4294967295, -1, "7"] }) }), calls),
    });
    expect(fp).toEqual({ duration: 12.5, fingerprint: [1, 4294967295, 4294967295, 7] });
    expect(calls[0]).toEqual({ cmd: "fpcalc", args: ["-raw", "-json", "-length", "120", "/data/lektor.wav"], timeoutMs: 60_000 });
  });

  it("returns null for failures and unusable output", async () => {
    expect(await fingerprintAudio("a.wav", { run: fakeRunner(() => ({ code: 3, stderr: "ERROR: Empty fingerprint" })) })).toBeNull();
    expect(await fingerprintAudio("a.wav", { run: fakeRunner(() => ({ code: null, timedOut: true })) })).toBeNull();
    expect(await fingerprintAudio("a.wav", { run: fakeRunner(() => ({ stdout: "not json" })) })).toBeNull();
    expect(await fingerprintAudio("a.wav", { run: fakeRunner(() => ({ stdout: JSON.stringify({ duration: 1, fingerprint: [] }) })) })).toBeNull();
  });
});

describe("fingerprintSimilarity", () => {
  const rnd = lcg(7);
  const a = Array.from({ length: 200 }, () => Math.floor(rnd() * 4294967296) >>> 0);

  it("is 1 for identical and time-shifted fingerprints", () => {
    expect(fingerprintSimilarity(a, a)).toBe(1);
    expect(fingerprintSimilarity(a, a.slice(15))).toBe(1);
    expect(fingerprintSimilarity(a.slice(15), a)).toBe(1);
  });

  it("is near chance level (~0.5) for unrelated fingerprints and 0 for tiny overlaps", () => {
    const r2 = lcg(99);
    const b = Array.from({ length: 200 }, () => Math.floor(r2() * 4294967296) >>> 0);
    const s = fingerprintSimilarity(a, b);
    expect(s).toBeGreaterThan(0.4);
    expect(s).toBeLessThan(0.6);
    expect(fingerprintSimilarity(a.slice(0, 10), a.slice(0, 10))).toBe(0);
  });

  it("degrades gracefully with a few flipped bits", () => {
    const noisy = a.map((x, i) => (i % 4 === 0 ? (x ^ 0b101) >>> 0 : x));
    expect(fingerprintSimilarity(a, noisy)).toBeGreaterThan(0.98);
  });
});

// ----- live Chromaprint on synthetic audio (skipped when fpcalc is not installed) -----
const live = await detectFpcalc();
const dir = mkdtempSync(path.join(tmpdir(), "starter-fp-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function writeMelodyWav(file: string, notes: number[], opts: { gain?: number; noise?: number; seed?: number } = {}): void {
  const rate = 11025;
  const noteSec = 0.4;
  const perNote = Math.round(rate * noteSec);
  const total = perNote * notes.length;
  const rnd = lcg(opts.seed ?? 1);
  const pcm = Buffer.alloc(total * 2);
  for (let n = 0; n < notes.length; n++) {
    for (let i = 0; i < perNote; i++) {
      const t = i / rate;
      const env = Math.min(1, i / 200, (perNote - i) / 200);
      const f = notes[n];
      let v = 0.6 * Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t) + 0.1 * Math.sin(6 * Math.PI * f * t);
      v = v * env * (opts.gain ?? 0.8) + (opts.noise ?? 0) * (rnd() * 2 - 1);
      pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), (n * perNote + i) * 2);
    }
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(pcm.length, 40);
  writeFileSync(file, Buffer.concat([h, pcm]));
}

describe("live fpcalc (skipped when not installed)", () => {
  it.skipIf(!live.available)("matches the same track after a volume change and noise, not a different melody", async () => {
    const melodyA = [262, 330, 392, 523, 494, 440, 392, 349, 330, 294, 262, 392, 440, 523, 587, 659, 523, 440, 392, 330, 294, 262, 330, 392, 523, 659];
    const melodyB = [311, 466, 370, 277, 415, 622, 554, 370, 311, 466, 698, 415, 277, 370, 554, 311, 622, 466, 415, 277, 370, 554, 698, 311, 466, 415];
    const fa = path.join(dir, "a.wav");
    const fa2 = path.join(dir, "a-copy.wav");
    const fb = path.join(dir, "b.wav");
    writeMelodyWav(fa, melodyA);
    writeMelodyWav(fa2, melodyA, { gain: 0.55, noise: 0.01, seed: 5 });
    writeMelodyWav(fb, melodyB);
    const [a, a2, b] = await Promise.all([fingerprintAudio(fa), fingerprintAudio(fa2), fingerprintAudio(fb)]);
    expect(a && a2 && b).toBeTruthy();
    const same = fingerprintSimilarity(a!.fingerprint, a2!.fingerprint);
    const diff = fingerprintSimilarity(a!.fingerprint, b!.fingerprint);
    expect(same).toBeGreaterThan(0.8);
    expect(diff).toBeLessThan(same - 0.1);
  });
});
