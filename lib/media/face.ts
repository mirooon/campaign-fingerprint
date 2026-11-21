/**
 * Face similarity to a small CLOSED list of public figures (data/osoby-publiczne.json), for the
 * persona of ads that show a face without a caption. OpenCV YuNet detects faces, SFace (128-d
 * embeddings, cosine) compares them with 3-5 reference photos per person (data/faces/index.json).
 *
 * What the result means: "a face similar to X (0.xx)" for a human to review, never "this is X".
 * Only people on the list can be named; faces that match nobody are kept as a box without a
 * persona, and no vector (matched or not) leaves this module: the result carries a box, the
 * persona id and the similarity only. A persona from a face is a trait of a group of similar
 * campaigns (a public figure is bait in many campaigns), never proof that two materials belong
 * to one campaign.
 *
 * Runs a Python helper (scripts/py/face_embed.py) in a venv: env FACE_PYTHON, default
 * ./.venv-face/bin/python (created by scripts/py/setup-face.sh). The two ONNX models (~40 MB,
 * MIT and Apache-2.0) are read from FACE_MODEL_DIR (default ~/models/opencv). Anything missing
 * -> { skipped: reason }, never an exception.
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cosine } from "./imageEmbed";
import { defaultRunner, nonEmptyFile, which, type ToolRunner } from "./tools";

export interface FaceHit {
  image: string;
  x: number;
  y: number;
  w: number;
  h: number;
  persona?: string;
  similarity?: number;
}

/** A face as the helper reports it: box in pixels, detector score 0-1 and the 128-d vector (stays inside this module). */
export interface RawFace {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  embedding: number[];
}

/** Reference vectors of the closed list: person id -> vectors of their reference photos. */
export interface FaceIndex {
  model: string;
  persons: Record<string, number[][]>;
}

export interface FaceConfig {
  /** Weighted cosine from which a face counts as similar to a person. Measured (docs/TECHNICAL.md, "Persona z twarzy"): SFace's recommended 0.363 gave 9.3% false hits on 54 faces of other public figures, 0.46 gave none while keeping 96.7% of same-person pairs. */
  matchThreshold: number;
  /** Faces with the shorter side below this many pixels are not matched (too little detail for a recognisable vector). */
  minFaceSide: number;
  /** Shorter side (px) from which the size does not lower the weight of a match. */
  refFaceSide: number;
  /** Detector score from which the score does not lower the weight of a match. */
  refDetectorScore: number;
}

export const DEFAULT_FACE_CONFIG: FaceConfig = {
  matchThreshold: 0.46,
  minFaceSide: 24,
  refFaceSide: 80,
  refDetectorScore: 0.9,
};

/** The two ONNX models of OpenCV Zoo that the helper loads from FACE_MODEL_DIR. */
export const FACE_MODEL_FILES = ["face_detection_yunet_2023mar.onnx", "face_recognition_sface_2021dec.onnx"] as const;

export const FACE_UNAVAILABLE = "brak adaptera twarzy (scripts/py/setup-face.sh)";

type EnvMap = Record<string, string | undefined>;

/** Interpreter of the face venv: env FACE_PYTHON, else `.venv-face/bin/python` in the working directory (created by setup-face.sh). */
export function facePython(env: EnvMap = process.env): string {
  return env.FACE_PYTHON || path.join(process.cwd(), ".venv-face", "bin", "python");
}

/** Folder with the two ONNX models: env FACE_MODEL_DIR, else `~/models/opencv` (outside the repository). */
export function faceModelDir(env: EnvMap = process.env): string {
  return env.FACE_MODEL_DIR || path.join(os.homedir(), "models", "opencv");
}

/** Path of the Python helper (resolved against the working directory, like the other adapters). */
export function faceScript(): string {
  return path.join(process.cwd(), "scripts", "py", "face_embed.py");
}

