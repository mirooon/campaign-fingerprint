/**
 * ASR adapter (speech in ad videos -> text for the text pipeline).
 *
 * Preference: whisper-cli (whisper.cpp) when the binary AND its model file exist
 * (env WHISPER_MODEL, default ~/models/whisper/ggml-large-v3-turbo.bin); otherwise
 * mlx_whisper, but only when its model is already local (a directory in
 * MLX_WHISPER_MODEL or the Hugging Face cache) so a run never triggers a download.
 * Anything missing -> unavailable / null, never an exception.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultRunner, nonEmptyFile, type ToolRunner } from "./tools";

/** Plain environment map (process.env is assignable; tests can pass literals). */
export type EnvMap = Record<string, string | undefined>;

export interface AsrStatus {
  available: boolean;
  tool: "whisper-cli" | "mlx_whisper" | null;
  model: string | null;
  reason: string | null;
  /** Silero VAD model for whisper-cli (`--vad`): music and silence are not transcribed, so whisper invents nothing there. */
  vadModel?: string | null;
  /** Why whisper-cli runs without VAD (no Silero model file). */
  vadReason?: string | null;
}

export function defaultWhisperModel(env: EnvMap = process.env): string {
  return env.WHISPER_MODEL || path.join(os.homedir(), "models", "whisper", "ggml-large-v3-turbo.bin");
}

/** Silero VAD model of whisper.cpp (env WHISPER_VAD_MODEL, default next to the whisper model). */
export function defaultWhisperVadModel(env: EnvMap = process.env): string {
  return env.WHISPER_VAD_MODEL || path.join(os.homedir(), "models", "whisper", "ggml-silero-v5.1.2.bin");
}

export function defaultMlxModel(env: EnvMap = process.env): string {
  return env.MLX_WHISPER_MODEL || "mlx-community/whisper-large-v3-turbo";
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Is the mlx model available without network: a local directory or a cached HF repo. */
async function mlxModelIsLocal(model: string, env: EnvMap): Promise<boolean> {
  if (await isDir(model)) return true;
  if (!/^[\w.-]+\/[\w.-]+$/.test(model)) return false;
  const hubCache = env.HF_HUB_CACHE || path.join(env.HF_HOME || path.join(os.homedir(), ".cache", "huggingface"), "hub");
  return isDir(path.join(hubCache, `models--${model.replace("/", "--")}`));
}

export async function detectAsr(opts: { run?: ToolRunner; env?: EnvMap } = {}): Promise<AsrStatus> {
  const run = opts.run ?? defaultRunner;
  const env = opts.env ?? process.env;
  const reasons: string[] = [];

  const whisper = await run("whisper-cli", ["--version"], { timeoutMs: 15_000 });
  if (whisper.code === 0) {
    const model = defaultWhisperModel(env);
    if (await nonEmptyFile(model)) {
      const vad = defaultWhisperVadModel(env);
      const hasVad = await nonEmptyFile(vad);
      return { available: true, tool: "whisper-cli", model, reason: null, vadModel: hasVad ? vad : null, vadReason: hasVad ? null : `no VAD: no Silero model ${vad} (set WHISPER_VAD_MODEL)` };
    }
    reasons.push(`whisper-cli: no model ${model} (set WHISPER_MODEL)`);
  } else {
    reasons.push("whisper-cli unavailable");
  }

  const mlx = await run("mlx_whisper", ["--help"], { timeoutMs: 30_000 });
  if (mlx.code === 0) {
    const model = defaultMlxModel(env);
    if (await mlxModelIsLocal(model, env)) return { available: true, tool: "mlx_whisper", model, reason: null };
    reasons.push(`mlx_whisper: model ${model} is not available locally (the first use would download it)`);
  } else {
    reasons.push("mlx_whisper unavailable");
  }
  return { available: false, tool: null, model: null, reason: reasons.join("; ") };
}

/** Extracts mono 16 kHz PCM WAV from any audio/video file with ffmpeg. */
export async function extractAudioWav(
  input: string,
  outWav: string,
  opts: { run?: ToolRunner; timeoutMs?: number } = {},
): Promise<boolean> {
  const run = opts.run ?? defaultRunner;
  const r = await run(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outWav],
    { timeoutMs: opts.timeoutMs ?? 120_000 },
  );
  return r.code === 0 && !r.timedOut && (await nonEmptyFile(outWav));
}

