import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSceneCuts, sharedShots, shotMidpoints, videoShotHashes } from "./videoShots";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("shot helpers", () => {
  it("parses scene-change timestamps from showinfo output", () => {
    expect(parseSceneCuts("n:0 pts:1 pts_time:2.5 x\nn:1 pts_time:7 y")).toEqual([2.5, 7]);
  });

  it("takes shot midpoints and drops very short shots", () => {
    expect(shotMidpoints([2, 2.1, 6], 10)).toEqual([1, 4.05, 8]);
  });

  it("counts shots with a near-identical hash in the other video", () => {
    expect(sharedShots(["0000000000000001", "f0f0f0f0f0f0f0f0"], ["0000000000000000"]).count).toBe(1);
    expect(sharedShots(["f0f0f0f0f0f0f0f0"], ["0f0f0f0f0f0f0f0f"]).count).toBe(0);
  });
});

describe.skipIf(!hasFfmpeg)("videoShotHashes (ffmpeg)", () => {
  /** Builds a video of 2 s shots from lavfi sources, in the given order. */
  function build(dir: string, name: string, sources: string[]): string {
    const out = path.join(dir, name);
    const args = ["-nostdin", "-loglevel", "error", "-y"];
    for (const s of sources) args.push("-f", "lavfi", "-t", "2", "-i", `${s}=size=320x240:rate=10`);
    const n = sources.length;
    args.push("-filter_complex", `${sources.map((_, i) => `[${i}:v]format=yuv420p[v${i}]`).join(";")};${sources.map((_, i) => `[v${i}]`).join("")}concat=n=${n}:v=1:a=0`, out);
    execFileSync("ffmpeg", args);
    return out;
  }

  it("links videos that share a shot in a different montage and not videos without one", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "shots-test-"));
    try {
      const v1 = build(dir, "a.mp4", ["testsrc", "smptebars", "mandelbrot"]);
      const v2 = build(dir, "b.mp4", ["life", "mandelbrot", "life"]);
      const v3 = build(dir, "c.mp4", ["life", "life"]);
      const [h1, h2, h3] = [await videoShotHashes(v1), await videoShotHashes(v2), await videoShotHashes(v3)];
      expect(h1.length).toBeGreaterThanOrEqual(2);
      expect(sharedShots(h1, h2).count).toBeGreaterThanOrEqual(1);
      expect(sharedShots(h1, h3).count).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
