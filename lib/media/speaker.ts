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
 */
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

export function speakerScript(): string {
  return path.join(process.cwd(), "scripts", "py", "speaker_embed.py");
}

export async function detectSpeaker(opts: { run?: ToolRunner; env?: EnvMap } = {}): Promise<SpeakerStatus> {
  const run = opts.run ?? defaultRunner;
  const env = opts.env ?? process.env;
  const python = speakerPython(env);
  const modelDir = speakerModelDir(env);
  if (!opts.run && !(await which(python, env))) {
    return { available: false, python: null, modelDir, reason: `brak interpretera ${python} (uruchom scripts/py/setup-speaker.sh albo ustaw SPEAKER_PYTHON)` };
  }
  const r = await run(python, ["-I", "-c", "import speechbrain, soundfile, torch"], { timeoutMs: 60_000 });
  if (r.code !== 0) return { available: false, python, modelDir, reason: `${python}: brak pakietów speechbrain/soundfile/torch` };
  if (!(await which("ffmpeg", env)) && !opts.run) return { available: false, python, modelDir, reason: "brak ffmpeg" };
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
