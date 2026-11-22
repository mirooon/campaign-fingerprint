import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { detectOcr } from "./ocr";
import { filterVideoLines, readVideoText } from "./videoOcr";

describe("filterVideoLines", () => {
  it("dedupes across frames, drops short lines, garbage and player controls", () => {
    const out = filterVideoLines(["  Dr Anna Testowa ", "dr anna testowa.", "0:12 / 0:30", "Skip ad", "ab", "|| ~~ 123 ##", "Program państwowy dla każdego", "Program państwowy dla każdego!"]);
    expect(out).toEqual(["Dr Anna Testowa", "Program państwowy dla każdego"]);
  });

  it("caps the number of lines", () => {
    const many = ["pierwsza linia", "druga kolumna", "trzeci akapit", "czwarty wers", "piąta strofa"];
    expect(filterVideoLines(many, { maxLines: 3 })).toHaveLength(3);
  });
});

/** True when ffmpeg and a tesseract English pack are present. */
async function toolsAvailable(): Promise<boolean> {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    return false;
  }
  return (await detectOcr({ lang: "eng" })).available;
}

const dir = mkdtempSync(path.join(tmpdir(), "videoocr-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const ok = await toolsAvailable();

describe("readVideoText", () => {
  it.skipIf(!ok)("reads two different captions burned into a video", async () => {
    const file = path.join(dir, "cap.mp4");
    // frames are rendered with sharp (ffmpeg builds often lack drawtext), then encoded to a video
    const caption = (t: string) =>
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="black"/><text x="480" y="290" font-size="56" font-family="Helvetica, Arial, sans-serif" fill="white" text-anchor="middle">${t}</text></svg>`);
    const texts = ["DOCTOR ANNA TESTER", "STATE PROGRAMME INVEST"];
    for (let i = 0; i < 6; i++) await sharp(caption(texts[i < 3 ? 0 : 1])).png().toFile(path.join(dir, `s_${i}.png`));
    execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", path.join(dir, "s_%d.png"), "-r", "10", "-pix_fmt", "yuv420p", file]);
    const text = (await readVideoText(file)) ?? "";
    expect(text.toUpperCase()).toContain("ANNA TESTER");
    expect(text.toUpperCase()).toContain("STATE PROGRAMME");
  }, 60_000);

  it("returns null when the tools are missing", async () => {
    const run = async () => ({ code: null, stdout: "", stderr: "ENOENT", timedOut: false });
    expect(await readVideoText("/nonexistent.mp4", { run })).toBeNull();
  });
});
