import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { analyzeVideoOverlays, detectSourceWatermark, detectSubtitleOverlay, PLATFORM_MARKS } from "./videoOverlay";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** A busy synthetic frame (noise-like stripes), optionally with a bottom band of the given kind. */
async function frame(band: "none" | "white" | "blur"): Promise<Buffer> {
  const W = 400;
  const H = 400;
  const buf = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inBand = y >= H * 0.8;
      let v = ((Math.floor(x / 10) * 7 + Math.floor(y / 10) * 13) % 5) * 60;
      if (inBand && band === "white") v = 255;
      if (inBand && band === "blur") v = 128;
      const o = (y * W + x) * 3;
      buf[o] = buf[o + 1] = buf[o + 2] = v;
    }
  }
  return sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

describe("subtitle overlay (B-326)", () => {
  it("finds a white strip at the bottom in the same place in several frames", async () => {
    const f = await frame("white");
    const o = await detectSubtitleOverlay([f, f, f, f]);
    expect(o?.kind).toBe("strip");
    expect(o?.color).toBe("white");
    expect(o?.box.y).toBeCloseTo(0.8, 1);
    expect(o?.key.startsWith("strip:white:")).toBe(true);
  });

  it("finds a blurred band", async () => {
    const f = await frame("blur");
    const o = await detectSubtitleOverlay([f, f, f]);
    expect(o?.kind).toBe("blur");
    expect(o?.box.y).toBeGreaterThanOrEqual(0.75);
  });

  it("finds nothing in a plain busy frame, or when the band shows in too few frames", async () => {
    const plain = await frame("none");
    expect(await detectSubtitleOverlay([plain, plain, plain, plain])).toBeNull();
    expect(await detectSubtitleOverlay([await frame("white"), plain, plain])).toBeNull();
  });
});

describe("source watermark (B-327)", () => {
  it("returns the stable corner text and ignores a platform mark", async () => {
    const f = await frame("none");
    const studio = await detectSourceWatermark([f, f, f], async (file) => (path.basename(file).startsWith("top_right") ? "Studio Test" : null));
    expect(studio).toEqual({ text: "studio test", corner: "top_right", frames: 3 });
    expect(await detectSourceWatermark([f, f, f], async () => "TikTok")).toBeNull();
    expect(PLATFORM_MARKS.has("capcut")).toBe(true);
  });

  it("needs the text in at least two frames", async () => {
    const f = await frame("none");
    const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima"];
    let n = 0;
    expect(await detectSourceWatermark([f, f, f], async () => words[n++])).toBeNull();
  });
});

describe.skipIf(!hasFfmpeg)("video overlays (ffmpeg)", () => {
  it("detects a white strip drawn over the bottom of a video and nothing without it", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "overlay-test-"));
    try {
      const base = ["-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-t", "8", "-i", "testsrc2=size=500x500:rate=5"];
      const withStrip = path.join(dir, "strip.mp4");
      const plain = path.join(dir, "plain.mp4");
      execFileSync("ffmpeg", [...base, "-vf", "drawbox=y=ih-60:w=iw:h=60:color=white:t=fill,format=yuv420p", withStrip]);
      execFileSync("ffmpeg", [...base, "-pix_fmt", "yuv420p", plain]);
      const a = await analyzeVideoOverlays(withStrip);
      expect(a.overlay?.kind).toBe("strip");
      expect((await analyzeVideoOverlays(plain)).overlay).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
