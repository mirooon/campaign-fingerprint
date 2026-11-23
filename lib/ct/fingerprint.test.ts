import { describe, expect, it } from "vitest";
import type { Campaign, CampaignsFile } from "../graph/model";
import { mergeCtConfig } from "./config";
import { backfillPatterns, brandInText, buildFingerprints, matchDomain, normalizeToken, registrableOfName, templateSkeleton } from "./fingerprint";

function campaign(id: string, domains: string[], extra: Partial<Campaign> = {}): Campaign {
  return {
    id,
    size: 3,
    members: [],
    firstSeen: null,
    lastSeen: null,
    topEvidence: [],
    domains,
    advertisers: [],
    cohesion: 0,
    strongComponents: 1,
    attributes: { personas: [], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null },
    ...extra,
  };
}

function file(campaigns: Campaign[]): CampaignsFile {
  return { version: 1, generatedAt: "", method: { unionFind: "", louvain: { resolution: 1, seed: 42, modularity: null }, minLinkScore: 0.15 }, campaigns, assignments: {} };
}

// A finance kit in the style of the CSIRT KNF 2026 example (finance23-voluptas94.sbs, then .pro)
const FINANCE = campaign("KF", ["finance12-dolorem51.sbs", "finance88-quia40.sbs"]);
const config = mergeCtConfig({ lexicon: { brands: ["KryptoZysk"], media: ["fakt"] } });

describe("CT matcher: domain-name templates", () => {
  const set = buildFingerprints(file([FINANCE]), { config });

  it("matches a new domain from the same template (same TLD) and its TLD variant", () => {
    const sbs = matchDomain("finance23-voluptas94.sbs", set)!;
    expect(sbs).toMatchObject({ campaignId: "KF", kind: "template", template: "finance<n>-<lorem><n>.sbs" });
    expect(sbs.score).toBeCloseTo(0.95);
    expect(sbs.similarDomains).toEqual(["finance12-dolorem51.sbs", "finance88-quia40.sbs"]);
    const pro = matchDomain("finance23-voluptas94.pro", set)!;
    expect(pro).toMatchObject({ campaignId: "KF", kind: "template_other_tld", template: "finance<n>-<lorem><n>.*" });
    expect(pro.score).toBeCloseTo(0.85);
    expect(pro.evidence[0]).toContain("under a different top-level domain (.pro)");
  });

  it("reads certificate names: subdomains and wildcards map to the registrable domain", () => {
    expect(matchDomain("www.finance23-voluptas94.pro", set)?.domain).toBe("finance23-voluptas94.pro");
    expect(matchDomain("*.finance23-voluptas94.sbs", set)?.kind).toBe("template");
    expect(registrableOfName("*.a.b.finance1-dolor2.sbs.")).toBe("finance1-dolor2.sbs");
    expect(registrableOfName("203.0.113.5")).toBeNull();
  });

  it("does not match benign look-alikes (a single common token or another template)", () => {
    for (const benign of [
      "finance.sbs",
      "finance23.sbs",
      "finance-news.pro",
      "yahoo-finance.com",
      "personal-finance23.pro",
      "finance23-news94.sbs", // "news" is not a Lorem word: another template
      "voluptas94.pro", // no anchor word
      "lorem-ipsum.com", // Lorem words without digits
      "dolorem-ipsum.sbs",
      "financeplus-voluptas.pro",
      "finance23-voluptas94.sbs.evil.example", // registrable domain is evil.example
    ]) {
      expect(matchDomain(benign, set), benign).toBeNull();
    }
  });

  it("the same naming kit with another anchor word: candidate on the same TLD, below threshold elsewhere", () => {
    expect(matchDomain("travel23-voluptas94.sbs", set)).toMatchObject({ kind: "lorem_kit", score: 0.6 });
    expect(matchDomain("travel23-voluptas94.pro", set)).toBeNull();
    expect(matchDomain("travel23-voluptas94.pro", set, { includeBelowThreshold: true })).toMatchObject({ kind: "lorem_kit", score: 0.5 });
  });

  it("never reports the campaign's own domains or ignored domains", () => {
    expect(matchDomain("finance12-dolorem51.sbs", set)).toBeNull();
    const ignoring = buildFingerprints(file([FINANCE]), { config: { ...config, ignoreDomains: ["finance23-voluptas94.sbs"] } });
    expect(matchDomain("finance23-voluptas94.sbs", ignoring)).toBeNull();
  });

  it("skeletons replace literal words only", () => {
    expect(templateSkeleton("finance<n>-<lorem><n>.*")).toBe("<w><n>-<lorem><n>.*");
    expect(templateSkeleton("pl-zwrot<n>")).toBe("<w>-<w><n>");
  });
});

