import { describe, expect, it } from "vitest";
import type { Campaign } from "@/lib/graph/model";
import { bridgeNote, brandNote, domainAgeNote, exactFileLabel, linkRuleLabel, nodeTypeLabel, faceLines, narrativeLine, narrativeSwitchLines, platformAccountLines, voiceLines, weakestLinkNote } from "./fields";
import { fmtNum } from "./format";

const nameOf = (id: string) => (id === "adam-testowy" ? "Adam Testowy" : id);

function camp(over: Partial<Campaign> = {}): Campaign {
  return { id: "K01", size: 4, members: ["a", "b", "c", "d"], firstSeen: null, lastSeen: null, topEvidence: [], domains: [], advertisers: [], cohesion: 0.6, strongComponents: 1, attributes: { personas: [], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null }, ...over };
}

describe("platformAccountLines", () => {
  it("the warning and the account source are two sentences, the warning first", () => {
    const lines = platformAccountLines({ platformAccountWarning: "tenant X differs from Y", platformAccountSource: "tenant→owner_uuid" });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("tenant X differs from Y");
    expect(lines[1]).toContain("tenant");
  });
  it("an account found from the tenant alone is described as weaker", () => {
    expect(platformAccountLines({ platformAccountSource: "tenant" })[0]).toContain("a weaker basis");
  });
  it("returns nothing without the fields", () => {
    expect(platformAccountLines({})).toEqual([]);
  });
});

describe("exactFileLabel", () => {
  it("the creative-file node gets the label “the same ad file”", () => {
    expect(exactFileLabel({ exactFile: true })).toBe("the same ad file");
  });
  it("an ordinary image fingerprint gets no label", () => {
    expect(exactFileLabel({})).toBeNull();
  });
});

describe("faceLines and voiceLines", () => {
  it("a face is “similar to”, never “this is”", () => {
    const lines = faceLines([{ image: "x.png", x: 0, y: 0, w: 5, h: 5, persona: "adam-testowy", similarity: 0.571 }, { image: "x.png", x: 9, y: 9, w: 5, h: 5 }], nameOf);
    expect(lines[0]).toBe(`Face similar to Adam Testowy (${fmtNum(0.57)}), for a human to check.`);
    expect(lines.join(" ")).not.toMatch(/this is/i);
    expect(lines[1]).toBe("Faces in the sample: 2.");
  });
  it("without a recognised person it only gives the number of faces", () => {
    expect(faceLines([{ image: "x.png", x: 0, y: 0, w: 5, h: 5 }], nameOf)).toEqual(["Found 1 face, none similar to a person on the list."]);
  });
  it("several faces of the same person give one sentence with the highest score", () => {
    const lines = faceLines([{ image: "a", x: 0, y: 0, w: 1, h: 1, persona: "adam-testowy", similarity: 0.5 }, { image: "b", x: 0, y: 0, w: 1, h: 1, persona: "adam-testowy", similarity: 0.62 }], nameOf);
    expect(lines.filter((l) => l.startsWith("Face similar"))).toEqual([`Face similar to Adam Testowy (${fmtNum(0.62)}), for a human to check.`]);
  });
  it("a voice is “similar to”, with a time range", () => {
    const lines = voiceLines([{ start: 3, end: 11, persona: "adam-testowy", similarity: 0.7 }], nameOf);
    expect(lines).toEqual([`Voice similar to Adam Testowy (${fmtNum(0.7)}) at seconds 3–11, for a human to check.`]);
  });
  it("an empty list gives no sentences", () => {
    expect(faceLines(undefined, nameOf)).toEqual([]);
    expect(voiceLines([], nameOf)).toEqual([]);
  });
});