/** True for RIFF/WAVE PCM 16-bit mono 16 kHz (what whisper.cpp expects). */
export async function isWav16kMono(file: string): Promise<boolean> {
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(file, "r");
    const buf = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    if (bytesRead < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return false;
    let off = 12;
    while (off + 8 <= bytesRead) {
      const id = buf.toString("ascii", off, off + 4);
      const size = buf.readUInt32LE(off + 4);
      if (id === "fmt " && off + 24 <= bytesRead) {
        const format = buf.readUInt16LE(off + 8);
        const channels = buf.readUInt16LE(off + 10);
        const rate = buf.readUInt32LE(off + 12);
        const bits = buf.readUInt16LE(off + 22);
        return format === 1 && channels === 1 && rate === 16000 && bits === 16;
      }
      off += 8 + size + (size % 2);
    }
    return false;
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

/** Removes whisper timestamps, non-speech markers and extra whitespace. */
export function cleanTranscript(raw: string): string | null {
  const text = raw
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*\[\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}\]\s*/, "")
        .replace(/[[(]\s*(?:BLANK_AUDIO|MUSIC|NOISE|SILENCE|SOUND|INAUDIBLE)\s*[\])]/gi, " "),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? stripHallucinations(text) : null;
}

/** Sentences whisper invents over music anywhere in a transcript (subtitle credits, end-of-video thanks): never what an ad says. */
const HALLUCINATION = /^(?:napisy (?:stworzone|wykonane|przygotowane) przez .{0,60}|.{0,60}amara\.org.{0,20}|subtitles by .{0,60}|dziękuj[eę](?: bardzo)? za (?:obejrzenie|oglądanie)|thanks? (?:you )?for watching)$/iu;

/**
 * Transcript without the sentences whisper invents over music or silence (subtitle credits, "thanks for
 * watching"), wherever they stand; null when nothing else remains or only silence fillers do. Without this,
 * two music-only videos share a hallucinated sentence and get similar text (content evidence) for nothing.
 */
export function stripHallucinations(text: string): string | null {
  const kept = text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !HALLUCINATION.test(s.replace(/[.!?…]+$/u, "")));
  const out = kept.join(" ").trim();
  return out && !isSilenceFiller(out) ? out : null;
}

/** Phrases whisper writes over silence or music (learnt from subtitle credits), Polish and English. */
const SILENCE_FILLER = /^(?:dziękuj[eę](?: bardzo)?(?: za (?:uwagę|oglądanie|obejrzenie))?|dzięki(?: za oglądanie)?|napisy (?:stworzone|wykonane) przez .{0,60}|thank you(?: for watching)?|thanks for watching|subtitles by .{0,60}|w|you)$/iu;

/** True when a transcript holds nothing but such phrases: a recording without speech, not something the ad says. */
export function isSilenceFiller(text: string): boolean {
  const parts = text.split(/[.!?…]+(?:\s+|$)/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((s) => SILENCE_FILLER.test(s));
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Transcribes speech (Polish by default). Converts non-16k-mono-WAV input with ffmpeg for
 * whisper-cli. Temp files live in a fresh os.tmpdir() directory that is always removed.
 */
export async function transcribe(
  file: string,
  opts: { run?: ToolRunner; lang?: string; timeoutMs?: number; status?: AsrStatus; env?: EnvMap } = {},
): Promise<string | null> {
  const run = opts.run ?? defaultRunner;
  const lang = opts.lang ?? "pl";
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const status = opts.status ?? (await detectAsr({ run, env: opts.env }));
  if (!status.available || !status.tool || !status.model) return null;

  let tmp: string | null = null;
  try {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "starter-asr-"));
    if (status.tool === "whisper-cli") {
      let wav = file;
      if (!(await isWav16kMono(file))) {
        wav = path.join(tmp, "input.wav");
        if (!(await extractAudioWav(file, wav, { run, timeoutMs }))) return null;
      }
      const outBase = path.join(tmp, "transcript");
      const vad = status.vadModel ? ["--vad", "-vm", status.vadModel] : [];
      const r = await run("whisper-cli", ["-m", status.model, "-f", wav, "-l", lang, "-nt", "-np", ...vad, "-otxt", "-of", outBase], { timeoutMs });
      if (r.code !== 0 || r.timedOut) return null;
      return cleanTranscript((await readIfExists(`${outBase}.txt`)) ?? r.stdout);
    }
    const r = await run(
      "mlx_whisper",
      [file, "--model", status.model, "--language", lang, "--output-format", "txt", "--output-dir", tmp, "--output-name", "transcript", "--verbose", "False"],
      { timeoutMs },
    );
    if (r.code !== 0 || r.timedOut) return null;
    const txt = await readIfExists(path.join(tmp, "transcript.txt"));
    return txt === null ? null : cleanTranscript(txt);
  } catch {
    return null;
  } finally {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
  }
}
