/**
 * Speaker-embedding adapter (SpeechBrain ECAPA-TDNN trained on VoxCeleb): two ads voiced by the
 * same speaker (the same voice actor, or the same cloned voice of a public figure) get embeddings
 * with a high cosine, even when the recordings and the words differ. Chromaprint (audioFp) only
 * finds the same recording; this finds the same voice.
 *
 * Runs a Python helper (scripts/py/speaker_embed.py) in a dedicated venv: env SPEAKER_PYTHON,
 * default ./.venv-speaker/bin/python (created by scripts/py/setup-speaker.sh). The model (~85 MB)
 * is fetched into SPEAKER_MODEL_DIR (default ~/models/speechbrain/spkrec-ecapa-voxceleb) on first
 * use. Anything missing -> unavailable / null, never an exception.
 *
 * Measured on test recordings: the same speaker 0.86-0.93, different speakers <= 0.34.
 *
 * Gallery of voices (data/voices/index.json, the same closed list of public figures as for faces):
 * the recording is cut into windows, each window is compared with the mean vector of every person,
 * and the result is "a voice similar to X (0.57)" for a human to review, never "this is X's
 * voice". A persona from a voice is a trait of a group of similar campaigns (a cloned voice of one
 * public figure appears in campaigns of unrelated operators), never proof of one campaign. Only
 * spans (start, end, persona, similarity) leave this module, never a vector of a recording.
 */
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractAudioWav, type EnvMap } from "./asr";
import { defaultRunner, which, type ToolRunner } from "./tools";

export const SPEAKER_MODEL = "speechbrain/spkrec-ecapa-voxceleb";

export interface SpeakerStatus {
  available: boolean;
  python: string | null;
  modelDir: string;
  reason: string | null;
}

export function speakerPython(env: EnvMap = process.env): string {
  return env.SPEAKER_PYTHON || path.join(process.cwd(), ".venv-speaker", "bin", "python");
}

export function speakerModelDir(env: EnvMap = process.env): string {
  return env.SPEAKER_MODEL_DIR || path.join(os.homedir(), "models", "speechbrain", "spkrec-ecapa-voxceleb");
}

/** Folder of the SpeechBrain voice-activity model that tells speech from music: env SPEAKER_VAD_DIR, default ~/models/speechbrain/vad-crdnn-libriparty. */
export function speakerVadDir(env: EnvMap = process.env): string {
  return env.SPEAKER_VAD_DIR || path.join(os.homedir(), "models", "speechbrain", "vad-crdnn-libriparty");
}

export function speakerScript(): string {
  return path.join(process.cwd(), "scripts", "py", "speaker_embed.py");
}

export async function detectSpeaker(opts: { run?: ToolRunner; env?: EnvMap } = {}): Promise<SpeakerStatus> {
  const run = opts.run ?? defaultRunner;
  const env = opts.env ?? process.env;
  const python = speakerPython(env);
  const modelDir = speakerModelDir(env);
  if (!opts.run && !(await which(python, env))) {
    return { available: false, python: null, modelDir, reason: `no interpreter ${python} (run scripts/py/setup-speaker.sh or set SPEAKER_PYTHON)` };
  }
  const r = await run(python, ["-I", "-c", "import speechbrain, soundfile, torch"], { timeoutMs: 60_000 });
  if (r.code !== 0) return { available: false, python, modelDir, reason: `${python}: missing packages speechbrain/soundfile/torch` };
  if (!(await which("ffmpeg", env)) && !opts.run) return { available: false, python, modelDir, reason: "no ffmpeg" };
  return { available: true, python, modelDir, reason: null };
}