/** Path of the reference vectors of the closed list (`data/faces/index.json`, built by `face_embed.py --build-index`). */
export function faceIndexFile(): string {
  return path.join(process.cwd(), "data", "faces", "index.json");
}

/**
 * Weight of a match in 0-1: 1 for a large face found with a high detector score, lower for a
 * small or uncertain one (a quality-aware score in the spirit of MagFace: a poor face yields an
 * unreliable vector, so its similarity should count for less).
 * @param face shorter side from `w`/`h` in pixels and the detector `score` (0-1)
 */
export function faceQuality(face: { w: number; h: number; score: number }, config: FaceConfig = DEFAULT_FACE_CONFIG): number {
  const size = Math.min(1, Math.min(face.w, face.h) / config.refFaceSide);
  const detector = Math.min(1, Math.max(0, face.score) / config.refDetectorScore);
  return size * detector;
}

/**
 * Best match of one face on the closed list: per person the highest cosine to any of their
 * reference vectors, times the face quality; the person with the highest such score wins, and
 * only when it reaches the threshold.
 * @returns the person id and the weighted similarity, or null when nobody reaches the threshold
 */
function bestMatch(face: RawFace, index: FaceIndex, threshold: number, config: FaceConfig, only?: string): { persona: string; similarity: number } | null {
  if (Math.min(face.w, face.h) < config.minFaceSide) return null;
  const quality = faceQuality(face, config);
  let best: { persona: string; similarity: number } | null = null;
  for (const [id, vectors] of Object.entries(index.persons)) {
    if (only && id !== only) continue;
    let top = -1;
    for (const v of vectors) top = Math.max(top, cosine(face.embedding, v));
    const similarity = top * quality;
    if (similarity >= threshold && (!best || similarity > best.similarity)) best = { persona: id, similarity };
  }
  return best;
}

/**
 * Turns the helper's faces into the stored result. A face that matches nobody keeps its box
 * (so the number of faces is known) but gets no persona and no similarity. Vectors are dropped.
 * @param raw image path (as it was passed in) -> faces found in it
 * @param opts.threshold overrides the weighted-cosine threshold; opts.only restricts the list to
 *   one person id (1:1 verification at that person's request)
 */
export function matchFaces(
  raw: Record<string, RawFace[]>,
  index: FaceIndex,
  opts: { threshold?: number; config?: FaceConfig; only?: string } = {},
): FaceHit[] {
  const config = opts.config ?? DEFAULT_FACE_CONFIG;
  const threshold = opts.threshold ?? config.matchThreshold;
  const out: FaceHit[] = [];
  for (const [image, faces] of Object.entries(raw)) {
    for (const f of faces) {
      const m = bestMatch(f, index, threshold, config, opts.only);
      const box = { image, x: f.x, y: f.y, w: f.w, h: f.h };
      out.push(m ? { ...box, persona: m.persona, similarity: Math.round(m.similarity * 1000) / 1000 } : box);
    }
  }
  return out;
}

/** True for a helper entry with a finite box, detector score and a non-empty finite vector. */
function isRawFace(v: unknown): v is RawFace {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  const nums = ["x", "y", "w", "h", "score"].every((k) => typeof f[k] === "number" && Number.isFinite(f[k]));
  return nums && Array.isArray(f.embedding) && f.embedding.length > 0 && f.embedding.every((x) => typeof x === "number" && Number.isFinite(x));
}

/** Parses the helper's stdout (tolerant of junk lines before the JSON): image path -> faces; entries with an invalid vector or box are dropped. */
export function parseFaceOutput(stdout: string): Record<string, RawFace[]> {
  const start = stdout.indexOf("{");
  if (start < 0) return {};
  try {
    const json = JSON.parse(stdout.slice(start)) as { faces?: Record<string, unknown> };
    const out: Record<string, RawFace[]> = {};
    for (const [file, list] of Object.entries(json.faces ?? {})) out[file] = Array.isArray(list) ? list.filter(isRawFace) : [];
    return out;
  } catch {
    return {};
  }
}

