import { describe, expect, it } from "vitest";
import { evaluateCompanyRegistry, lookupKrs, lookupVatWhitelist, parseKrsExtract, parseVatWhitelist } from "./companyRegistry";

/** Recorded, synthetic answer of the VAT white list (representatives included to check they are dropped). */
const VAT = {
  result: {
    subject: {
      name: "FIKCYJNA HURTOWNIA SPÓŁKA Z O.O.",
      nip: "0000000000",
      statusVat: "Czynny",
      workingAddress: "ul. Przykładowa 5, 00-001 Miasto",
      registrationLegalDate: "2026-09-01",
      removalDate: null,
      representatives: [{ firstName: "Jan", lastName: "Przykładowy" }],
    },
  },
};

/** Recorded, synthetic answer of the KRS extract. */
const KRS = {
  odpis: {
    naglowekA: { dataRejestracjiWKRS: "15.03.2012", numerKRS: "0000000001" },
    dane: {
      dzial1: { danePodmiotu: { nazwa: "ATRAPA TRADING SPÓŁKA AKCYJNA" }, siedzibaIAdres: { adres: { ulica: "ul. Testowa", nrDomu: "7", nrLokalu: "2", kodPocztowy: "11-111", miejscowosc: "Gdzieśtam" } } },
      dzial2: { reprezentacja: { sklad: [{ nazwisko: "Fikcyjnowski" }] } },
    },
  },
};

/** A fetch that answers with a recorded body. */
const ok = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

describe("companyRegistry parsers", () => {
  it("reads the VAT white list without persons", () => {
    const r = parseVatWhitelist(VAT, "0000000000", "t");
    expect(r).toMatchObject({ found: true, name: "FIKCYJNA HURTOWNIA SPÓŁKA Z O.O.", status: "Czynny", registeredAt: "2026-09-01", postalCode: "00-001", removedAt: null });
    expect(JSON.stringify(r)).not.toContain("Przykładowy");
  });
  it("reads the KRS extract without persons", () => {
    const r = parseKrsExtract(KRS, "0000000001");
    expect(r).toMatchObject({ found: true, name: "ATRAPA TRADING SPÓŁKA AKCYJNA", registeredAt: "2012-03-15", postalCode: "11-111", status: "registered" });
    expect(r.address).toBe("ul. Testowa 7/2, 11-111 Gdzieśtam");
    expect(JSON.stringify(r)).not.toContain("Fikcyjnowski");
  });
  it("answers not found for an empty subject", () => {
    expect(parseVatWhitelist({ result: { subject: null } }, "1").found).toBe(false);
    expect(parseKrsExtract({}, "1").found).toBe(false);
  });
});

describe("evaluateCompanyRegistry", () => {
  const vat = parseVatWhitelist(VAT, "0000000000");
  it("flags a different name, a foreign address, a young company and a company younger than the domain", () => {
    const a = evaluateCompanyRegistry([vat], {
      brandNames: ["Zupełnie Inny Sklep"],
      pageAddresses: [{ street: "ul. Inna", number: "9", postalCode: "99-999" }],
      firstSeen: "2026-10-01T00:00:00Z",
      domainCreated: "2026-05-01T00:00:00Z",
    });
    expect(a.flags).toEqual(["companyNameMismatch", "companyAddressMismatch", "companyRecent", "companyYoungerThanDomain"]);
  });
  it("is silent when name and address agree and the company is old", () => {
    const krs = parseKrsExtract(KRS, "0000000001");
    const a = evaluateCompanyRegistry([krs], {
      brandNames: ["Atrapa Trading S.A."],
      pageAddresses: [{ street: "ul. Testowa", number: "7", postalCode: "11-111" }],
      firstSeen: "2026-10-01T00:00:00Z",
      domainCreated: "2020-01-01T00:00:00Z",
    });
    expect(a.flags).toEqual([]);
  });
  it("flags a removed company and an old firm behind a new domain", () => {
    const krs = { ...parseKrsExtract(KRS, "0000000001"), removedAt: "2024-01-01", status: "wykreślony" };
    const a = evaluateCompanyRegistry([krs], { brandNames: [], pageAddresses: [], firstSeen: "2026-10-01T00:00:00Z", domainCreated: "2026-09-20T00:00:00Z" });
    expect(a.flags).toEqual(["companyRemoved", "domainYoungerThanCompany"]);
  });
  it("ignores records that were not found or failed", () => {
    const bad = { ...vat, error: "HTTP 500" };
    expect(evaluateCompanyRegistry([bad], { brandNames: ["x y"], pageAddresses: [], firstSeen: null, domainCreated: null }).flags).toEqual([]);
  });
});

describe("registry lookups (recorded responses, no network)", () => {
  it("fetches and parses both registers, a 404 is not found, a failure is an error", async () => {
    expect((await lookupVatWhitelist("0000000000", "2026-11-22", { fetchImpl: ok(VAT), cache: false })).name).toContain("HURTOWNIA");
    expect((await lookupKrs("0000000001", { fetchImpl: ok(KRS), cache: false })).registeredAt).toBe("2012-03-15");
    expect((await lookupKrs("0000000001", { fetchImpl: ok({}, 404), cache: false })).found).toBe(false);
    const failed = await lookupVatWhitelist("0000000000", "2026-11-22", { fetchImpl: ok({}, 500), cache: false });
    expect(failed.error).toBe("HTTP 500");
  });
});
