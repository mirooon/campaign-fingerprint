import { describe, expect, it } from "vitest";
import { emptyAdLibraryInfo, type AdLibraryInfo } from "../osint/adLibrary";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset } from "./testkit";

const pairOf = (graph: ReturnType<typeof buildEvidenceGraph>, a: string, b: string) =>
  graph.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));

const google = (adId: string, over: Record<string, string> = {}): Record<string, string> => ({
  ad_platform: "google",
  ad_id: adId,
  ad_library_url: `https://atc.example/creative/${adId}`,
  ...over,
});

describe("ad-library traces in the graph", () => {
  it("makes one advertiser node of two records with the same advertiser_id and different display names", () => {
    const graph = buildEvidenceGraph(
      makeDataset([
        { id: "a", advertiser: "Nazwa Pierwsza", extra: google("CR1", { advertiser_id: "AR0001", advertiser_legal_name: "Fikcyjna Firma Sp. z o.o.", advertiser_location: "PL", advertiser_verified: "true" }) },
        { id: "b", advertiser: "Nazwa Druga", extra: google("CR2", { advertiser_id: "AR0001", advertiser_legal_name: "Fikcyjna Firma Sp. z o.o.", advertiser_location: "PL", advertiser_verified: "true" }) },
      ]),
      { textMethod: "none" },
    );
    const nodes = graph.nodes.filter((n) => n.type === "advertiser");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].key).toBe("google:AR0001");
    expect(nodes[0].data).toMatchObject({ platform: "google", advertiserId: "AR0001", legalName: "Fikcyjna Firma Sp. z o.o.", location: "PL", verified: true });
    expect(nodes[0].data.names).toEqual(["Nazwa Pierwsza", "Nazwa Druga"]);
    expect(pairOf(graph, "a", "b")!.evidence.map((e) => e.pivotType)).toEqual(["advertiser"]);
  });

  it("keeps the advertiser of another platform with the same ID string apart", () => {
    const graph = buildEvidenceGraph(
      makeDataset([
        { id: "a", extra: google("CR1", { advertiser_id: "AR0001" }) },
        { id: "b", extra: { ...google("CR2", { advertiser_id: "AR0001" }), ad_platform: "tiktok" } },
      ]),
      { textMethod: "none" },
    );
    expect(graph.nodes.filter((n) => n.type === "advertiser").map((n) => n.key).sort()).toEqual(["google:AR0001", "tiktok:AR0001"]);
    expect(pairOf(graph, "a", "b")).toBeUndefined();
  });

  it("treats the same library ad ID on one platform as a duplicate and the same string on two platforms as different ads", () => {
    const graph = buildEvidenceGraph(
      makeDataset([
        { id: "a", extra: google("CR7") },
        { id: "b", extra: google("CR7") },
        { id: "c", extra: { ...google("CR7"), ad_platform: "tiktok" } },
      ]),
      { textMethod: "none" },
    );
    expect(pairOf(graph, "a", "b")!.evidence.map((e) => e.pivotType)).toContain("campaign_param");
    expect(pairOf(graph, "a", "c")).toBeUndefined();
    const node = graph.nodes.find((n) => n.key === "ad_library_id=google:CR7")!;
    expect(node.data.sourceUrl).toBe("https://atc.example/creative/CR7");
  });

  it("feeds a Google payer into ad_payer keyed with the platform, which alone does not merge campaigns", () => {
    const graph = buildEvidenceGraph(
      makeDataset([
        { id: "a", extra: google("CR1", { ad_payers: "Fundator Testowy" }) },
        { id: "b", extra: google("CR2", { ad_payers: "fundator  testowy" }) },
        { id: "c", extra: { ...google("CR3", { ad_payers: "Fundator Testowy" }), ad_platform: "meta" } },
      ]),
      { textMethod: "none" },
    );
    const payers = graph.nodes.filter((n) => n.type === "ad_payer");
    expect(payers.map((n) => n.key).sort()).toEqual(["fundator testowy", "google:fundator testowy"]);
    expect(pairOf(graph, "a", "b")!.evidence.map((e) => e.pivotType)).toEqual(["ad_payer"]);
    expect(pairOf(graph, "a", "c")).toBeUndefined();
    const { campaigns } = clusterCampaigns(graph);
    expect(campaigns.assignments.a).not.toBe(campaigns.assignments.b);
  });

  it("does not read an unverified status as a fact", () => {
    const graph = buildEvidenceGraph(makeDataset([{ id: "a", extra: google("CR1", { advertiser_id: "AR0001" }) }]), { textMethod: "none" });
    expect(graph.nodes.find((n) => n.type === "advertiser")!.data.verified).toBeNull();
  });
});