/** Per-image error messages of the helper's stdout (`errors`), same tolerance as parseFaceOutput. */
export function parseFaceErrors(stdout: string): Record<string, string> {
  const start = stdout.indexOf("{");
  if (start < 0) return {};
  try {
    const json = JSON.parse(stdout.slice(start)) as { errors?: Record<string, unknown> };
    return Object.fromEntries(Object.entries(json.errors ?? {}).map(([file, msg]) => [file, String(msg)]));
  } catch {
    return {};
  }
}

/** Reads data/faces/index.json (built by `face_embed.py --build-index`); null when it is missing or malformed. */
export function loadFaceIndex(file: string = faceIndexFile()): FaceIndex | null {
  try {
    const json = JSON.parse(readFileSync(file, "utf8")) as Partial<FaceIndex>;
    return json.persons && typeof json.persons === "object" ? { model: json.model ?? "", persons: json.persons } : null;
  } catch {
    return null;
  }
}

/**
 * Finds faces in the images and names the person from the closed list they resemble.
 * @param images paths of the pictures (ad images, screenshots, video frames); relative ones are resolved against `opts.basePath`
 * @param opts.threshold weighted-cosine threshold (default: DEFAULT_FACE_CONFIG.matchThreshold)
 * @param opts.only person id: compare with that person's references only (1:1 verification at the person's request); an id missing from the index gives `{ skipped }`
 * @returns one FaceHit per face found (the `image` is the path as passed in), or `{ skipped }` with the reason
 *   when the venv, the models or the index are missing or no image could be read; never throws
 */
export async function detectFaces(
  images: string[],
  opts: { basePath?: string; threshold?: number; only?: string; run?: ToolRunner; env?: EnvMap; index?: FaceIndex | null; timeoutMs?: number } = {},
): Promise<FaceHit[] | { skipped: string }> {
  if (!images.length) return [];
  const env = opts.env ?? process.env;
  const python = facePython(env);
  const modelDir = faceModelDir(env);
  const index = opts.index === undefined ? loadFaceIndex() : opts.index;
  if (!index) return { skipped: FACE_UNAVAILABLE };
  if (opts.only && !index.persons[opts.only]) return { skipped: `brak osoby ${opts.only} w bazie twarzy (data/faces)` };
  if (!opts.run) {
    if (!(await which(python, env))) return { skipped: FACE_UNAVAILABLE };
    for (const f of FACE_MODEL_FILES) if (!(await nonEmptyFile(path.join(modelDir, f)))) return { skipped: FACE_UNAVAILABLE };
  }
  const run = opts.run ?? defaultRunner;
  const resolved = new Map(images.map((img) => [path.isAbsolute(img) || !opts.basePath ? img : path.join(opts.basePath, img), img]));
  const r = await run(python, ["-I", faceScript(), "--model-dir", modelDir, ...resolved.keys()], {
    timeoutMs: opts.timeoutMs ?? 60_000 + 10_000 * images.length,
  });
  if (r.code !== 0 || r.timedOut) {
    const why = r.timedOut ? "przekroczono limit czasu" : r.stderr.trim().split("\n").slice(-1)[0] || `kod wyjścia ${r.code}`;
    return { skipped: `adapter twarzy nie zadziałał: ${why}` };
  }
  const errors = parseFaceErrors(r.stdout);
  const failed = [...resolved.keys()].filter((file) => file in errors);
  if (failed.length === resolved.size) return { skipped: `adapter twarzy nie odczytał żadnego obrazu: ${errors[failed[0]]}` };
  const byPath = parseFaceOutput(r.stdout);
  const raw: Record<string, RawFace[]> = {};
  for (const [file, original] of resolved) raw[original] = byPath[file] ?? [];
  return matchFaces(raw, index, { threshold: opts.threshold, only: opts.only });
}
