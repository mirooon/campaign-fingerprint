import { describe, expect, it } from "vitest";
import type { MaterialItemResult, MaterialLink } from "./analyzeMaterial";
import { MATERIAL_CSV_COLUMNS, materialConfidence, materialCsv } from "./materialCsv";

const link = (o: Partial<MaterialLink> & { weight?: number; strongEv?: boolean }): MaterialLink => ({
  other: o.other ?? "x1",
  otherCampaign: o.otherCampaign ?? "K01",
  score: o.score ?? 0.4,
  strong: o.strong ?? false,
  rule: o.rule ?? "campaign",
  evidence: [{ evidence: "ten sam szablon strony, przecinek, i \"cudzysłów\"", weight: o.weight ?? 0.3, strong: o.strongEv ?? false, discounted: false, kind: "pivot", pivotType: "page_template", edgeType: null, pivot: "page_template:t1" }],
});

const item = (o: Partial<MaterialItemResult>): MaterialItemResult => ({
  id: "m1",
  caseId: "sprawa-1",
  verdict: "known_campaign",
  verdictText: "",
  campaign: "K01",
  similarCampaigns: [],
  apart: [],
  withNew: [],
  links: [],
  features: {},
  errors: [],
  ...o,
});

describe("materialConfidence", () => {
  it("certain with a strong premise, likely from 0.5, uncertain otherwise", () => {
    expect(materialConfidence(item({ links: [link({ strong: true, score: 0.9 })] }))).toBe("certain");
    expect(materialConfidence(item({ links: [link({ weight: 0.75, score: 0.75 })] }))).toBe("certain");
    expect(materialConfidence(item({ links: [link({ score: 0.55 })] }))).toBe("likely");
    expect(materialConfidence(item({ links: [link({ score: 0.45 })] }))).toBe("uncertain");
    // only links to the record's own campaign count
    expect(materialConfidence(item({ links: [link({ strong: true, otherCampaign: "K02" })] }))).toBe("uncertain");
    expect(materialConfidence(item({ verdict: "new_campaign", campaign: null }))).toBe("uncertain");
    expect(materialConfidence(item({ verdict: "duplicate", duplicateOf: { id: "a1", reason: "identyczny obraz" } }))).toBe("certain");
  });

  it("caps a creative variant at likely: the assignment rests on the creative alone", () => {
    const variant = { campaignBasis: "content_variant" as const };
    expect(materialConfidence(item({ ...variant, links: [link({ weight: 0.9, score: 0.9 })] }))).toBe("likely");
    expect(materialConfidence(item({ ...variant, links: [link({ strong: true, score: 0.95 })] }))).toBe("likely");
    expect(materialConfidence(item({ ...variant, links: [link({ score: 0.3 })] }))).toBe("uncertain");
    expect(materialConfidence(item({ ...variant, verdict: "duplicate", duplicateOf: { id: "a1", reason: "identyczny obraz" } }))).toBe("likely");
  });

  it("uses the similar campaigns for a record of a new campaign in a group", () => {
    expect(materialConfidence(item({ verdict: "similar_campaigns", campaign: null, similarCampaigns: ["K03"], links: [link({ otherCampaign: "K03", score: 0.6 })] }))).toBe("likely");
  });
});

describe("materialCsv", () => {
  it("writes the fixed columns in order, one row per record, quoted where needed", () => {
    const csv = materialCsv({
      items: [
        item({ links: [link({ score: 0.55 })] }),
        item({ id: "m2", caseId: "sprawa-2", verdict: "insufficient", campaign: null, missing: ["link do reklamy albo strony docelowej", "zrzut z widocznym paskiem adresu"] }),
        item({ id: "m3", caseId: "sprawa-3", verdict: "duplicate", duplicateOf: { id: "m1", reason: "identyczny obraz" }, newCampaign: "N1", similarCampaigns: ["K02", "K03"] }),
        item({ id: "m4", verdict: "new_campaign", campaign: null, nearMisses: [{ campaign: "K03", other: "x1", score: 0.4, rule: "account-conflict", reason: "r", sharedKinds: [] }, { campaign: "K07", other: "x2", score: 0.2, rule: "family-only-kind", reason: "r", sharedKinds: [] }] }),
      ],
    });
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(MATERIAL_CSV_COLUMNS.join(","));
    expect(lines[0]).toBe("material_id,case,verdict,campaign_id,similar_campaigns,new_campaign_id,duplicate_of,confidence,score,top_premise,missing_data,blisko_bez_polaczenia");
    expect(lines[1]).toBe('m1,sprawa-1,known_campaign,K01,,,,likely,0.5500,"ten sam szablon strony, przecinek, i ""cudzysłów""",,');
    expect(lines[2]).toBe("m2,sprawa-2,insufficient,,,,,uncertain,,,link do reklamy albo strony docelowej; zrzut z widocznym paskiem adresu,");
    expect(lines[3]).toBe("m3,sprawa-3,duplicate,K01,K02;K03,N1,m1,certain,,duplikat m1: identyczny obraz,,");
    expect(lines[4]).toBe("m4,sprawa-1,new_campaign,,,,,uncertain,,,,K03: account-conflict; K07: family-only-kind");
  });
});
