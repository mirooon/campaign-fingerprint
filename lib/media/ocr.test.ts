import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { detectOcr, ocrImage, ocrSpacedText, spacedWordsFromHocr } from "./ocr";
import type { RunResult, ToolRunner } from "./tools";

type Call = { cmd: string; args: string[]; timeoutMs?: number };

function fakeRunner(handler: (cmd: string, args: string[]) => Partial<RunResult>, calls: Call[] = []): ToolRunner {
  return async (cmd, args, opts) => {
    calls.push({ cmd, args, timeoutMs: opts?.timeoutMs });
    return { code: 0, stdout: "", stderr: "", timedOut: false, ...handler(cmd, args) };
  };
}

const LIST_LANGS = 'List of available languages in "/opt/homebrew/share/tessdata/" (3):\neng\nosd\npol\n';

describe("detectOcr", () => {
  it("reports version and languages from tesseract", async () => {
    const calls: Call[] = [];
    const run = fakeRunner(
      (_cmd, args) => (args[0] === "--version" ? { stdout: "tesseract 5.5.3\n leptonica-1.87.0\n" } : { stdout: LIST_LANGS }),
      calls,
    );
    const s = await detectOcr({ run });
    expect(s).toEqual({ available: true, reason: null, version: "5.5.3", langs: ["eng", "osd", "pol"] });
    expect(calls.map((c) => [c.cmd, ...c.args])).toEqual([
      ["tesseract", "--version"],
      ["tesseract", "--list-langs"],
    ]);
  });

  it("is unavailable when the binary is missing or the language pack is absent", async () => {
    const missing = await detectOcr({ run: fakeRunner(() => ({ code: null, stderr: "spawn tesseract ENOENT" })) });
    expect(missing.available).toBe(false);
    expect(missing.reason).toContain("tesseract");

    const noPol = await detectOcr({
      run: fakeRunner((_c, args) => (args[0] === "--version" ? { stdout: "tesseract 5.5.3" } : { stdout: "List of available languages (1):\neng\n" })),
    });
    expect(noPol).toMatchObject({ available: false, version: "5.5.3", langs: ["eng"] });
    expect(noPol.reason).toContain("pol");

    const combo = await detectOcr({ lang: "pol+eng", run: fakeRunner((_c, args) => (args[0] === "--version" ? { stdout: "tesseract 5.5.3" } : { stdout: LIST_LANGS })) });
    expect(combo.available).toBe(true);
  });
});

describe("ocrImage", () => {
  it("runs `tesseract <file> stdout -l pol --psm 3` and collapses whitespace", async () => {
    const calls: Call[] = [];
    const text = await ocrImage("/tmp/kreacja.png", {
      run: fakeRunner(() => ({ stdout: "Zarabiaj  4800 zł\n\ndziennie\n\f" }), calls),
    });
    expect(text).toBe("Zarabiaj 4800 zł dziennie");
    expect(calls[0]).toMatchObject({ cmd: "tesseract", args: ["/tmp/kreacja.png", "stdout", "-l", "pol", "--psm", "3"], timeoutMs: 60_000 });
  });

  it("returns null on empty output, non-zero exit, timeout or missing binary", async () => {
    expect(await ocrImage("a.png", { run: fakeRunner(() => ({ stdout: " \n\f " })) })).toBeNull();
    expect(await ocrImage("a.png", { run: fakeRunner(() => ({ code: 1, stderr: "Error in pixReadStream" })) })).toBeNull();
    expect(await ocrImage("a.png", { run: fakeRunner(() => ({ code: null, timedOut: true, stdout: "partial" })) })).toBeNull();
    expect(await ocrImage("a.png", { run: fakeRunner(() => ({ code: null, stderr: "ENOENT" })) })).toBeNull();
  });
});

const live = await detectOcr();
const dir = mkdtempSync(path.join(tmpdir(), "starter-ocr-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("live tesseract (skipped when not installed)", () => {
  it.skipIf(!live.available)("recognises Polish text rendered into an image", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="220"><rect width="1400" height="220" fill="#ffffff"/><text x="40" y="140" font-family="Arial, Helvetica, sans-serif" font-size="84" fill="#111111">Zarabiaj 4800 zł dziennie</text></svg>`;
    const file = path.join(dir, "tekst.png");
    await sharp(Buffer.from(svg)).png().toFile(file);
    const text = (await ocrImage(file)) ?? "";
    expect(text.toLowerCase()).toContain("zarabiaj");
    expect(text.toLowerCase()).toContain("dziennie");
  });
});

describe("spacedWordsFromHocr", () => {
  /** Builds a minimal hOCR word from character boxes `[x0, x1, char]`. */
  const word = (chars: [number, number, string][]) =>
    `<span class='ocrx_word' id='w'>${chars.map(([a, b, c]) => `<span class='ocrx_cinfo' title='x_bboxes ${a} 10 ${b} 30; x_conf 99'>${c}</span>`).join("")}</span>`;

  it("flags a word whose letters are spaced out (gap ~ letter width)", () => {
    const spaced = word("Pobierz".split("").map((c, i) => [i * 44, i * 44 + 19, c]));
    expect(spacedWordsFromHocr(spaced)).toEqual({ sample: "Pobierz" });
  });

  it("ignores normal text and short words", () => {
    const normal = word("Pobierz".split("").map((c, i) => [i * 21, i * 21 + 19, c]));
    expect(spacedWordsFromHocr(normal)).toBeNull();
    expect(spacedWordsFromHocr(word("Abc".split("").map((c, i) => [i * 44, i * 44 + 19, c])))).toBeNull();
  });

  it("asks tesseract for hOCR with character boxes and returns null on failure", async () => {
    const calls: Call[] = [];
    expect(await ocrSpacedText("a.png", { run: fakeRunner(() => ({ code: 1 }), calls) })).toBeNull();
    expect(calls[0].args).toEqual(["a.png", "stdout", "-l", "pol", "--psm", "3", "-c", "hocr_char_boxes=1", "hocr"]);
  });
});

describe("live spaced-text detection (skipped when not installed)", () => {
  /** Renders one line of text with the given letter spacing to a PNG file. */
  const render = async (name: string, letterSpacing: number) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="200"><rect width="1400" height="200" fill="#ffffff"/><text x="20" y="110" font-family="Arial, Helvetica, sans-serif" font-size="40" letter-spacing="${letterSpacing}" fill="#111111">Pobierz aplikacje teraz</text></svg>`;
    const file = path.join(dir, name);
    await sharp(Buffer.from(svg)).png().toFile(file);
    return file;
  };

  it.skipIf(!live.available)("flags spaced letters and leaves normal text alone", async () => {
    expect(await ocrSpacedText(await render("spaced.png", 30))).not.toBeNull();
    expect(await ocrSpacedText(await render("normal.png", 0))).toBeNull();
  });
});
