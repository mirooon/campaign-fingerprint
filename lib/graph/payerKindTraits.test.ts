/**
 * The kind of the declared payer (lib/osint/payerKind.ts) in the graph: a stub names no one, so it makes no
 * `ad_payer` pivot; other kinds keep the pivot (never alone: campaignRules.notAloneKinds) and the item gets
 * the features payerKinds, payerEqualsBeneficiary and payerSuspicious. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { emptyAdLibraryInfo, type AdLibraryInfo } from "../osint/adLibrary";
import { encodeXid } from "../osint/clickIds";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { makeDataset, type TestItemSpec } from "./testkit";

function run(specs: TestItemSpec[]) {
  return clusterCampaigns(buildEvidenceGraph(makeDataset(specs), { textMethod: "none" }));
}
const same = (res: ReturnType<typeof run>, a: string, b: string) => res.campaigns.assignments[a] === res.campaigns.assignments[b];
const linkOf = (res: ReturnType<typeof run>, a: string, b: string) => res.graph.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
const xid = (machine: string, pid: number, counter: number) => encodeXid({ time: "2026-09-10T12:00:00Z", machine, pid, counter });
const libRec = (id: string, payer: string, beneficiary = payer): AdLibraryInfo => ({ ...emptyAdLibraryInfo(id, null), payers: [payer], beneficiaries: [beneficiary] });
const payerPivots = (res: ReturnType<typeof run>) => res.graph.nodes.filter((n) => n.type === "ad_payer");

describe("a placeholder payer makes no pivot", () => {
  it.each(["Test", "XYZ"])("does not link two ads that declare %s (Meta repository)", (payer) => {
    const res = run([
      { id: "a", url: "https://zdrowie-alfa.test/", adLibrary: [libRec("1000000000000101", payer)] },
      { id: "b", url: "https://portal-beta.example/", adLibrary: [libRec("1000000000000202", payer)] },
    ]);
    expect(payerPivots(res)).toHaveLength(0);
    expect(linkOf(res, "a", "b")).toBeUndefined();
  });

  it("does not link two ads of a library record that declare a stub", () => {
    const rec = (adId: string) => ({ ad_platform: "google", ad_id: adId, ad_payers: "Test" });
    const res = run([
      { id: "a", url: "https://zdrowie-alfa.test/", extra: rec("CR1") },
      { id: "b", url: "https://portal-beta.example/", extra: rec("CR2") },
    ]);
    expect(payerPivots(res)).toHaveLength(0);
    expect(linkOf(res, "a", "b")).toBeUndefined();
  });

  it("still reports the kind on the item", () => {
    const res = run([{ id: "a", url: "https://zdrowie-alfa.test/", adLibrary: [libRec("1000000000000101", "Test")] }]);
    const item = res.graph.nodes.find((n) => n.id === "item:a")!;
    expect(item.data).toMatchObject({ payerKinds: ["placeholder"], payerEqualsBeneficiary: true, payerSuspicious: true });
  });
});

describe("other kinds keep the pivot, but never alone", () => {
  it("joins two ads with the same rare gibberish payer once a second trace of the operator confirms it", () => {
    const res = run([
      { id: "a", url: `https://zdrowie-alfa.test/?clickid=${xid("0a0b0c", 50001, 100)}`, adLibrary: [libRec("1000000000000101", "qwe9f8sd7f6")] },
      { id: "b", url: `https://portal-beta.example/?clickid=${xid("0a0b0c", 50001, 900)}`, adLibrary: [libRec("1000000000000202", "qwe9f8sd7f6")] },
    ]);
    expect(same(res, "a", "b")).toBe(true);
    expect(linkOf(res, "a", "b")!.evidence.map((e) => e.pivotType)).toContain("ad_payer");
    expect(res.graph.nodes.find((n) => n.id === "item:a")!.data.payerKinds).toEqual(["gibberish"]);
  });

  it("does not merge two ads with the same gibberish payer and nothing else", () => {
    const res = run([
      { id: "a", url: "https://zdrowie-alfa.test/", adLibrary: [libRec("1000000000000101", "qwe9f8sd7f6")] },
      { id: "b", url: "https://portal-beta.example/", adLibrary: [libRec("1000000000000202", "qwe9f8sd7f6")] },
    ]);
    expect(linkOf(res, "a", "b")!.evidence.map((e) => e.pivotType)).toEqual(["ad_payer"]);
    expect(same(res, "a", "b")).toBe(false);
  });

  it("marks a private person as the payer with a note about identity theft on the payer node", () => {
    const res = run([
      { id: "a", url: "https://zdrowie-alfa.test/", adLibrary: [libRec("1000000000000101", "Jan Testowy")] },
      { id: "b", url: "https://portal-beta.example/", adLibrary: [libRec("1000000000000202", "Jan Testowy")] },
    ]);
    const node = payerPivots(res)[0];
    expect(node.data).toMatchObject({ payerKind: "person" });
    expect(String(node.data.payerNote)).toMatch(/kradzie/);
    expect(res.graph.nodes.find((n) => n.id === "item:a")!.data).toMatchObject({ payerKinds: ["person"], payerSuspicious: false });
  });

  it("reads a foreign-script name as suspicious only on a Polish ad", () => {
    const res = run([
      { id: "a", url: "https://zdrowie-alfa.test/", text: "Zarabiaj więcej, już dziś: żaden wysiłek", adLibrary: [libRec("1000000000000101", "Иван Петров")] },
      { id: "b", url: "https://portal-beta.example/", text: "Earn more, today", adLibrary: [libRec("1000000000000202", "Иван Петров")] },
    ]);
    expect(res.graph.nodes.find((n) => n.id === "item:a")!.data).toMatchObject({ payerKinds: ["person_foreign_script"], payerSuspicious: true });
    expect(res.graph.nodes.find((n) => n.id === "item:b")!.data).toMatchObject({ payerKinds: ["person"], payerSuspicious: false });
  });

  it("compares the payer with the page name of the advertiser", () => {
    const res = run([{ id: "a", url: "https://zdrowie-alfa.test/", advertiser: "Sklep Przykladowy", adLibrary: [libRec("1000000000000101", "sklep przykładowy")] }]);
    expect(res.graph.nodes.find((n) => n.id === "item:a")!.data.payerKinds).toEqual(["matches_page"]);
  });
});
