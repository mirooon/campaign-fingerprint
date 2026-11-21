/**
 * Content variants (campaignRules.contentVariant): a material without infrastructure whose creative is
 * nearly identical to the creatives of exactly one campaign joins that campaign as a variant. The
 * variant link only attaches, it never merges two campaigns.
 * Synthetic data only: fictional people, .example/.test domains.
 */
import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset, type TestItemSpec } from "./testkit";

function run(specs: TestItemSpec[]) {
  return clusterCampaigns(buildEvidenceGraph(makeDataset(specs), { textMethod: "tfidf" }));
}
const same = (res: ReturnType<typeof run>, a: string, b: string) => res.campaigns.assignments[a] === res.campaigns.assignments[b];
const campaignOf = (res: ReturnType<typeof run>, id: string) => res.campaigns.campaigns.find((c) => c.members.includes(id))!;

const CREATIVE = "0f0f0f0f0f0f0f0f";
/** The creative with a sticker: 2 bits of the dHash differ. */
const STICKER = "0f0f0f0f0f0f0f0c";
/** A looser look-alike: 8 bits differ (a similar picture, not a variant). */
const LOOKALIKE = "0f0f0f0f0f0f00ff";
const OTHER = "f0f0f0f0f0f0f0f0";
const TEXT = "Jan Testowy ujawnia sekret: platforma inwestycyjna daje 4000 zł dziennie bez ryzyka. Zarejestruj się dziś i odbierz bonus!";

/** Campaign of two pages on one domain with one tracker; the first one carries the creative. */
const campaign = (prefix: string, domain: string, tracker: string, dhash = CREATIVE, text = TEXT): TestItemSpec[] => [
  { id: `${prefix}1`, url: `https://${domain}/start`, trackers: [{ kind: "ga4", id: tracker }], dhash, text },
  { id: `${prefix}2`, url: `https://${domain}/oferta`, trackers: [{ kind: "ga4", id: tracker }], text },
];

describe("content variant without infrastructure", () => {
  it("joins the only campaign whose creative it nearly repeats, and says so in the campaign", () => {
    const res = run([...campaign("k", "alfa-oferta.test", "G-ALFA111111"), { id: "v", dhash: STICKER }]);
    expect(same(res, "v", "k1")).toBe(true);
    const k = campaignOf(res, "k1");
    expect(k.variants).toEqual([expect.objectContaining({ id: "v", like: "k1" })]);
    expect(k.attributes.basis).toBe("mixed");
  });

  it("joins as a variant also with an identical picture hash", () => {
    const res = run([...campaign("k", "alfa-oferta.test", "G-ALFA111111"), { id: "v", dhash: CREATIVE }]);
    expect(same(res, "v", "k1")).toBe(true);
  });

  it("does not join when the near-identical creative appears in two campaigns, and keeps them apart", () => {
    const res = run([
      ...campaign("a", "alfa-oferta.test", "G-ALFA111111"),
      ...campaign("b", "beta-oferta.test", "G-BETA222222"),
      { id: "v", dhash: STICKER },
    ]);
    expect(same(res, "a1", "b1")).toBe(false);
    expect(same(res, "v", "a1")).toBe(false);
    expect(same(res, "v", "b1")).toBe(false);
    expect(campaignOf(res, "v").familyId).not.toBeNull();
  });

  it("does not join a looser look-alike (beyond the variant threshold)", () => {
    const res = run([...campaign("k", "alfa-oferta.test", "G-ALFA111111"), { id: "v", dhash: LOOKALIKE }]);
    expect(same(res, "v", "k1")).toBe(false);
  });

  it("does not join by identical copy with a different creative", () => {
    const res = run([...campaign("k", "alfa-oferta.test", "G-ALFA111111"), { id: "v", dhash: OTHER, text: TEXT }]);
    expect(same(res, "v", "k1")).toBe(false);
  });
});

describe("content variant with own infrastructure", () => {
  it("keeps today's rules: a variant on its own domain and tracker does not join", () => {
    const res = run([
      ...campaign("k", "alfa-oferta.test", "G-ALFA111111"),
      { id: "v", url: "https://delta-oferta.test/", trackers: [{ kind: "ga4", id: "G-DELT444444" }], dhash: STICKER },
    ]);
    expect(same(res, "v", "k1")).toBe(false);
    expect(campaignOf(res, "k1").variants).toBeUndefined();
  });

  it("keeps two campaigns with different infrastructure and the same picture apart", () => {
    const res = run([...campaign("a", "alfa-oferta.test", "G-ALFA111111"), ...campaign("b", "beta-oferta.test", "G-BETA222222")]);
    expect(same(res, "a1", "b1")).toBe(false);
    expect(campaignOf(res, "a1").familyId).toBe(campaignOf(res, "b1").familyId);
  });
});
