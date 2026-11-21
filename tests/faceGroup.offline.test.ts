/**
 * The persona from a face is a trait of a GROUP of similar campaigns, not of one campaign
 * (synthetic sample, no network, no Python): two campaigns with different domains, registrars and
 * trackers share a public figure as bait (one named in the text, the other recognised from the
 * face by an injected adapter result) and stay two campaigns, in one group.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { campaignLinkVerdict } from "../lib/graph/cluster";
import { DEFAULT_LINK_CONFIG } from "../lib/graph/config";
import type { FaceHit } from "../lib/media/face";
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
    expect(lines.some((m) => m.startsWith("twarze pominięte: brak adaptera"))).toBe(true);
  });
});
