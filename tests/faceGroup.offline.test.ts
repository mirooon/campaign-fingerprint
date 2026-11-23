/**
 * The persona from a face or from a voice is a trait of a GROUP of similar campaigns, not of one campaign
 * (synthetic sample, no network, no Python): two campaigns with different domains, registrars and
 * trackers share a public figure as bait (one named in the text, the other recognised from the
 * face or the voice by an injected adapter result) and stay two campaigns, in one group.
 */
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { campaignLinkVerdict } from "../lib/graph/cluster";
import { DEFAULT_LINK_CONFIG } from "../lib/graph/config";
import type { FaceHit } from "../lib/media/face";
import type { VoiceIndex, VoiceWindow } from "../lib/media/speaker";
import type { Item } from "../lib/pipeline/types";
import { runSample } from "./sampleRun";

/** The sample's text persona of campaign K01 (a fictitious person). */
const PERSONA = "adam-testowy";
const TEXT_ITEM = "c1-01";
const FACE_ITEM = "c2-01";

/** The same long ad copy for both ads (the bait is named in one of them only): the shared content is what puts the campaigns in one group next to the persona. */
const COPY =
  "Nowa metoda domowego inwestowania: wystarczy telefon i pięć minut dziennie, a pierwsze wpłaty widać już po tygodniu. Ponad dwa tysiące osób potwierdza regularne wypłaty z platformy. Miejsca w programie są ograniczone do końca miesiąca, rejestracja trwa krótko.";

/** Gives the ads of the test the same copy; the text ad also names the person. */
function sameCopy(items: Item[]): void {
  for (const it of items) {
    if (it.id === TEXT_ITEM) it.text = `${COPY} Adam Testowy poleca.`;
    if (it.id === FACE_ITEM) it.text = COPY;
  }
}

/** Adapter result as the Python helper plus matching would give it: one face of the person on the creative of FACE_ITEM, one stranger on another picture. */
function adapter(files: string[]): Promise<FaceHit[]> {
  const faceFile = files.find((f) => f.endsWith(path.join("images", "c2_D.png")));
  const hits: FaceHit[] = [];
  if (faceFile) hits.push({ image: faceFile, x: 40, y: 30, w: 120, h: 150, persona: PERSONA, similarity: 0.71 });
  const other = files.find((f) => f !== faceFile);
  if (other) hits.push({ image: other, x: 5, y: 5, w: 60, h: 60 });
  return Promise.resolve(hits);
}

describe("persona from a face", () => {
  it("keeps two campaigns apart and puts them in one group", async () => {
    const base = await runSample({ enrich: { faces: true, facesAdapter: adapter }, prepare: sameCopy });
    const { ds, graph, campaigns } = base;

    // the face gave the same persona node as the caption, with the source "face" and the similarity
    const fromFace = ds.perItem[FACE_ITEM].personas.find((p) => p.id === PERSONA);
    expect(fromFace).toMatchObject({ source: "face", similarity: 0.71 });
    expect(ds.perItem[FACE_ITEM].faces?.find((f) => f.persona)).toMatchObject({ persona: PERSONA, x: 40, w: 120 });
    const edge = graph.edges.find((e) => e.type === "mentions_persona" && e.source === `item:${FACE_ITEM}` && e.target === `persona:${PERSONA}`);
    expect(edge?.evidence).toContain("z twarzy");

    // different infrastructure: two campaigns; the shared bait puts them in one group
    const a = campaigns.assignments[TEXT_ITEM];
    const b = campaigns.assignments[FACE_ITEM];
    expect(a).not.toBe(b);
    const family = campaigns.families?.find((f) => f.campaigns.includes(a) && f.campaigns.includes(b));
    expect(family).toBeDefined();
    expect(campaigns.campaigns.find((c) => c.id === a)?.familyId).toBe(family?.id);

    // the persona and the shared copy are not enough to merge campaigns: one kind of content, the persona is group-only
    const pair = (g: typeof graph) => g.links.find((l) => [l.a, l.b].sort().join() === [TEXT_ITEM, FACE_ITEM].sort().join());
    const link = pair(graph);
    expect(link?.evidence.some((e) => e.pivotType === "persona")).toBe(true);
    expect(campaignLinkVerdict(link!, DEFAULT_LINK_CONFIG)).not.toBe("campaign");

    // without the face the link has no persona evidence
    const noFace = await runSample({ enrich: { faces: true, facesAdapter: () => Promise.resolve([]) }, prepare: sameCopy });
    expect(pair(noFace.graph)?.evidence.some((e) => e.pivotType === "persona") ?? false).toBe(false);
  });

  it("does not store vectors, and without the adapter leaves the record as it was", async () => {
    const withFaces = await runSample({ only: [TEXT_ITEM, FACE_ITEM], enrich: { faces: true, facesAdapter: adapter } });
    expect(JSON.stringify(withFaces.ds.perItem)).not.toContain("embedding\":[");
    const lines: string[] = [];
    const skipped = await runSample({
      only: [TEXT_ITEM, FACE_ITEM],
      enrich: { faces: true, facesAdapter: () => Promise.resolve({ skipped: "brak adaptera twarzy (scripts/py/setup-face.sh)" }), log: (m) => lines.push(m) },
    });
    expect(skipped.ds.perItem[FACE_ITEM].faces).toBeUndefined();
    expect(skipped.ds.perItem[FACE_ITEM].personas.some((p) => p.source === "face")).toBe(false);
    expect(lines.some((m) => m.startsWith("faces skipped: brak adaptera"))).toBe(true);
  });
});

