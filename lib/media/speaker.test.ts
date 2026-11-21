import { describe, expect, it } from "vitest";
import { detectSpeaker, parseSpeakerOutput, speakerSimilarity } from "./speaker";
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
