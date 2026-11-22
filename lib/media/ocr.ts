/**
 * OCR adapter for ad creatives (tesseract CLI, Polish by default).
 * Optional: when tesseract or the language pack is missing, everything returns
 * "unavailable"/null and the caller continues without OCR text.
 */
import { defaultRunner, type ToolRunner } from "./tools";

export interface OcrStatus {
  available: boolean;
  reason: string | null;
  version: string | null;
  langs: string[];
}

const DEFAULT_BIN = "tesseract";

/** Checks the tesseract binary (`--version`) and the requested language(s) (`--list-langs`). */
export async function detectOcr(opts: { run?: ToolRunner; lang?: string; bin?: string } = {}): Promise<OcrStatus> {
  const run = opts.run ?? defaultRunner;
  const bin = opts.bin ?? DEFAULT_BIN;
  const lang = opts.lang ?? "pol";
  const v = await run(bin, ["--version"], { timeoutMs: 15_000 });
  if (v.code !== 0) {
    return { available: false, reason: `${bin} niedostępny (${v.timedOut ? "timeout" : "brak programu lub błąd"})`, version: null, langs: [] };
  }
  const version = /tesseract\s+v?(\d+(?:\.\d+)*)/i.exec(`${v.stdout}\n${v.stderr}`)?.[1] ?? null;
  const l = await run(bin, ["--list-langs"], { timeoutMs: 15_000 });
  const langs =
    l.code === 0
      ? `${l.stdout}\n${l.stderr}`
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => /^[A-Za-z][A-Za-z0-9_]*$/.test(s))
      : [];
  const missing = lang.split("+").filter((code) => !langs.includes(code));
  if (missing.length) {
    return { available: false, reason: `brak danych językowych tesseract: ${missing.join(", ")}`, version, langs };
  }
  return { available: true, reason: null, version, langs };
}

/**
 * OCR of one image file: `tesseract <file> stdout -l pol --psm 3`.
 * Returns whitespace-collapsed text (with `lines`: one recognised line per line), or null on any failure or empty output.
 */
export async function ocrImage(
  file: string,
  opts: { run?: ToolRunner; lang?: string; timeoutMs?: number; psm?: number; bin?: string; lines?: boolean } = {},
): Promise<string | null> {
  const run = opts.run ?? defaultRunner;
  const r = await run(opts.bin ?? DEFAULT_BIN, [file, "stdout", "-l", opts.lang ?? "pol", "--psm", String(opts.psm ?? 3)], {
    timeoutMs: opts.timeoutMs ?? 60_000,
  });
  if (r.code !== 0 || r.timedOut) return null;
  if (opts.lines) {
    // one recognised line per line, for callers that need the layout (e.g. the line above "Sponsored")
    const lines = r.stdout.replace(/\f/g, "\n").split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    return lines.length ? lines.join("\n") : null;
  }
  const text = r.stdout.replace(/\f/g, " ").replace(/\s+/g, " ").trim();
  return text || null;
}

/** A word whose letters are spaced out (B-337), as read from tesseract's per-character boxes. */
export interface OcrSpacedText {
  /** The glued word as recognised, e.g. "Pobierzaplikację". */
  sample: string;
}

/**
 * Finds words with spaced-out letters in hOCR with character boxes (`-c hocr_char_boxes=1 hocr`).
 * A word counts when it has at least `minLetters` character boxes and the median gap between
 * neighbouring letters is at least `ratio` times the median letter width. Returns the first such word.
 */
export function spacedWordsFromHocr(hocr: string, opts: { minLetters?: number; ratio?: number } = {}): OcrSpacedText | null {
  const minLetters = opts.minLetters ?? 5;
  const ratio = opts.ratio ?? 0.8;
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  for (const word of hocr.split(/class=['"]ocrx_word['"]/).slice(1)) {
    const boxes = [...word.matchAll(/x_bboxes (\d+) (\d+) (\d+) (\d+)[^>]*>([^<]*)</g)].map((m) => ({
      x0: Number(m[1]),
      x1: Number(m[3]),
      ch: m[5],
    }));
    if (boxes.length < minLetters) continue;
    const widths = boxes.map((b) => b.x1 - b.x0);
    const gaps = boxes.slice(1).map((b, i) => b.x0 - boxes[i].x1);
    const w = median(widths);
    if (w > 0 && median(gaps) >= ratio * w) return { sample: boxes.map((b) => b.ch).join("") };
  }
  return null;
}

/**
 * Detects spaced-out text in one image: `tesseract <file> stdout -l pol --psm 3 -c hocr_char_boxes=1 hocr`.
 * tesseract glues spaced letters into one word in its text output, but the character boxes keep the gaps.
 * Returns null on any failure or when no spaced word is found.
 */
export async function ocrSpacedText(
  file: string,
  opts: { run?: ToolRunner; lang?: string; timeoutMs?: number; psm?: number; bin?: string } = {},
): Promise<OcrSpacedText | null> {
  const run = opts.run ?? defaultRunner;
  const r = await run(
    opts.bin ?? DEFAULT_BIN,
    [file, "stdout", "-l", opts.lang ?? "pol", "--psm", String(opts.psm ?? 3), "-c", "hocr_char_boxes=1", "hocr"],
    { timeoutMs: opts.timeoutMs ?? 60_000 },
  );
  if (r.code !== 0 || r.timedOut) return null;
  return spacedWordsFromHocr(r.stdout);
}
