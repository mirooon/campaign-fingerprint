/**
 * Narrative in the graph (B-187, B-294, B-295): an attribute of the material, of the campaign and of the group
 * of similar campaigns; it never adds evidence, so it changes no pair score. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { emptyAdLibraryInfo } from "../osint/adLibrary";
import { makeDataset, type TestItemSpec } from "./testkit";

const run = (specs: TestItemSpec[], embeddings?: Record<string, number[]>) =>
  clusterCampaigns(buildEvidenceGraph(makeDataset(specs), embeddings ? { embeddings } : { textMethod: "none" }));

describe("narrative as an attribute", () => {
  it("stores the narrative with the material's date on the item and adds no evidence between ads", () => {
    const res = run([
      { id: "a", url: "https://alfa-wiadomosci.example/", text: "Dopłata z ZUS dla każdego seniora", firstSeen: "2026-10-01T00:00:00.000Z" },
      { id: "b", url: "https://beta-zdrowie.test/", text: "Dopłata z ZUS dla każdego seniora", firstSeen: "2026-10-02T00:00:00.000Z" },
    ]);
    const a = res.graph.nodes.find((n) => n.id === "item:a")!.data.narrative as { topics: Array<{ id: string }>; date: string };
    expect(a.topics[0].id).toBe("subsidy");
    expect(a.date).toBe("2026-10-01T00:00:00.000Z");
    expect(res.graph.links).toEqual([]);
    expect(res.campaigns.assignments.a).not.toBe(res.campaigns.assignments.b);
  });

  it("keeps apart the same title in two languages (embeddings) and the same product on two infrastructures", () => {
    const res = run(
      [
        { id: "pl", url: "https://fikcyjnol-forte.example/pl/", text: "Fikcyjnol Forte: lek na stawy, który poleca lekarz" },
        { id: "de", url: "https://fikcyjnol-shop.test/de/", text: "Fikcyjnol Forte: das Mittel für Gelenke, empfohlen vom Arzt" },
      ],
      { pl: [1, 0, 0], de: [1, 0, 0] },
    );
    expect(res.campaigns.assignments.pl).not.toBe(res.campaigns.assignments.de);
  });

  it("labels the material by the IHC rule: persona with a promise of profit, and none for the persona alone", () => {
    const res = run([
      { id: "a", url: "https://alfa-wiadomosci.example/", text: "Adam Testowy: pasywny dochód dla każdego", personas: ["Adam Testowy"] },
      { id: "b", url: "https://beta-zdrowie.test/", text: "Adam Testowy w szpitalu", personas: ["Adam Testowy"] },
    ]);
    const label = (id: string) => (res.graph.nodes.find((n) => n.id === `item:${id}`)!.data.narrative as { label?: string } | undefined)?.label;
    expect(label("a")).toBe("celeb_bait_investment");
    expect(label("b")).toBeUndefined();
  });

  it("summarises the narratives of a campaign, with a switch of topic within a week on one infrastructure", () => {
    const res = run([
      { id: "a", url: "https://alfa-wiadomosci.example/x", text: "Inwestuj w platformę i zarabiaj", trackers: [{ kind: "ga4", id: "G-TEST1234" }], firstSeen: "2026-10-01T00:00:00.000Z" },
      { id: "b", url: "https://alfa-wiadomosci.example/y", text: "Złoto z NBP dla obywateli", trackers: [{ kind: "ga4", id: "G-TEST1234" }], firstSeen: "2026-10-04T00:00:00.000Z" },
    ]);
    const c = res.campaigns.campaigns.find((k) => k.members.includes("a"))!;
    expect(c.members).toEqual(["a", "b"]);
    expect(c.attributes.narrative?.topics.map((t) => t.id).sort()).toEqual(["gold_reserve", "investment"]);
    expect(c.attributes.narrative?.switches).toHaveLength(1);
  });
});

describe("pair of personas as a trait of the group (B-295)", () => {
  it("puts two ads with the same pair of people and different infrastructure in one group, as two campaigns", () => {
    const res = run([
      { id: "a", url: "https://alfa-wiadomosci.example/", personas: ["Adam Testowy", "Ewa Przykładowa"], personaCategories: { "Adam Testowy": "Dziennikarze", "Ewa Przykładowa": "Dziennikarze" } },
      { id: "b", url: "https://beta-zdrowie.test/", personas: ["Adam Testowy", "Ewa Przykładowa"], personaCategories: { "Adam Testowy": "Dziennikarze", "Ewa Przykładowa": "Dziennikarze" } },
    ]);
    const { assignments, families } = res.campaigns;
    expect(assignments.a).not.toBe(assignments.b);
    const fam = (families ?? []).find((f) => f.members.includes("a"));
    expect(fam?.members).toEqual(["a", "b"]);
    expect(fam?.personaCategories).toEqual([{ category: "Dziennikarze", count: 2 }]);
  });

  it("does not group two ads that share only one person", () => {
    const res = run([
      { id: "a", url: "https://alfa-wiadomosci.example/", personas: ["Adam Testowy"] },
      { id: "b", url: "https://beta-zdrowie.test/", personas: ["Adam Testowy"] },
    ]);
    expect(res.campaigns.families).toEqual([]);
  });
});

describe("hallucinated subtitle credits in transcripts (B-213)", () => {
  it("gives no similar text to two music-only videos whose transcripts hold only a subtitle credit", () => {
    const credit = "Napisy stworzone przez społeczność Amara.org";
    const res = clusterCampaigns(
      buildEvidenceGraph(makeDataset([
        { id: "a", url: "https://alfa-wiadomosci.example/", asrText: credit },
        { id: "b", url: "https://beta-zdrowie.test/", asrText: credit },
      ])),
    );
    expect(res.graph.links.some((l) => l.evidence.some((e) => e.edgeType === "similar_text"))).toBe(false);
  });
});

describe("brand on the creative (B-199)", () => {
  it("keeps the brand as an attribute of the material and of the campaign and adds no evidence", () => {
    const brand = { id: "kurier-testowy", name: "Kurier Testowy", kind: "media", probability: 0.8 };
    const res = run([
      { id: "a", url: "https://alfa-wiadomosci.example/", creativeBrand: brand },
      { id: "b", url: "https://beta-zdrowie.test/", creativeBrand: brand },
    ]);
    expect(res.graph.nodes.find((n) => n.id === "item:a")!.data.creativeBrand).toEqual(brand);
    expect(res.graph.links).toEqual([]);
    const c = res.campaigns.campaigns.find((k) => k.members.includes("a"))!;
    expect(c.attributes.brands).toEqual([{ id: "kurier-testowy", name: "Kurier Testowy", count: 1 }]);
  });
});

describe("age of the landing domain and certificate at first sight (B-191)", () => {
  it("stores domainAgeDays and certAgeDays on the material and the lead on the domain node", () => {
    const ds = makeDataset([{ id: "a", url: "https://nowa-domena.example/", firstSeen: "2026-09-10T12:00:00.000Z" }], {
      rdap: { "nowa-domena.example": { registrar: "Rejestrator Testowy", created: "2026-09-07T10:00:00Z" } },
      certs: { "nowa-domena.example": [{ id: "c1", issuer: "Test CA", sanDomains: ["nowa-domena.example"], notBefore: "2026-09-09T00:00:00" }] },
    });
    const res = clusterCampaigns(buildEvidenceGraph(ds, { textMethod: "none" }));
    expect(res.graph.nodes.find((n) => n.id === "item:a")!.data).toMatchObject({ domainAgeDays: 3, certAgeDays: 1 });
    expect(res.graph.nodes.find((n) => n.id === "domain:nowa-domena.example")!.data).toMatchObject({ leadDays: 3 });
  });
});

describe("brand of the scam (B-139)", () => {
  it("shares a scam_brand pivot between pages on different domains, which alone gives a group, not a campaign", () => {
    const res = run([
      { id: "k1", url: "https://fikcyjnol-sklep.example/", pageText: "Zamów Fikcyjnol Forte z rabatem" },
      { id: "k2", url: "https://zdrowe-stawy.test/", pageText: "Fikcyjnol Forte pomaga na stawy" },
      { id: "q", text: "Fikcyjnol Forte" },
    ]);
    const l = res.graph.links.find((x) => (x.a === "k1" && x.b === "q") || (x.a === "q" && x.b === "k1"))!;
    expect(l.evidence.map((e) => e.pivot)).toContain("campaign_param:scam_brand=fikcyjnolforte");
    const { assignments, families } = res.campaigns;
    expect(assignments.q).not.toBe(assignments.k1);
    expect((families ?? []).find((f) => f.members.includes("q"))?.members).toEqual(["k1", "k2", "q"]);
  });

  it("discounts a generic platform brand used by many unrelated schemes", () => {
    const res = run([
      { id: "a", url: "https://alfa-wiadomosci.example/", pageText: "Quantum AI zarabia za ciebie" },
      { id: "b", url: "https://beta-zdrowie.test/", pageText: "Quantum AI zarabia za ciebie" },
    ]);
    const node = res.graph.nodes.find((n) => n.id === "campaign_param:scam_brand=quantumai")!;
    expect(node.discounts.map((d) => d.rule)).toContain("genericScamBrands:quantumai");
  });
});

describe("generic ad phrases before text comparison (B-137)", () => {
  it("gives no similar text to two ads that share only the stock phrases", () => {
    const stock = "Kliknij i dowiedz się więcej! Ograniczona oferta, zarejestruj się teraz. Tylko dziś!";
    const res = clusterCampaigns(
      buildEvidenceGraph(makeDataset([
        { id: "a", url: "https://alfa-wiadomosci.example/", text: `${stock} Rowery górskie z amortyzacją.` },
        { id: "b", url: "https://beta-zdrowie.test/", text: `Kurs gotowania włoskiego. ${stock}` },
      ])),
    );
    expect(res.graph.links.some((l) => l.evidence.some((e) => e.edgeType === "similar_text"))).toBe(false);
  });
});

describe("ads taken down by the platform (B-192)", () => {
  it("counts the members whose ad the library shows as taken down", () => {
    const lib = (id: string, takenDown: boolean) => ({ ...emptyAdLibraryInfo(id, null), takenDown });
    const res = run([
      { id: "a", url: "https://alfa-wiadomosci.example/x", trackers: [{ kind: "ga4", id: "G-TEST1234" }], adLibrary: [lib("1001", true)] },
      { id: "b", url: "https://alfa-wiadomosci.example/y", trackers: [{ kind: "ga4", id: "G-TEST1234" }], adLibrary: [lib("1002", true)] },
      { id: "c", url: "https://alfa-wiadomosci.example/z", trackers: [{ kind: "ga4", id: "G-TEST1234" }] },
    ]);
    expect(res.campaigns.campaigns[0].attributes.takenDownCount).toBe(2);
  });
});

describe("WhatsApp group invitations (B-207)", () => {
  it("labels a chat.whatsapp.com invitation as WhatsApp, not Telegram", () => {
    const ds = makeDataset([{ id: "a", url: "https://alfa-wiadomosci.example/" }]);
    ds.pages["https://alfa-wiadomosci.example/"].extract!.whatsapp = ["chat.whatsapp.com/AbCdEfGh123"];
    const res = clusterCampaigns(buildEvidenceGraph(ds, { textMethod: "none" }));
    const node = res.graph.nodes.find((n) => n.data.whatsappGroup === true)!;
    expect(node.label).toContain("WhatsApp");
  });
});