describe("CT matcher: lexicon brands and media", () => {
  const set = buildFingerprints(
    file([
      campaign("K1", ["kryptozysk-ai.example", "zysk-ai-platforma.example"]),
      campaign("K3", ["wiadomosci-demo.test", "fakt-dnia-demo.example"]),
      FINANCE,
    ]),
    { config },
  );

  it("a configured brand used by a campaign matches with campaign context", () => {
    const m = matchDomain("kryptozysk-ai24.pro", set)!;
    expect(m).toMatchObject({ campaignId: "K1", kind: "brand", score: 0.7 });
    expect(m.evidence[0]).toContain("“kryptozysk”");
    expect(matchDomain("kryptozysk.pro", set)?.kind).toBe("brand");
  });

  it("a brand from the lexicon not used by any campaign gives nothing", () => {
    const other = buildFingerprints(file([campaign("K9", ["sklep-demo.example", "sklep-demo2.example"])]), { config });
    expect(matchDomain("kryptozysk-ai24.pro", other)).toBeNull();
  });

  it("a media name needs another word of the same campaign", () => {
    expect(matchDomain("fakt-dnia-24.pro", set)).toMatchObject({ campaignId: "K3", kind: "media" });
    expect(matchDomain("fakt24.pro", set)).toBeNull();
    expect(matchDomain("wiadomosci24.pl", set)).toBeNull();
  });

  it("brands are found in ad texts and advertiser names, diacritics folded", () => {
    const withText = buildFingerprints(file([campaign("K2", ["energia-dywidenda.test"], { members: ["a1"], advertisers: ["Energia Polska Demo"] })]), {
      config: mergeCtConfig({ lexicon: { brands: ["Bałtycka Energia"] } }),
      graph: { nodes: [{ id: "item:a1", type: "item", key: "a1", label: "", data: { text: "Inwestuj w Bałtycką Energię" } }] } as never,
    });
    expect(normalizeToken("Bałtycka Energia")).toBe("baltyckaenergia");
    // the ad says "Bałtycką Energię" (inflected): still the campaign's brand
    expect(withText.campaigns[0].brands).toEqual(["baltyckaenergia"]);
    expect(matchDomain("baltycka-energia-24.test", withText)).toMatchObject({ campaignId: "K2", kind: "brand" });
    expect(brandInText("Bałtycka Energia", "program Bałtyckiej Energii")).toBe(true);
    expect(brandInText("Bałtycka Energia", "Bałtycka Energetyka")).toBe(false);
    expect(brandInText("Bałtycka Energia", "energia bałtycka")).toBe(false);
    const exact = buildFingerprints(file([campaign("K2", ["baltycka-energia-inwestycje.example"])]), { config: mergeCtConfig({ lexicon: { brands: ["Bałtycka Energia"] } }) });
    expect(matchDomain("baltycka-energia-24.example", exact)).toMatchObject({ campaignId: "K2", kind: "brand" });
  });
});

describe("fingerprint building", () => {
  it("leaves out platform and service domains and singleton campaigns", () => {
    const set = buildFingerprints(file([campaign("K5", ["krotki.test", "web3forms.com", "wygrana-demo.example"]), campaign("N1", ["finance1-dolor2.sbs"], { size: 1 })]), {
      config,
      isExcludedDomain: (d) => ["krotki.test", "web3forms.com"].includes(d),
    });
    expect(set.excluded).toEqual(["krotki.test", "web3forms.com"]);
    expect(set.campaigns.map((c) => c.campaignId)).toEqual(["K5"]);
    expect(set.campaigns[0].templates).toEqual([]);
  });

  it("derives crt.sh prefix patterns from templates", () => {
    const set = buildFingerprints(file([FINANCE, campaign("K4", ["zwrot24-dolorem51.test", "pl-zwrot12-dolor3.example"])]), { config });
    expect(backfillPatterns(set)).toEqual(["finance%", "pl-zwrot%", "zwrot%"]);
  });
});
