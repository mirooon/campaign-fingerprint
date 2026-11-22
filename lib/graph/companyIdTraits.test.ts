/**
 * Identifiers of a company on a page (NIP, REGON, KRS, VAT) and bank accounts as traces: they support a link
 * but never join a campaign alone (anyone can copy a firm's data; mule accounts are shared across groups).
 * Synthetic data only: computed checksums, fictional firms, .example/.test hosts.
 */
import { describe, expect, it } from "vitest";
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
const pair = (footerA: string, footerB: string, withOperator = false): TestItemSpec[] => [
  { id: "a", url: `https://sklep-alfa.test/${withOperator ? `?clickid=${xid("0a0b0c", 50001, 100)}` : ""}`, pageText: `Strona sklepu. ${footerA}` },
  { id: "b", url: `https://sklep-beta.example/${withOperator ? `?clickid=${xid("0a0b0c", 50001, 900)}` : ""}`, pageText: `Inny sklep. ${footerB}` },
];
const NIP = "Sprzedawca: Fikcyjny Sklep Sp. z o.o., NIP 123-456-32-18";
const IBAN = "Przelew na konto: PL61 1090 1014 0000 0712 1981 2874";

describe("company_id", () => {
  it("links two pages with the same NIP but does not merge them into a campaign on that alone", () => {
    const res = run(pair(NIP, NIP));
    const l = linkOf(res, "a", "b")!;
    expect(l.evidence.map((e) => e.pivotType)).toEqual(["company_id"]);
    expect(l.strong).toBe(false);
    expect(same(res, "a", "b")).toBe(false);
  });

  it("merges them with a second trace of the operator and names company_id among the premises", () => {
    const res = run(pair(NIP, NIP, true));
    expect(same(res, "a", "b")).toBe(true);
    expect(linkOf(res, "a", "b")!.evidence.map((e) => e.pivotType)).toContain("company_id");
  });

  it("keys the node by the normalised number, whatever the spelling", () => {
    const res = run(pair("NIP: 1234563218", "NIP PL 123 456 32 18"));
    expect(res.graph.nodes.filter((n) => n.type === "company_id").map((n) => n.key)).toEqual(["nip:1234563218"]);
  });

  it("does not link a number from the list of intermediaries (payment operators, couriers)", () => {
    const res = run(pair("NIP 779-230-84-95", "NIP 7792308495", true));
    expect(linkOf(res, "a", "b")?.evidence.map((e) => e.pivotType) ?? []).not.toContain("company_id");
  });

  it("still makes a pivot of a made-up NIP with a wrong checksum and marks the material", () => {
    const res = run(pair("NIP 123-456-32-19", "NIP 123-456-32-19", true));
    expect(same(res, "a", "b")).toBe(true);
    const item = res.graph.nodes.find((n) => n.id === "item:a")!;
    expect(item.data.companyIdInvalid).toBe(true);
    expect(item.data.companyIds).toMatchObject([{ kind: "nip", value: "1234563219", valid: false, source: "text" }]);
  });

  it("does not link anything on ten bare digits without a label", () => {
    const res = run(pair("Zamówienie 1234563218", "Zamówienie 1234563218"));
    expect(linkOf(res, "a", "b")).toBeUndefined();
  });

  it("keeps the legal entity and the checked identifiers as features of the material", () => {
    const res = run(pair(NIP, "Brak danych"));
    const item = res.graph.nodes.find((n) => n.id === "item:a")!;
    expect(item.data.legalEntities).toEqual(["Fikcyjny Sklep Sp. z o.o."]);
    expect(item.data.companyIds).toMatchObject([{ kind: "nip", valid: true }]);
    expect(item.data.companyIdInvalid).toBeUndefined();
  });

  it("reads the identifier from the OCR of a screenshot too", () => {
    const res = run([
      { id: "a", ocrText: "Regulamin sklepu NIP: 123-456-32-18" },
      { id: "b", ocrText: "Regulamin NIP 1234563218" },
    ]);
    expect(linkOf(res, "a", "b")!.evidence.map((e) => e.pivotType)).toEqual(["company_id"]);
    expect(res.graph.nodes.find((n) => n.id === "item:a")!.data.companyIds).toMatchObject([{ source: "ocr" }]);
  });
});

describe("bank_account", () => {
  it("links two pages with the same account, written with or without spaces, and merges them with a second trace", () => {
    const res = run(pair(IBAN, "IBAN: PL61109010140000071219812874", true));
    expect(res.graph.nodes.filter((n) => n.type === "bank_account").map((n) => n.key)).toEqual(["PL61109010140000071219812874"]);
    expect(same(res, "a", "b")).toBe(true);
    expect(linkOf(res, "a", "b")!.evidence.map((e) => e.pivotType)).toContain("bank_account");
  });

  it("does not merge two pages on the account alone", () => {
    const res = run(pair(IBAN, IBAN));
    const l = linkOf(res, "a", "b")!;
    expect(l.evidence.map((e) => e.pivotType)).toEqual(["bank_account"]);
    expect(same(res, "a", "b")).toBe(false);
  });

  it("weighs an account above a company number", () => {
    const acc = run(pair(IBAN, IBAN));
    const nip = run(pair(NIP, NIP));
    expect(linkOf(acc, "a", "b")!.score).toBeGreaterThan(linkOf(nip, "a", "b")!.score);
  });
});

describe("bank_account validity and foreign accounts (B-168)", () => {
  it("links two pages with the same valid foreign IBAN", () => {
    const res = run(pair("IBAN: DE89 3704 0044 0532 0130 00", "Konto DE89370400440532013000"));
    expect(res.graph.nodes.filter((n) => n.type === "bank_account").map((n) => n.key)).toEqual(["DE89370400440532013000"]);
    expect(linkOf(res, "a", "b")!.evidence.map((e) => e.pivotType)).toEqual(["bank_account"]);
  });

  it("makes no node and no link of an IBAN with a wrong checksum", () => {
    const res = run(pair("Przelew na konto: PL61 1090 1014 0000 0712 1981 2875", "IBAN: PL61109010140000071219812875"));
    expect(res.graph.nodes.some((n) => n.type === "bank_account")).toBe(false);
    expect(linkOf(res, "a", "b")?.evidence.some((e) => e.pivotType === "bank_account") ?? false).toBe(false);
  });
});
