import { describe, expect, it } from "vitest";
import { detectFaces, faceQuality, matchFaces, parseFaceOutput, DEFAULT_FACE_CONFIG, type FaceIndex, type RawFace } from "./face";
import type { ToolRunner } from "./tools";

const DIM = 128;

/** Unit vector of 128 dimensions with 1 at `axis`. */
function axis(i: number): number[] {
  return Array.from({ length: DIM }, (_, k) => (k === i ? 1 : 0));
}

/** Unit vector whose cosine to axis(i) is exactly `c` (the rest goes to axis(j)). */
function withCosine(i: number, j: number, c: number): number[] {
  const v = new Array<number>(DIM).fill(0);
  v[i] = c;
  v[j] = Math.sqrt(1 - c * c);
  return v;
}

const INDEX: FaceIndex = {
  model: "test",
  persons: {
    "osoba-x": [axis(0), withCosine(0, 5, 0.9)],
    "osoba-y": [axis(1)],
  },
};

function face(embedding: number[], over: Partial<RawFace> = {}): RawFace {
  return { x: 10, y: 20, w: 120, h: 140, score: 0.95, embedding, ...over };
}

describe("face matching (closed list)", () => {
  it("names the person when the cosine to their reference is above the threshold", () => {
    const [hit] = matchFaces({ "a.jpg": [face(withCosine(0, 7, 0.95))] }, INDEX);
    expect(hit.persona).toBe("osoba-x");
    expect(hit.similarity).toBeGreaterThan(0.9);
    expect(hit).toMatchObject({ image: "a.jpg", x: 10, y: 20, w: 120, h: 140 });
  });

  it("leaves the persona empty when the face is far from everyone", () => {
    const [hit] = matchFaces({ "a.jpg": [face(withCosine(0, 7, 0.2))] }, INDEX);
    expect(hit.persona).toBeUndefined();
    expect(hit.similarity).toBeUndefined();
    expect(hit.w).toBe(120);
  });

  it("picks the higher match when two people are above the threshold", () => {
    const v = new Array<number>(DIM).fill(0);
    v[0] = 0.6;
    v[1] = 0.7;
    v[9] = Math.sqrt(1 - 0.36 - 0.49);
    const [hit] = matchFaces({ "a.jpg": [face(v)] }, INDEX);
    expect(hit.persona).toBe("osoba-y");
  });

  it("lowers the weight of a small face with a low detector score", () => {
    const good = faceQuality({ w: 120, h: 140, score: 0.95 }, DEFAULT_FACE_CONFIG);
    const poor = faceQuality({ w: 40, h: 44, score: 0.7 }, DEFAULT_FACE_CONFIG);
    expect(good).toBe(1);
    expect(poor).toBeLessThan(good);
    const v = withCosine(0, 7, 0.55);
    const [big] = matchFaces({ "a.jpg": [face(v)] }, INDEX);
    const [small] = matchFaces({ "a.jpg": [face(v, { w: 40, h: 44, score: 0.7 })] }, INDEX);
    expect(big.persona).toBe("osoba-x");
    expect(small.persona).toBeUndefined();
  });

  it("does not match faces below the minimum size", () => {
    const [hit] = matchFaces({ "a.jpg": [face(axis(0), { w: 8, h: 9 })] }, INDEX);
    expect(hit.persona).toBeUndefined();
  });

  it("never returns embeddings", () => {
    const hits = matchFaces({ "a.jpg": [face(axis(0)), face(withCosine(0, 7, 0.1))] }, INDEX);
    expect(hits).toHaveLength(2);
    expect(JSON.stringify(hits)).not.toContain("embedding");
    for (const h of hits) expect(Object.keys(h).sort()).toEqual(h.persona ? ["h", "image", "persona", "similarity", "w", "x", "y"] : ["h", "image", "w", "x", "y"]);
  });

  it("checks only the named person in 1:1 verification mode", () => {
    const v = axis(1);
    const [all] = matchFaces({ "a.jpg": [face(v)] }, INDEX);
    const [onlyX] = matchFaces({ "a.jpg": [face(v)] }, INDEX, { only: "osoba-x" });
    expect(all.persona).toBe("osoba-y");
    expect(onlyX.persona).toBeUndefined();
  });

  it("uses a stricter threshold from the options", () => {
    const [hit] = matchFaces({ "a.jpg": [face(withCosine(0, 7, 0.5))] }, INDEX, { threshold: 0.6 });
    expect(hit.persona).toBeUndefined();
  });
});

