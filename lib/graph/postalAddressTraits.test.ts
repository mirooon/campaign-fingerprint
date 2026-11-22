/**
 * The postal address of a shop as a trace: it supports a link but never joins a campaign alone (an address
 * can be copied from another shop's footer, and virtual offices hand the same one to unrelated shops).
 * Synthetic data only: fictional streets and cities, .example/.test hosts.
 */
import { describe, expect, it } from "vitest";
import { encodeXid } from "../osint/clickIds";
import { clusterCampaigns } from "./cluster";
import { buildEvidenceGraph } from "./link";
import { DEFAULT_LINK_CONFIG } from "./config";
import { makeDataset, type TestItemSpec } from "./testkit";

function run(specs: TestItemSpec[], config = DEFAULT_LINK_CONFIG) {
  return clusterCampaigns(buildEvidenceGraph(makeDataset(specs), { textMethod: "none", config }));
}
const same = (res: ReturnType<typeof run>, a: string, b: string) => res.campaigns.assignments[a] === res.campaigns.assignments[b];
const linkOf = (res: ReturnType<typeof run>, a: string, b: string) => res.graph.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
const xid = (machine: string, pid: number, counter: number) => encodeXid({ time: "2026-09-10T12:00:00Z", machine, pid, counter });
const pair = (addrA: string, addrB: string, withOperator = false): TestItemSpec[] => [
  { id: "a", url: `https://sklep-alfa.test/${withOperator ? `?clickid=${xid("0a0b0c", 50001, 100)}` : ""}`, pageText: `Strona sklepu. Kontakt: ${addrA}` },
  { id: "b", url: `https://sklep-beta.example/${withOperator ? `?clickid=${xid("0a0b0c", 50001, 900)}` : ""}`, pageText: `Inny sklep. Siedziba: ${addrB}` },
];

describe("postal_address", () => {
  it("links two pages with the same address but does not merge them into a campaign on that alone", () => {
    const res = run(pair("ul. Przykładowa 1, 00-001 Miasto", "ul. Przykładowa 1, 00-001 Miasto"));
    const l = linkOf(res, "a", "b")!;
    expect(l.evidence.map((e) => e.pivotType)).toEqual(["postal_address"]);
    expect(l.strong).toBe(false);
    expect(same(res, "a", "b")).toBe(false);
  });

  it("merges them with a second trace of the operator and names postal_address among the premises", () => {
    const res = run(pair("ul. Przykładowa 1, 00-001 Miasto", "ul. Przykładowa 1, 00-001 Miasto", true));
    expect(same(res, "a", "b")).toBe(true);
    expect(linkOf(res, "a", "b")!.evidence.map((e) => e.pivotType)).toContain("postal_address");
  });

  it("gives one key to spelling variants of the same address", () => {
    const res = run(pair("ul. Przykładowa 1, 00-001 Miasto", "ulica Przykładowa 1/5; 00001 Miasto"));
    expect(res.graph.nodes.filter((n) => n.type === "postal_address").map((n) => n.key)).toEqual(["przykladowa 1|00001|miasto"]);
  });

  it("makes no trace of a city alone or a postal box", () => {
    const res = run(pair("Adres: Miasto", "Adres: Skrytka pocztowa 12, 00-001 Miasto"));
    expect(res.graph.nodes.filter((n) => n.type === "postal_address")).toEqual([]);
    expect(res.graph.nodes.find((n) => n.id === "item:a")!.data.addressCompleteness).toBe("city_only");
    expect(res.graph.nodes.find((n) => n.id === "item:b")!.data.addressCompleteness).toBe("po_box");
  });

  it("does not link an address from the list of virtual offices", () => {
    const config = { ...DEFAULT_LINK_CONFIG, lists: { ...DEFAULT_LINK_CONFIG.lists, postalAddressExclusions: [{ match: "przykladowa 1|00001|miasto", factor: 0, reason: "biuro wirtualne" }] } };
    const res = run(pair("ul. Przykładowa 1, 00-001 Miasto", "ul. Przykładowa 1, 00-001 Miasto", true), config);
    expect(linkOf(res, "a", "b")?.evidence.map((e) => e.pivotType) ?? []).not.toContain("postal_address");
  });

  it("keeps the e-mail domain kind and the address completeness as features of the material", () => {
    const res = run([{ id: "a", url: "https://sklep-alfa.test/", emails: ["kontakt@gmail.com", "info@inny.test"], pageText: "ul. Przykładowa 1, 00-001 Miasto" }]);
    const item = res.graph.nodes.find((n) => n.id === "item:a")!;
    expect(item.data.emailDomainKinds).toEqual({ "kontakt@gmail.com": "free_mail", "info@inny.test": "other_domain" });
    expect(item.data.addressCompleteness).toBe("full");
  });
});
