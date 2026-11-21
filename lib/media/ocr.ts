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