describe("advertiser page of the Meta Ad Library (B-062)", () => {
  const lib = (id: string, over: Partial<AdLibraryInfo>): AdLibraryInfo => ({ ...emptyAdLibraryInfo(id, null), ...over });

  it("makes one advertiser node of two ads with the same page ID and different page names, with the emission attributes", () => {
    const graph = buildEvidenceGraph(
      makeDataset([
        { id: "a", advertiser: "Nazwa Strony Pierwsza", adLibrary: [lib("1000000000000101", { pageId: "900000000001", pageName: "Nazwa Strony Pierwsza", pageDeleted: true, takenDown: true })] },
        { id: "b", advertiser: "Nazwa Strony Druga", adLibrary: [lib("1000000000000202", { pageId: "900000000001", pageName: "Nazwa Strony Druga", pageDeleted: true, takenDown: false })] },
        { id: "c", advertiser: "Nazwa Strony Pierwsza", adLibrary: [lib("1000000000000303", { pageId: "900000000002", pageName: "Nazwa Strony Pierwsza" })] },
      ]),
      { textMethod: "none" },
    );
    const nodes = graph.nodes.filter((n) => n.type === "advertiser");
    expect(nodes.map((n) => n.key).sort()).toEqual(["meta:900000000001", "meta:900000000002"]);
    const page = nodes.find((n) => n.key === "meta:900000000001")!;
    expect(page.data).toMatchObject({ platform: "meta", advertiserId: "900000000001", names: ["Nazwa Strony Pierwsza", "Nazwa Strony Druga"], pageDeleted: true, adsTakenDown: 1 });
    expect(pairOf(graph, "a", "b")!.evidence.map((e) => e.pivotType)).toEqual(["advertiser"]);
    // the same display name on a different page is a different account
    expect(pairOf(graph, "a", "c")).toBeUndefined();
  });
});

describe("delivery dates of a library ad (B-064)", () => {
  it("puts the library's first and last delivery on the material as attributes of the ad, apart from the capture date", () => {
    const graph = buildEvidenceGraph(
      makeDataset([{ id: "a", firstSeen: "2026-11-20T00:00:00.000Z", extra: google("CR1", { ad_first_shown: "2026-10-01T00:00:00.000Z", ad_last_shown: "2026-11-15T00:00:00.000Z" }) }]),
      { textMethod: "none" },
    );
    const data = graph.nodes.find((n) => n.id === "item:a")!.data;
    expect(data).toMatchObject({ adFirstShown: "2026-10-01T00:00:00.000Z", adLastShown: "2026-11-15T00:00:00.000Z", firstSeen: "2026-11-20T00:00:00.000Z" });
  });

  it("takes the start from the creative read by yt-dlp for an ad found by its ID", () => {
    const lib = emptyAdLibraryInfo("1000000000000101", null);
    const graph = buildEvidenceGraph(
      makeDataset([{ id: "a", adLibrary: [{ ...lib, creative: { text: "x", title: null, imageUrl: null, videoUrl: null, uploader: null, uploaderId: null, startedAt: "2026-11-02T08:00:00.000Z" } }] }]),
      { textMethod: "none" },
    );
    expect(graph.nodes.find((n) => n.id === "item:a")!.data.adFirstShown).toBe("2026-11-02T08:00:00.000Z");
  });
});
