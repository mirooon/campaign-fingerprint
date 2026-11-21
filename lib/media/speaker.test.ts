import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE_CONFIG, detectSpeaker, matchVoiceWindows, parseSpeakerOutput, speakerSimilarity, type VoiceIndex, type VoiceWindow } from "./speaker";
import type { ToolRunner } from "./tools";

describe("speaker adapter", () => {
  it("parses the helper output and drops invalid vectors", () => {
    const out = parseSpeakerOutput('noise\n{"model":"m","embeddings":{"/a.wav":[0.6,0.8],"/b.wav":null,"/c.wav":["x"]}}');
    expect(out).toEqual({ "/a.wav": [0.6, 0.8], "/b.wav": null, "/c.wav": null });
    expect(parseSpeakerOutput("not json")).toEqual({});
  });

  it("scores normalised embeddings by dot product", () => {
    expect(speakerSimilarity([0.6, 0.8], [0.6, 0.8])).toBeCloseTo(1);
    expect(speakerSimilarity([1, 0], [0, 1])).toBe(0);
    expect(speakerSimilarity([1, 0], [1])).toBe(0);
  });

  it("reports unavailable when the Python packages are missing", async () => {
    const run: ToolRunner = async () => ({ code: 1, stdout: "", stderr: "ModuleNotFoundError", timedOut: false });
    const st = await detectSpeaker({ run, env: { SPEAKER_PYTHON: "/x/python" } });
    expect(st.available).toBe(false);
    expect(st.reason).toContain("speechbrain");
  });
});

/** Unit vector of 192 dimensions from the first coordinates (the rest is zero): a synthetic voice with a known cosine to the basis vectors. */
function vec(...head: number[]): number[] {
  const v = new Array<number>(192).fill(0);
  head.forEach((x, i) => (v[i] = x));
  return v;
}

/** Window vector with the given cosines to person A (basis e0) and person B (basis e1); the remainder goes to an unrelated direction. */
function windowVec(toA: number, toB: number): number[] {
  return vec(toA, toB, Math.sqrt(1 - toA * toA - toB * toB));
}

const INDEX: VoiceIndex = { model: "synthetic", persons: { "adam-testowy": [vec(1)], "ewa-przykladowa": [vec(0, 1)] } };

/** A speech window of 4 s at `start` seconds with a clear level and speech score. */
function win(start: number, embedding: number[], over: Partial<VoiceWindow> = {}): VoiceWindow {
  return { start, end: start + 4, levelDb: -25, speech: 0.8, embedding, ...over };
}

describe("voice gallery match", () => {
  it("names a person for a window with cosine 0.6 and a margin of 0.3 over the second one", () => {
    const spans = matchVoiceWindows([win(0, windowVec(0.6, 0.3)), win(2, windowVec(0.6, 0.3))], INDEX);
    expect(spans).toEqual([{ start: 0, end: 6, persona: "adam-testowy", similarity: 0.6 }]);
  });

  it("gives no persona when the margin over the second person is only 0.05", () => {
    const spans = matchVoiceWindows([win(0, windowVec(0.6, 0.55)), win(2, windowVec(0.6, 0.55))], INDEX);
    expect(spans).toEqual([{ start: 0, end: 6 }]);
  });

  it("gives no persona for a cosine of 0.3", () => {
    const spans = matchVoiceWindows([win(0, windowVec(0.3, 0)), win(2, windowVec(0.3, 0))], INDEX);
    expect(spans).toEqual([{ start: 0, end: 6 }]);
  });

  it("drops quiet windows and windows with music only (injected detection result), so they never carry a persona", () => {
    const strong = windowVec(0.7, 0.1);
    const spans = matchVoiceWindows(
      [
        win(0, strong, { levelDb: DEFAULT_VOICE_CONFIG.minLevelDb - 10 }),
        win(2, strong, { speech: DEFAULT_VOICE_CONFIG.minSpeech - 0.1 }),
      ],
      INDEX,
    );
    expect(spans).toEqual([]);
  });

  it("does not name a person from a single isolated window, but does from two neighbouring ones", () => {
    const strong = windowVec(0.7, 0.1);
    expect(matchVoiceWindows([win(0, strong), win(20, strong)], INDEX)).toEqual([
      { start: 0, end: 4 },
      { start: 20, end: 24 },
    ]);
    expect(matchVoiceWindows([win(0, strong), win(2, strong)], INDEX)).toEqual([{ start: 0, end: 6, persona: "adam-testowy", similarity: 0.7 }]);
  });

  it("merges neighbouring windows of one person into one span and keeps the speech of nobody as a span without persona", () => {
    const spans = matchVoiceWindows(
      [win(0, windowVec(0.6, 0.1)), win(2, windowVec(0.8, 0.1)), win(4, windowVec(0.2, 0.1)), win(20, windowVec(0.7, 0.1)), win(22, windowVec(0.7, 0.1))],
      INDEX,
    );
    expect(spans).toEqual([
      { start: 0, end: 6, persona: "adam-testowy", similarity: 0.7 },
      { start: 4, end: 8 },
      { start: 20, end: 26, persona: "adam-testowy", similarity: 0.7 },
    ]);
  });

  it("scores against the mean of the recordings of a person, and no vector reaches the result", () => {
    const index: VoiceIndex = { model: "synthetic", persons: { "adam-testowy": [vec(1), vec(0.8, 0.6)] } };
    const spans = matchVoiceWindows([win(0, vec(1)), win(2, vec(1))], index);
    expect(spans[0].persona).toBe("adam-testowy");
    expect(spans[0].similarity).toBeCloseTo(0.9, 1);
    expect(JSON.stringify(spans)).not.toContain("embedding");
  });

  it("gives no persona with a single person in the gallery when the cosine is below the threshold, and one when it is above", () => {
    const one: VoiceIndex = { model: "synthetic", persons: { "adam-testowy": [vec(1)] } };
    expect(matchVoiceWindows([win(0, windowVec(0.4, 0)), win(2, windowVec(0.4, 0))], one)[0].persona).toBeUndefined();
    expect(matchVoiceWindows([win(0, windowVec(0.55, 0)), win(2, windowVec(0.55, 0))], one)[0].persona).toBe("adam-testowy");
  });
});

describe("voice gallery builder", () => {
  it("uses the same window length, step and filters as the rule", () => {
    const py = readFileSync("scripts/py/build_voice_index.py", "utf8");
    const num = (name: string) => Number(new RegExp(`^${name} = (-?[0-9.]+)$`, "m").exec(py)?.[1]);
    expect(num("WINDOW_SECONDS")).toBe(DEFAULT_VOICE_CONFIG.windowSeconds);
    expect(num("STEP_SECONDS")).toBe(DEFAULT_VOICE_CONFIG.stepSeconds);
    expect(num("MIN_LEVEL_DB")).toBe(DEFAULT_VOICE_CONFIG.minLevelDb);
    expect(num("MIN_SPEECH")).toBe(DEFAULT_VOICE_CONFIG.minSpeech);
  });
});