/** Parses the helper's stdout; tolerant of junk lines before the JSON. */
export function parseSpeakerOutput(stdout: string): Record<string, number[] | null> {
  const start = stdout.indexOf("{");
  if (start < 0) return {};
  try {
    const json = JSON.parse(stdout.slice(start)) as { embeddings?: Record<string, unknown> };
    const out: Record<string, number[] | null> = {};
    for (const [file, v] of Object.entries(json.embeddings ?? {})) {
      out[file] = Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number" && Number.isFinite(x)) ? (v as number[]) : null;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Embeds the speaker of each audio/video file (one Python process for the whole batch, so the
 * model loads once). Returns input path -> L2-normalised 192-dim embedding, or null.
 */
export async function embedSpeakers(
  files: string[],
  opts: { run?: ToolRunner; env?: EnvMap; python?: string; modelDir?: string; timeoutMs?: number; maxSeconds?: number } = {},
): Promise<Record<string, number[] | null>> {
  const run = opts.run ?? defaultRunner;
  const env = opts.env ?? process.env;
  const result: Record<string, number[] | null> = Object.fromEntries(files.map((f) => [f, null]));
  if (!files.length) return result;
  const dir = await mkdtemp(path.join(os.tmpdir(), "starter-speaker-"));
  try {
    const wavOf = new Map<string, string>();
    for (const [i, f] of files.entries()) {
      const wav = path.join(dir, `${i}.wav`);
      if (await extractAudioWav(f, wav, { run })) wavOf.set(f, wav);
    }
    if (!wavOf.size) return result;
    const r = await run(
      opts.python ?? speakerPython(env),
      ["-I", speakerScript(), "--savedir", opts.modelDir ?? speakerModelDir(env), "--max-seconds", String(opts.maxSeconds ?? 120), ...wavOf.values()],
      { timeoutMs: opts.timeoutMs ?? 120_000 + 20_000 * wavOf.size },
    );
    if (r.code !== 0 || r.timedOut) return result;
    const byWav = parseSpeakerOutput(r.stdout);
    for (const [f, wav] of wavOf) result[f] = byWav[wav] ?? null;
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Cosine of two L2-normalised embeddings (dot product); 0 for mismatched lengths. */
export function speakerSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** A stretch of a recording: seconds from its start, the persona from the gallery when the voice is similar to someone, and the mean cosine of its windows. */
export interface VoiceSpan {
  start: number;
  end: number;
  persona?: string;
  similarity?: number;
}

/** A window of the recording as the helper reports it: time, level (dBFS), speech score (0-1) and the vector (stays inside this module). */
export interface VoiceWindow {
  start: number;
  end: number;
  levelDb: number;
  speech: number;
  embedding: number[];
}

/** Reference vectors of the gallery: person id -> one vector per source recording (each the mean of the windows of the dominant speaker). */
export interface VoiceIndex {
  model: string;
  persons: Record<string, number[][]>;
}

export interface VoiceConfig {
  /** Length of a window in seconds (long enough for a stable ECAPA vector, short enough to separate a voice-over from the voice of a person). */
  windowSeconds: number;
  /** Shift between windows in seconds. */
  stepSeconds: number;
  /** Cosine to the mean vector of a person from which a window counts as similar to them. Measured (docs/TECHNICAL.md, "Persona z głosu"): recordings of one person hold 0.66-0.86 between them, patterns of different people <= 0.49, and 0.5 is the lowest threshold that named no stranger except a voice that is probably the person's own. */
  minSimilarity: number;
  /** Lead of the best person over the second one, so that a voice close to two people names nobody. */
  minMargin: number;
  /** Number of neighbouring windows that must name the same person for the persona to count (2 windows with a 2 s step = 6 s of voice). */
  minWindows: number;
  /** Windows quieter than this (dBFS, RMS) are silence or noise and are dropped. */
  minLevelDb: number;
  /** Windows whose speech score (mean speech probability of the SpeechBrain VAD in the window, 0-1; about 0 for music, noise and silence, 0.92-0.99 for a voice in the measurement) is below this are dropped. */
  minSpeech: number;
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  windowSeconds: 4,
  stepSeconds: 2,
  minSimilarity: 0.5,
  minMargin: 0.15,
  minWindows: 2,
  minLevelDb: -45,
  minSpeech: 0.5,
};

/** Path of the reference vectors of the voice gallery (`data/voices/index.json`, built by `scripts/py/build_voice_index.py`). */
export function voiceIndexFile(): string {
  return path.join(process.cwd(), "data", "voices", "index.json");
}

/** L2-normalised mean of vectors (the pattern of a person from their recordings); null for an empty list or a zero sum. */
function meanVector(vectors: number[][]): number[] | null {
  if (!vectors.length) return null;
  const sum = new Array<number>(vectors[0].length).fill(0);
  for (const v of vectors) for (let i = 0; i < sum.length; i++) sum[i] += v[i] ?? 0;
  const n = Math.sqrt(sum.reduce((a, x) => a + x * x, 0));
  return n > 0 ? sum.map((x) => x / n) : null;
}

/**
 * Names the person of the gallery whose voice a window resembles: the cosine to each person's
 * pattern; the best one counts only when it reaches `minSimilarity` and leads over the second
 * by `minMargin` (a voice between two people names nobody).
 * @returns the person id and the cosine, or null
 */
function bestVoice(embedding: number[], patterns: Array<[string, number[]]>, config: VoiceConfig): { persona: string; similarity: number } | null {
  const scored = patterns.map(([id, p]) => ({ id, cos: speakerSimilarity(embedding, p) })).sort((a, b) => b.cos - a.cos);
  const [best, second] = scored;
  if (!best || best.cos < config.minSimilarity) return null;
  if (best.cos - (second?.cos ?? 0) < config.minMargin) return null;
  return { persona: best.id, similarity: best.cos };
}

/**
 * Turns the windows of one recording into spans for the stored result. Quiet windows and windows
 * with music only are dropped first (their vector describes the background, not a voice). A window
 * that passed the rule carries the persona; neighbouring windows (they overlap by window minus
 * step) with the same persona become one run. A run shorter than `minWindows` windows is not
 * named (one window of a stranger can resemble somebody by chance; a real voice holds for
 * seconds), and its windows count as speech of nobody. Neighbouring runs of the same kind become
 * one span, with the mean cosine of the windows for a persona. Vectors are dropped.
 * @param windows windows in time order, as the helper reports them
 * @returns spans in time order; spans of speech that matches nobody are kept without persona
 */
export function matchVoiceWindows(windows: VoiceWindow[], index: VoiceIndex, config: VoiceConfig = DEFAULT_VOICE_CONFIG): VoiceSpan[] {
  const patterns = Object.entries(index.persons).flatMap(([id, vectors]): Array<[string, number[]]> => {
    const p = meanVector(vectors);
    return p ? [[id, p]] : [];
  });
  const runs: Array<{ start: number; end: number; persona?: string; sum: number; n: number }> = [];
  for (const w of windows) {
    if (w.levelDb < config.minLevelDb || w.speech < config.minSpeech) continue;
    const m = bestVoice(w.embedding, patterns, config);
    const last = runs[runs.length - 1];
    if (last && last.persona === m?.persona && w.start <= last.end) {
      last.end = Math.max(last.end, w.end);
      last.sum += m?.similarity ?? 0;
      last.n++;
    } else runs.push({ start: w.start, end: w.end, ...(m ? { persona: m.persona } : {}), sum: m?.similarity ?? 0, n: 1 });
  }
  const spans: Array<{ start: number; end: number; persona?: string; sum: number; n: number }> = [];
  for (const run of runs) {
    const named = run.persona !== undefined && run.n >= config.minWindows;
    const cur = named ? run : { start: run.start, end: run.end, sum: 0, n: run.n };
    const last = spans[spans.length - 1];
    if (last && !last.persona && !cur.persona && cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else spans.push(cur);
  }
  return spans.map(({ sum, n, ...span }) => (span.persona ? { ...span, similarity: Math.round((sum / n) * 1000) / 1000 } : span));
}

/** Reads data/voices/index.json (built by `scripts/py/build_voice_index.py`); null when it is missing or malformed. */
export function loadVoiceIndex(file: string = voiceIndexFile()): VoiceIndex | null {
  try {
    const json = JSON.parse(readFileSync(file, "utf8")) as Partial<VoiceIndex>;
    return json.persons && typeof json.persons === "object" ? { model: json.model ?? "", persons: json.persons } : null;
  } catch {
    return null;
  }
}

/** True for a helper window with a finite time range, level, speech score and a non-empty finite vector. */
function isVoiceWindow(v: unknown): v is VoiceWindow {
  if (!v || typeof v !== "object") return false;
  const w = v as Record<string, unknown>;
  const nums = ["start", "end", "levelDb", "speech"].every((k) => typeof w[k] === "number" && Number.isFinite(w[k]));
  return nums && Array.isArray(w.embedding) && w.embedding.length > 0 && w.embedding.every((x) => typeof x === "number" && Number.isFinite(x));
}

/** Parses the windows output of the helper (tolerant of junk lines before the JSON): wav path -> windows, or null when the helper gave none; invalid windows are dropped. */
export function parseVoiceWindows(stdout: string): Record<string, VoiceWindow[] | null> {
  const start = stdout.indexOf("{");
  if (start < 0) return {};
  try {
    const json = JSON.parse(stdout.slice(start)) as { windows?: Record<string, unknown> };
    const out: Record<string, VoiceWindow[] | null> = {};
    for (const [file, list] of Object.entries(json.windows ?? {})) out[file] = Array.isArray(list) ? list.filter(isVoiceWindow) : null;
    return out;
  } catch {
    return {};
  }
}

/**
 * Cuts the audio of each file into windows and embeds every window (one Python process for the
 * whole batch, so the model loads once). The vectors stay with the caller, which matches them with
 * the gallery (`matchVoiceWindows`) and keeps only the spans.
 * @returns input path -> windows in time order, or null when the audio could not be read or is shorter than one window
 */
export async function embedSpeakerWindows(
  files: string[],
  opts: { run?: ToolRunner; env?: EnvMap; python?: string; modelDir?: string; vadDir?: string; timeoutMs?: number; maxSeconds?: number; config?: VoiceConfig } = {},
): Promise<Record<string, VoiceWindow[] | null>> {
  const run = opts.run ?? defaultRunner;
  const env = opts.env ?? process.env;
  const config = opts.config ?? DEFAULT_VOICE_CONFIG;
  const result: Record<string, VoiceWindow[] | null> = Object.fromEntries(files.map((f) => [f, null]));
  if (!files.length) return result;
  const dir = await mkdtemp(path.join(os.tmpdir(), "starter-voice-"));
  try {
    const wavOf = new Map<string, string>();
    for (const [i, f] of files.entries()) {
      const wav = path.join(dir, `${i}.wav`);
      if (await extractAudioWav(f, wav, { run })) wavOf.set(f, wav);
    }
    if (!wavOf.size) return result;
    const r = await run(
      opts.python ?? speakerPython(env),
      [
        "-I",
        speakerScript(),
        "--savedir",
        opts.modelDir ?? speakerModelDir(env),
        "--windows",
        "--vad-dir",
        opts.vadDir ?? speakerVadDir(env),
        "--window-seconds",
        String(config.windowSeconds),
        "--step-seconds",
        String(config.stepSeconds),
        "--max-seconds",
        String(opts.maxSeconds ?? 120),
        ...wavOf.values(),
      ],
      { timeoutMs: opts.timeoutMs ?? 120_000 + 30_000 * wavOf.size },
    );
    if (r.code !== 0 || r.timedOut) return result;
    const byWav = parseVoiceWindows(r.stdout);
    for (const [f, wav] of wavOf) result[f] = byWav[wav] ?? null;
    return result;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
