/**
 * Company-register records (opt-in `--company-registry`) become the attribute `companyRegistry` of a material
 * with flags, and never a link. Synthetic data only.
 */
import { describe, expect, it } from "vitest";
import { buildEvidenceGraph } from "./link";
import { makeDataset } from "./testkit";

describe("companyRegistry attribute", () => {
  it("flags a registry name that differs from the page and a company removed from the register", () => {
    const ds = makeDataset([{ id: "a", url: "https://sklep-alfa.test/", pageText: "Sprzedawca: Fikcyjny Sklep Sp. z o.o., NIP 123-456-32-18" }]);
    ds.perItem.a.companyRegistry = [{ source: "vat", id: "1234563218", found: true, name: "ZUPEŁNIE INNA FIRMA SP. Z O.O.", address: null, postalCode: null, status: "Wykreślony", registeredAt: "2015-01-01", removedAt: null, fetchedAt: null, error: null }];
    const g = buildEvidenceGraph(ds, { textMethod: "none" });
    const data = g.nodes.find((n) => n.type === "item" && n.key === "a")!.data as { companyRegistry?: { flags: string[]; records: unknown[] } };
    expect(data.companyRegistry?.flags).toEqual(["companyNameMismatch", "companyRemoved"]);
    expect(data.companyRegistry?.records).toHaveLength(1);
  });

  it("adds nothing when the registers were not asked", () => {
    const ds = makeDataset([{ id: "a", url: "https://sklep-alfa.test/", pageText: "NIP 123-456-32-18" }]);
    const g = buildEvidenceGraph(ds, { textMethod: "none" });
    expect((g.nodes.find((n) => n.type === "item" && n.key === "a")!.data as Record<string, unknown>).companyRegistry).toBeUndefined();
  });
});