/** The video of the voice test: the adapter is injected, so the file is never read. */
const VIDEO = "voice-ad.mp4";

/** Gallery of the test: one fictitious person (basis vector e0) and another (e1). */
const VOICE_INDEX: VoiceIndex = {
  model: "synthetic",
  persons: { [PERSONA]: [[1, ...new Array<number>(191).fill(0)]], "ewa-przykladowa": [[0, 1, ...new Array<number>(190).fill(0)]] },
};

/** Windows as the helper would give them for the video: speech with a voice at cosine 0.65 to the person and 0.1 to the other, plus a quiet window. */
function voiceWindows(files: string[]): Promise<Record<string, VoiceWindow[] | null>> {
  const embedding = [0.65, 0.1, Math.sqrt(1 - 0.65 * 0.65 - 0.01), ...new Array<number>(189).fill(0)];
  const windows: VoiceWindow[] = [
    { start: 0, end: 4, levelDb: -22, speech: 0.8, embedding },
    { start: 2, end: 6, levelDb: -22, speech: 0.8, embedding },
    { start: 6, end: 10, levelDb: -70, speech: 0.8, embedding },
  ];
  return Promise.resolve(Object.fromEntries(files.map((f) => [f, f.endsWith(VIDEO) ? windows : null])));
}

/** Gives the ad of the face test a video and the ads the shared copy. */
function withVideo(items: Item[]): void {
  sameCopy(items);
  for (const it of items) if (it.id === FACE_ITEM) it.videoPath = VIDEO;
}

describe("persona from a voice", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps two campaigns apart and puts them in one group, with the cosine in the evidence", async () => {
    vi.stubEnv("SPEAKER_PYTHON", "/nie/ma/python");
    const { ds, graph, campaigns } = await runSample({ enrich: { speaker: true, voicesAdapter: voiceWindows, voiceIndex: VOICE_INDEX }, prepare: withVideo });

    // two merged windows give one span with the persona; the quiet window is not part of the result
    expect(ds.perItem[FACE_ITEM].voices).toEqual([{ start: 0, end: 6, persona: PERSONA, similarity: 0.65 }]);
    expect(ds.perItem[FACE_ITEM].personas.find((p) => p.id === PERSONA)).toMatchObject({ source: "voice", matched: "voice", similarity: 0.65 });
    const edge = graph.edges.find((e) => e.type === "mentions_persona" && e.source === `item:${FACE_ITEM}` && e.target === `persona:${PERSONA}`);
    expect(edge?.evidence).toContain("z głosu");

    // different domains, registrars and trackers: two campaigns, one group through the shared bait
    const a = campaigns.assignments[TEXT_ITEM];
    const b = campaigns.assignments[FACE_ITEM];
    expect(a).not.toBe(b);
    const family = campaigns.families?.find((f) => f.campaigns.includes(a) && f.campaigns.includes(b));
    expect(family).toBeDefined();
    const link = graph.links.find((l) => [l.a, l.b].sort().join() === [TEXT_ITEM, FACE_ITEM].sort().join());
    expect(link?.evidence.some((e) => e.pivotType === "persona")).toBe(true);
    expect(campaignLinkVerdict(link!, DEFAULT_LINK_CONFIG)).not.toBe("campaign");

    // no vector of the recording reaches the dataset or the graph
    expect(JSON.stringify(ds.perItem[FACE_ITEM].voices)).not.toContain("embedding");
    expect(JSON.stringify(graph)).not.toContain("embedding");
  });

  it("leaves the record as it was without the gallery, and reports an unreadable recording", async () => {
    vi.stubEnv("SPEAKER_PYTHON", "/nie/ma/python");
    const lines: string[] = [];
    const noGallery = await runSample({ only: [TEXT_ITEM, FACE_ITEM], enrich: { speaker: true, voicesAdapter: voiceWindows, voiceIndex: null, log: (m) => lines.push(m) }, prepare: withVideo });
    expect(noGallery.ds.perItem[FACE_ITEM].voices).toBeUndefined();
    expect(noGallery.ds.perItem[FACE_ITEM].personas.some((p) => p.source === "voice")).toBe(false);
    expect(lines.some((m) => m.startsWith("speaker voice skipped: no voice gallery"))).toBe(true);

    const unreadable = await runSample({ only: [TEXT_ITEM, FACE_ITEM], enrich: { speaker: true, voicesAdapter: () => Promise.resolve({}), voiceIndex: VOICE_INDEX }, prepare: withVideo });
    expect(unreadable.ds.perItem[FACE_ITEM].voices).toBeUndefined();
    expect(unreadable.ds.perItem[FACE_ITEM].errors.some((e) => e.startsWith("speaker:"))).toBe(true);
  });
});
