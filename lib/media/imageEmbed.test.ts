import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compactEmbedding, cosine, embeddingKey, extractFrames, frameTimestamps, meanEmbedding, normalize } from "./imageEmbed";
import type { RunResult, ToolRunner } from "./tools";

describe("imageEmbed helpers", () => {
  it("normalises to unit length and keeps zero vectors finite", () => {
    const v = normalize([3, 4]);
    expect(v[0]).toBeCloseTo(0.6);
    expect(v[1]).toBeCloseTo(0.8);
    expect(normalize([0, 0])).toEqual([0, 0]);
  });

  it("computes cosine regardless of scale and rejects mismatched lengths", () => {
    expect(cosine([1, 0], [5, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 2])).toBeCloseTo(0);
    expect(cosine([1, 0], [1, 0, 0])).toBe(0);
  });

  it("rounds components to 4 decimals", () => {
    expect(compactEmbedding([0.123456, -0.98764])).toEqual([0.1235, -0.9876]);
  });

  it("keys embeddings by model and content", () => {
    const a = embeddingKey(Buffer.from("a"), "m1");
    expect(a.startsWith("m1:")).toBe(true);
    expect(embeddingKey(Buffer.from("a"), "m2")).not.toBe(a);
    expect(embeddingKey(Buffer.from("b"), "m1")).not.toBe(a);
  });
});

describe("video frames", () => {
  it("spreads timestamps over the interior window", () => {
    expect(frameTimestamps(10, 5)).toEqual([1, 3, 5, 7, 9]);
    expect(frameTimestamps(10, 1)).toEqual([5]);
    expect(frameTimestamps(0, 8)).toEqual([0]);
    expect(frameTimestamps(20, 3, [0.25, 0.75])).toEqual([5, 10, 15]);
  });

  it("averages normalised vectors and re-normalises", () => {
    const m = meanEmbedding([[2, 0], [0, 5]])!;
    expect(m[0]).toBeCloseTo(Math.SQRT1_2);
    expect(m[1]).toBeCloseTo(Math.SQRT1_2);
    expect(meanEmbedding([])).toBeNull();
  });

  it("probes the duration, seeks once per frame and keeps only written frames", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    let n = 0;
    const run: ToolRunner = async (cmd, args): Promise<RunResult> => {
      calls.push({ cmd, args });
      if (cmd === "ffprobe") return { code: 0, stdout: "12.5\n", stderr: "", timedOut: false };
      n++;
      if (n !== 2) writeFileSync(args[args.length - 1], "png-bytes"); // second frame fails silently
      return { code: 0, stdout: "", stderr: "", timedOut: false };
    };
    const frames = await extractFrames("/x/ad.mp4", { count: 3, run });
    expect(frames.map((f) => f.toString())).toEqual(["png-bytes", "png-bytes"]);
    const seeks = calls.filter((c) => c.cmd === "ffmpeg").map((c) => c.args[c.args.indexOf("-ss") + 1]);
    expect(seeks).toEqual(["1.25", "6.25", "11.25"]);
  });

  it("returns no frames when ffprobe fails", async () => {
    const run: ToolRunner = async () => ({ code: 1, stdout: "", stderr: "no such file", timedOut: false });
    expect(await extractFrames("/x/missing.mp4", { run })).toEqual([]);
  });
});