describe("narrativeLine", () => {
  it("names the topic and the form of the message", () => {
    expect(narrativeLine({ topics: [{ id: "investment", score: 3, terms: [] }], hooks: ["fake_interview"], profitPromise: [], groupInvite: [], amounts: [], date: null })).toBe("Narrative: investment; form: fake interview.");
  });
  it("the health subcategory is added", () => {
    expect(narrativeLine({ topics: [{ id: "health", score: 2, terms: [], subtopics: ["joints"] }], hooks: [], profitPromise: [], groupInvite: [], amounts: [], date: null })).toBe("Narrative: health (joints).");
  });
  it("an unknown topic keeps its id, and no narrative is null", () => {
    expect(narrativeLine({ topics: [{ id: "nowy_temat", score: 1, terms: [] }], hooks: [], profitPromise: [], groupInvite: [], amounts: [], date: null })).toBe("Narrative: nowy_temat.");
    expect(narrativeLine(null)).toBeNull();
  });
});

describe("narrativeSwitchLines", () => {
  it("a topic switch within a short time is “same operator, two narratives”", () => {
    const lines = narrativeSwitchLines({ topics: [], hooks: [], labels: [], switches: [{ from: "investment", to: "subsidy", fromDate: "2026-09-01", toDate: "2026-09-04", days: 3 }] });
    expect(lines).toEqual(["Same operator, two narratives: investment, then subsidies and benefits (within 3 days)."]);
  });
});

describe("bridgeNote", () => {
  it("describes the trace that holds the subgroups together", () => {
    const c = camp({ bridge: { pivot: "tracker:x", type: "tracker", label: "GA4 G-TEST", parts: [["a", "b"], ["c", "d", "e"]] } });
    expect(bridgeNote(c)).toBe("Campaign held together by one trace: GA4 G-TEST. It joins 2 groups of 2 and 3 samples; when the trace is shared by many sites, the campaign is too wide.");
  });
  it("null without a bridge", () => {
    expect(bridgeNote(camp())).toBeNull();
  });
});

describe("weakestLinkNote", () => {
  it("the weakest link with its score and the threshold", () => {
    expect(weakestLinkNote(camp({ minInternalScore: 0.22, weakestMember: { id: "d", score: 0.22, links: 1 } }), 0.15)).toBe(`Weakest link: d, best link ${fmtNum(0.22)} (linking threshold ${fmtNum(0.15)}), 1 link.`);
  });
  it("null without the field", () => {
    expect(weakestLinkNote(camp(), 0.15)).toBeNull();
  });
});

describe("domainAgeNote", () => {
  it("domain registered before the ad was first shown", () => {
    expect(domainAgeNote(2, "domain")).toBe("domain registered 2 days before the ad was first shown");
    expect(domainAgeNote(1, "domain")).toBe("domain registered 1 day before the ad was first shown");
  });
  it("the same day, after the ad, no data", () => {
    expect(domainAgeNote(0, "domain")).toBe("domain registered on the day the ad was first shown");
    expect(domainAgeNote(-5, "domain")).toBe("domain registered 5 days after the ad was first shown (possibly registered again)");
    expect(domainAgeNote(null, "domain")).toBeNull();
  });
  it("a certificate is called a certificate, not a registration", () => {
    expect(domainAgeNote(3, "cert")).toBe("first certificate issued 3 days before the ad was first shown");
  });
});

describe("brandNote", () => {
  it("a brand recognised on the creative, with its kind and confidence", () => {
    expect(brandNote({ name: "Portal Testowy", kind: "media", probability: 0.81 })).toBe(`Imitated brand: Portal Testowy (news site), recognised on the creative (${fmtNum(0.81)}).`);
  });
  it("null without a brand", () => {
    expect(brandNote(undefined)).toBeNull();
  });
});

describe("linkRuleLabel", () => {
  it("a variant link does not carry the pair rule label, which would contradict the verdict", () => {
    expect(linkRuleLabel({ rule: "single_kind", variant: true })).toBe("variant: assigned by the creative, lower confidence");
  });
  it("an ordinary link keeps the rule label", () => {
    expect(linkRuleLabel({ rule: "single_kind" })).toBe("one kind of evidence: similar at most");
    expect(linkRuleLabel({ rule: "campaign" })).toBe("links into a campaign");
  });
});

describe("nodeTypeLabel", () => {
  it("the creative-file node has its own label, the rest the type name", () => {
    expect(nodeTypeLabel({ type: "imagehash", data: { exactFile: true } })).toBe("the same ad file");
    expect(nodeTypeLabel({ type: "imagehash", data: {} })).toBe("Image hash");
  });
});