describe("face adapter", () => {
  const recorded = JSON.stringify({
    model: "yunet-2023mar+sface-2021dec",
    faces: {
      "/tmp/x/a.jpg": [{ x: 10, y: 20, w: 120, h: 140, score: 0.95, embedding: withCosine(0, 7, 0.95) }],
      "/tmp/x/b.jpg": [],
    },
  });

  it("parses the helper output, tolerating junk before the JSON and dropping invalid vectors", () => {
    const out = parseFaceOutput(`warning\n${recorded}`);
    expect(out["/tmp/x/a.jpg"]).toHaveLength(1);
    expect(out["/tmp/x/b.jpg"]).toEqual([]);
    expect(parseFaceOutput("not json")).toEqual({});
    const bad = parseFaceOutput('{"faces":{"/a.jpg":[{"x":1,"y":1,"w":50,"h":50,"score":0.9,"embedding":["x"]}]}}');
    expect(bad["/a.jpg"]).toEqual([]);
  });

  it("matches the recorded output and returns boxes with the persona only", async () => {
    const run: ToolRunner = async () => ({ code: 0, stdout: recorded, stderr: "", timedOut: false });
    const hits = await detectFaces(["a.jpg", "b.jpg"], { basePath: "/tmp/x", run, index: INDEX, env: { FACE_PYTHON: "/x/python", FACE_MODEL_DIR: "/x/models" } });
    expect(hits).toEqual([{ image: "a.jpg", x: 10, y: 20, w: 120, h: 140, persona: "osoba-x", similarity: expect.any(Number) }]);
  });

  it("skips with a reason, without throwing, when the venv or the models are missing", async () => {
    const res = await detectFaces(["a.jpg"], { env: { FACE_PYTHON: "/nie/ma/python", FACE_MODEL_DIR: "/nie/ma" } });
    expect(res).toEqual({ skipped: "brak adaptera twarzy (scripts/py/setup-face.sh)" });
  });

  it("skips with the adapter's error when the helper fails", async () => {
    const run: ToolRunner = async () => ({ code: 1, stdout: "", stderr: "ModuleNotFoundError: cv2", timedOut: false });
    const res = await detectFaces(["a.jpg"], { run, index: INDEX, env: { FACE_PYTHON: "/x/python" } });
    expect(res).toEqual({ skipped: expect.stringContaining("cv2") });
  });

  it("skips with the reason when no image could be read", async () => {
    const run: ToolRunner = async () => ({ code: 0, stdout: JSON.stringify({ faces: { "/tmp/x/a.jpg": [] }, errors: { "/tmp/x/a.jpg": "nie da się odczytać obrazu" } }), stderr: "", timedOut: false });
    const res = await detectFaces(["a.jpg"], { basePath: "/tmp/x", run, index: INDEX, env: { FACE_PYTHON: "/x/python" } });
    expect(res).toEqual({ skipped: expect.stringContaining("nie da się odczytać obrazu") });
  });

  it("skips 1:1 verification of a person who is not in the index", async () => {
    const run: ToolRunner = async () => ({ code: 0, stdout: recorded, stderr: "", timedOut: false });
    const res = await detectFaces(["a.jpg"], { run, index: INDEX, only: "osoba-z", env: { FACE_PYTHON: "/x/python" } });
    expect(res).toEqual({ skipped: expect.stringContaining("osoba-z") });
    const ok = await detectFaces(["a.jpg"], { run, index: INDEX, only: "osoba-x", basePath: "/tmp/x", env: { FACE_PYTHON: "/x/python" } });
    expect(ok).toEqual([expect.objectContaining({ persona: "osoba-x" })]);
  });

  it("returns an empty list without calling the adapter for no images", async () => {
    expect(await detectFaces([], { env: { FACE_PYTHON: "/nie/ma/python" } })).toEqual([]);
  });
});
