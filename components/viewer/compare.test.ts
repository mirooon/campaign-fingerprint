import { describe, expect, it } from "vitest";
import { clusterCampaigns } from "@/lib/graph/cluster";
import { buildEvidenceGraph } from "@/lib/graph/link";
import type { Campaign } from "@/lib/graph/model";
import { endpointRef, makeDataset, type TestItemSpec } from "@/lib/graph/testkit";
import {
  campaignAttributes,
  campaignHasPersona,
  itemOptions,
  pairLink,
  personaMentions,
  personaOptions,
  personaSourceOf,
  personaSourcesOf,
  plural,
  sharedEntities,
  validItemKey,
  weightFormula,
  weightPartsOf,
} from "./compare";
import { buildIndex, visibleNodes } from "./graphView";

const BACKEND = (uuid: string) => `https://leads-api.test/api/v1/submit/${uuid}/`;

const SPECS: TestItemSpec[] = [
  {
    id: "a1",
    url: "https://alpha.example/",
    advertiser: "Alfa Demo",
    personas: ["Adam Testowy"],
    deepfakeScore: 0.91,
    kit: { endpoints: [endpointRef(BACKEND("0b9a5c3e-1d2f-4a6b-9c8d-7e6f5a4b3c2d"), "https://alpha.example/")] },
  },
  {
    id: "a2",
    url: "https://beta.example/",
    advertiser: "Beta Demo",
    personas: ["Adam Testowy"],
    kit: { endpoints: [endpointRef(BACKEND("7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2910"), "https://beta.example/")] },
  },
  { id: "shop", url: "https://shop.example/", kit: { endpoints: [endpointRef("https://api.web3forms.com/submit", "https://shop.example/")] } },
  { id: "course", url: "https://course.test/", kit: { endpoints: [endpointRef("https://api.web3forms.com/submit", "https://course.test/")] } },
];

function setup() {
  const { graph, campaigns } = clusterCampaigns(buildEvidenceGraph(makeDataset(SPECS), { textMethod: "none" }));
  return { graph, campaigns, idx: buildIndex(graph, campaigns) };
}

describe("comparison helpers", () => {
  it("lists ads by campaign and validates deep-link keys", () => {
    const { idx, campaigns } = setup();
    const opts = itemOptions(idx);
    expect(opts.map((o) => o.key).sort()).toEqual(["a1", "a2", "course", "shop"]);
    expect(opts.find((o) => o.key === "a1")!.label).toBe("a1 · Alfa Demo");
    // the two ads of the same campaign are adjacent
    const pos = (k: string) => opts.findIndex((o) => o.key === k);
    expect(Math.abs(pos("a1") - pos("a2"))).toBe(1);
    expect(campaigns.assignments.a1).toBe(campaigns.assignments.a2);
    expect(validItemKey(idx, "a1")).toBe("a1");
    expect(validItemKey(idx, "nope")).toBeNull();
    expect(validItemKey(idx, null)).toBeNull();
  });

  it("finds the stored link and the shared strong backend of a campaign pair", () => {
    const { idx } = setup();
    const link = pairLink(idx, "a2", "a1");
    expect(link?.strong).toBe(true);
    const shared = sharedEntities(idx, "a1", "a2", link!.evidence);
    expect(shared[0].node.id).toBe("endpoint:leads-api.test/api/v1/submit/<uuid>/");
    expect(shared[0].node.strong).toBe(true);
    expect(shared[0].inDirect).toBe(true);
  });

  it("explains a non-merge: the shared public form service is listed with its discount", () => {
    const { idx, campaigns } = setup();
    expect(campaigns.assignments.shop).not.toBe(campaigns.assignments.course);
    expect(pairLink(idx, "shop", "course")?.strong ?? false).toBe(false);
    const shared = sharedEntities(idx, "shop", "course");
    const form = shared.find((s) => s.node.id === "endpoint:api.web3forms.com/submit")!;
    expect(form.node.discounts.map((d) => d.rule)).toContain("endpointHosts:web3forms.com");
    expect(form.node.weight!).toBeLessThan(0.05);
    expect(sharedEntities(idx, "a1", "shop")).toEqual([]);
  });

  it("reads persona mentions with their source and builds the persona filter", () => {
    const { idx, campaigns, graph } = setup();
    expect(personaMentions(idx, "a1")).toEqual([{ nodeId: "persona:adam-testowy", name: "Adam Testowy", sources: ["watchlist"] }]);
    expect(personaMentions(idx, "shop")).toEqual([]);
    const opts = personaOptions(campaigns.campaigns);
    expect(opts).toEqual([{ id: "adam-testowy", name: "Adam Testowy", campaigns: 1, ads: 2 }]);
    const withPersona = campaigns.campaigns.filter((c) => campaignHasPersona(c, "adam-testowy"));
    expect(withPersona.flatMap((c) => c.members).sort()).toEqual(["a1", "a2"]);
    expect(campaigns.campaigns.every((c) => campaignHasPersona(c, null))).toBe(true);
    const visible = visibleNodes(graph, campaigns, idx, { campaignId: null, sharedOnly: false, hideSingletons: false, personaId: "adam-testowy" });
    expect([...visible].filter((id) => id.startsWith("item:")).sort()).toEqual(["item:a1", "item:a2"]);
  });

  it("parses persona sources from edge evidence", () => {
    expect(personaSourceOf("persona z kolumny danych wejściowych")).toBe("ingest");
    expect(personaSourceOf("persona z NER (model językowy)")).toBe("ner");
    expect(personaSourceOf("persona z OCR/ASR (dopasowanie przybliżone)")).toBe("fuzzy");
    expect(personaSourceOf("persona z listy obserwowanych nazwisk")).toBe("watchlist");
    expect(personaSourcesOf("persona z listy obserwowanych nazwisk; z kolumny danych wejściowych")).toEqual(["watchlist", "ingest"]);
  });

  it("tolerates campaigns without attributes (older campaigns.json)", () => {
    const old = { id: "K01", size: 2, members: ["x", "y"] } as unknown as Campaign;
    expect(campaignAttributes(old)).toEqual({ personas: [], cyrillic: 0, cloakingSuspected: 0, deepfakeScoreMax: null });
    expect(personaOptions([old])).toEqual([]);
    expect(campaignHasPersona(old, "adam-testowy")).toBe(false);
  });

  it("formats the pivot weight with the ubiquity factor when present", () => {
    const { graph } = setup();
    const node = graph.nodes.find((n) => n.id === "endpoint:api.web3forms.com/submit")!;
    const parts = weightPartsOf(node)!;
    expect(parts.ubiquity).toBeDefined();
    expect(weightFormula(parts)).toMatch(/^typ 0\.95 × lista 0\.05 × odwrotna częstość [\d.]+ × powszechność [\d.]+$/);
    expect(weightFormula({ base: 0.5, listFactor: 1, idf: 0.8 })).toBe("typ 0.5 × lista 1 × odwrotna częstość 0.8");
  });

  it("uses Polish plural forms", () => {
    const forms: [string, string, string] = ["kampania", "kampanie", "kampanii"];
    expect([1, 2, 4, 5, 12, 14, 22, 25, 0].map((n) => plural(n, forms))).toEqual([
      "kampania",
      "kampanie",
      "kampanie",
      "kampanii",
      "kampanii",
      "kampanii",
      "kampanie",
      "kampanii",
      "kampanii",
    ]);
  });
});
