/**
 * Content with and without infrastructure (campaignRules.contentKinds): copies of one lander or
 * creative are reused by unrelated operators, so similar content alone joins only ads that have no
 * infrastructure at all, and only by two kinds of content. The same creative file joins alone.
 * Synthetic data only: fictional people, .example/.test domains.
 */
import { describe, expect, it } from "vitest";
import type { LanderConfig } from "../osint/landerConfig";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset, type TestItemSpec } from "./testkit";

function run(specs: TestItemSpec[], textMethod: "tfidf" | "none" = "tfidf") {
  return clusterCampaigns(buildEvidenceGraph(makeDataset(specs), { textMethod }));
}
const same = (res: ReturnType<typeof run>, a: string, b: string) => res.campaigns.assignments[a] === res.campaigns.assignments[b];
const campaignOf = (res: ReturnType<typeof run>, id: string) => res.campaigns.campaigns.find((c) => c.members.includes(id))!;
const lander = (ownerId: string): LanderConfig => ({
  platform: "aio",
  ownerId,
  campaignId: null,
  campaignName: null,
  campaignNumber: null,
  landingId: null,
  landingName: null,
  templateId: null,
  landerTypeId: null,
  sourceId: null,
  sourceName: null,
});
/** A synthetic Chromaprint sequence (deterministic pseudo-random 32-bit values). */
const fingerprint = (seed: number, n = 120) => {
  let x = seed >>> 0;
  return Array.from({ length: n }, () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0));
};
const TEXT = "Jan Testowy ujawnia sekret: platforma inwestycyjna daje 4000 zł dziennie bez ryzyka. Zarejestruj się dziś i odbierz bonus!";
const TEXT_2 = "Jan Testowy zdradził sekret: ta platforma inwestycyjna daje nawet 4000 zł dziennie bez ryzyka. Zarejestruj się teraz i odbierz bonus!";

describe("content without infrastructure", () => {
  it("joins two videos without addresses that share the audio fingerprint and near-identical frames", () => {
    const audio = fingerprint(7);
    const res = run([
      { id: "v1", audioFingerprint: audio, videoEmbedding: [1, 0, 0, 0] },
      { id: "v2", audioFingerprint: audio, videoEmbedding: [0.99, 0.1, 0, 0] }, // cosine ≈ 0.995
    ]);
    expect(same(res, "v1", "v2")).toBe(true);
    expect(campaignOf(res, "v1").attributes.basis).toBe("content");
  });

  it("makes at most a group of two materials that share only a persona and similar copy", () => {
    const res = run([
      { id: "a", text: TEXT, personas: ["Jan Testowy"] },
      { id: "b", text: TEXT_2, personas: ["Jan Testowy"] },
    ]);
    const l = res.graph.links.find((x) => x.a === "a" && x.b === "b")!;
    expect(l.evidence.map((e) => e.edgeType ?? e.pivotType).sort()).toEqual(["persona", "similar_text"]);
    expect(same(res, "a", "b")).toBe(false);
  });
});

describe("content between pages with infrastructure", () => {
  it("keeps two pages on different platform accounts with identical copy as different campaigns of one group", () => {
    const res = run([
      { id: "a", url: "https://dziennik-alfa.example/", text: TEXT, kit: { lander: lander("5a1e0c3d-7b42-4f19-9c6e-2d8b41f07a13") } },
      { id: "b", url: "https://kurier-beta.test/", text: TEXT, kit: { lander: lander("8c3f2a71-41d9-4e6b-a0f5-7e19c4b2d860") } },
    ]);
    expect(same(res, "a", "b")).toBe(false);
    const fa = campaignOf(res, "a").familyId;
    expect(fa).not.toBeNull();
    expect(campaignOf(res, "b").familyId).toBe(fa);
  });

  it("does not join two pages with their own, unshared infrastructure and identical copy", () => {
    const res = run([
      { id: "a", url: "https://dziennik-alfa.example/", text: TEXT },
      { id: "b", url: "https://kurier-beta.test/", text: TEXT },
    ]);
    const l = res.graph.links.find((x) => x.a === "a" && x.b === "b")!;
    expect(l.evidence.map((e) => e.edgeType)).toEqual(["similar_text"]);
    expect(l.score).toBeGreaterThanOrEqual(0.5);
    expect(same(res, "a", "b")).toBe(false);
    expect(campaignOf(res, "a").attributes.basis).toBe("infrastructure");
  });

  it("joins two different pages that use the identical creative file (same SHA-256)", () => {
    const sha = "4e1f0a9c3b2d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f";
    const res = run(
      [
        { id: "a", url: "https://dziennik-alfa.example/", dhash: "0f0f0f0f0f0f0f0f", imageSha256: sha },
        { id: "b", url: "https://kurier-beta.test/", dhash: "0f0f0f0f0f0f0f0f", imageSha256: sha },
      ],
      "none",
    );
    const l = res.graph.links.find((x) => x.a === "a" && x.b === "b")!;
    expect(l.evidence.map((e) => e.pivot)).toContain(`imagehash:sha256:${sha}`);
    expect(same(res, "a", "b")).toBe(true);
    expect(campaignOf(res, "a").attributes.basis).toBe("content");
  });

  it("lets a platform-account conflict win over the same creative file", () => {
    const sha = "4e1f0a9c3b2d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f";
    const res = run(
      [
        { id: "a", url: "https://dziennik-alfa.example/", videoSha256: sha, kit: { lander: lander("5a1e0c3d-7b42-4f19-9c6e-2d8b41f07a13") } },
        { id: "b", url: "https://kurier-beta.test/", videoSha256: sha, kit: { lander: lander("8c3f2a71-41d9-4e6b-a0f5-7e19c4b2d860") } },
      ],
      "none",
    );
    expect(same(res, "a", "b")).toBe(false);
    expect(campaignOf(res, "a").familyId).toBe(campaignOf(res, "b").familyId);
  });
});
