/** Company identifiers read from a page: synthetic values only (checksums computed, names fictional, hosts .example/.test). */
import { describe, expect, it } from "vitest";
import { extractCompanyIds, ibanValid, nipValid, regonValid } from "./companyIds";

const kinds = (r: ReturnType<typeof extractCompanyIds>) => r.companyIds.map((c) => `${c.kind}:${c.value}:${c.valid}:${c.source}`);

describe("checksums", () => {
  it("validates NIP with weights 6,5,7,2,3,4,5,6,7 and mod 11 (remainder 10 is invalid)", () => {
    expect(nipValid("1234563218")).toBe(true);
    expect(nipValid("1234563219")).toBe(false);
    expect(nipValid("123456")).toBe(false);
    expect(nipValid("0000000000")).toBe(false);
  });
  it("validates REGON of 9 and 14 digits", () => {
    expect(regonValid("123456785")).toBe(true);
    expect(regonValid("123456786")).toBe(false);
    expect(regonValid("12345678500010")).toBe(true);
    expect(regonValid("12345678500011")).toBe(false);
    expect(regonValid("12345678")).toBe(false);
  });
  it("validates IBAN by mod 97 and by the length of the country", () => {
    expect(ibanValid("PL61109010140000071219812874")).toBe(true);
    expect(ibanValid("DE89370400440532013000")).toBe(true);
    expect(ibanValid("PL61109010140000071219812875")).toBe(false);
    expect(ibanValid("DE8937040044053201300")).toBe(false);
  });
});

describe("NIP", () => {
  it("reads a labelled NIP from a footer in every format and checks the sum", () => {
    for (const written of ["123-456-32-18", "123-45-63-218", "1234563218", "PL 123 456 32 18", "PL1234563218"]) {
      const r = extractCompanyIds({ text: `Sprzedawca: Fikcyjny Sklep Sp. z o.o., NIP: ${written}, ul. Testowa 1` });
      expect(kinds(r)).toEqual(["nip:1234563218:true:text"]);
      expect(r.companyIdInvalid).toBe(false);
    }
  });

  it("marks a NIP with a wrong checksum as invalid and raises companyIdInvalid", () => {
    const r = extractCompanyIds({ text: "NIP 123-456-32-19" });
    expect(kinds(r)).toEqual(["nip:1234563219:false:text"]);
    expect(r.companyIdInvalid).toBe(true);
    expect(r.companyIds[0].quote).toContain("NIP");
  });

  it("does not read ten bare digits without a label", () => {
    const r = extractCompanyIds({ text: "Zamówienie 1234563218, tel. 123 456 321, kod 5271234563" });
    expect(r.companyIds).toEqual([]);
    expect(r.companyIdInvalid).toBe(false);
  });
});

describe("REGON, KRS", () => {
  it("reads REGON of 9 and 14 digits with the label and checks the sum", () => {
    expect(kinds(extractCompanyIds({ text: "REGON: 123456785" }))).toEqual(["regon:123456785:true:text"]);
    expect(kinds(extractCompanyIds({ text: "REGON 123 456 785 00010" }))).toEqual(["regon:12345678500010:true:text"]);
    expect(kinds(extractCompanyIds({ text: "REGON 123456786" }))).toEqual(["regon:123456786:false:text"]);
  });
  it("reads KRS as the label and ten digits", () => {
    expect(kinds(extractCompanyIds({ text: "wpisana do KRS pod numerem 0000123456" }))).toEqual(["krs:0000123456:true:text"]);
    expect(kinds(extractCompanyIds({ text: "KRS: 123456" }))).toEqual([]);
  });
});

describe("IBAN and NRB", () => {
  it("reads a valid IBAN of any country, spaced or not", () => {
    expect(kinds(extractCompanyIds({ text: "Konto: PL61 1090 1014 0000 0712 1981 2874 Bank Testowy" }))).toEqual(["iban:PL61109010140000071219812874:true:text"]);
    expect(kinds(extractCompanyIds({ text: "IBAN DE89 3704 0044 0532 0130 00" }))).toEqual(["iban:DE89370400440532013000:true:text"]);
  });
  it("reads a Polish NRB of 26 digits next to the account label and writes it as an IBAN", () => {
    const r = extractCompanyIds({ text: "Numer rachunku: 61 1090 1014 0000 0712 1981 2874" });
    expect(kinds(r)).toEqual(["nrb:PL61109010140000071219812874:true:text"]);
  });
  it("marks a labelled account with a wrong checksum as invalid and ignores one without a label", () => {
    expect(kinds(extractCompanyIds({ text: "IBAN: PL61 1090 1014 0000 0712 1981 2875" }))).toEqual(["iban:PL61109010140000071219812875:false:text"]);
    expect(extractCompanyIds({ text: "kod PL61 1090 1014 0000 0712 1981 2875" }).companyIds).toEqual([]);
  });
  it("does not take 26 digits without an account label", () => {
    expect(extractCompanyIds({ text: "numer przesyłki 61109010140000071219812874" }).companyIds).toEqual([]);
  });
});

describe("EU VAT and UK company number", () => {
  it("reads a labelled EU VAT number by the format of the country", () => {
    expect(kinds(extractCompanyIds({ text: "USt-IdNr.: DE123456789" }))).toEqual(["vat:DE123456789:true:text"]);
    expect(kinds(extractCompanyIds({ text: "VAT ID: CZ12345678" }))).toEqual(["vat:CZ12345678:true:text"]);
    expect(kinds(extractCompanyIds({ text: "VAT number: DE12345" }))).toEqual(["vat:DE12345:false:text"]);
  });
  it("reads a Polish VAT number as a NIP and checks its sum", () => {
    expect(kinds(extractCompanyIds({ text: "VAT ID: PL1234563218" }))).toEqual(["nip:1234563218:true:text"]);
  });
  it("reads the company number of a UK company", () => {
    expect(kinds(extractCompanyIds({ text: "Registered in England and Wales, Company No. 01234567" }))).toEqual(["uk_company:01234567:true:text"]);
    expect(kinds(extractCompanyIds({ text: "Registration number: SC123456" }))).toEqual(["uk_company:SC123456:true:text"]);
  });
});

describe("legal entities", () => {
  it("reads the name with a legal form", () => {
    const r = extractCompanyIds({ text: "Operatorem sklepu jest Fikcyjny Sklep Sp. z o.o. z siedzibą w Testowie. Partner: Beispiel Handel GmbH oraz Example Trading Ltd." });
    expect(r.legalEntities).toEqual(["Fikcyjny Sklep Sp. z o.o.", "Beispiel Handel GmbH", "Example Trading Ltd"]);
  });
});

describe("sources", () => {
  it("reads JSON-LD fields vatID, taxID, leiCode and identifier with source jsonld", () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Organization",
      legalName: "Fikcyjny Sklep Sp. z o.o.",
      vatID: "PL1234563218",
      taxID: "DE123456789",
      leiCode: "5493001KJTIIGC8Y1R12",
      identifier: [{ "@type": "PropertyValue", propertyID: "KRS", value: "0000123456" }, { "@type": "PropertyValue", propertyID: "REGON", value: "123456785" }],
    })}</script></head><body></body></html>`;
    const r = extractCompanyIds({ html });
    expect(kinds(r).sort()).toEqual(["krs:0000123456:true:jsonld", "lei:5493001KJTIIGC8Y1R12:true:jsonld", "nip:1234563218:true:jsonld", "regon:123456785:true:jsonld", "vat:DE123456789:true:jsonld"]);
    expect(r.legalEntities).toEqual(["Fikcyjny Sklep Sp. z o.o."]);
  });

  it("reports a JSON-LD block that is not JSON instead of dropping it silently", () => {
    const r = extractCompanyIds({ html: `<script type="application/ld+json">{ vatID: </script>` });
    expect(r.companyIds).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/JSON-LD/);
  });

  it("reads identifiers from the markup that the visible text does not hold, and from OCR", () => {
    const r = extractCompanyIds({ text: "Sklep", html: `<div hidden>NIP: <b>123-456-32-18</b></div><!-- REGON 123456785 -->`, ocr: "KRS 0000654321" });
    expect(kinds(r).sort()).toEqual(["krs:0000654321:true:ocr", "nip:1234563218:true:html", "regon:123456785:true:html"]);
  });

  it("keeps one entry per identifier, the first source wins", () => {
    const r = extractCompanyIds({ text: "NIP 1234563218", html: "<p>NIP 1234563218</p>", ocr: "NIP 123-456-32-18" });
    expect(kinds(r)).toEqual(["nip:1234563218:true:text"]);
  });

  it("stays linear on pathological markup (no '>', unclosed comments and scripts)", () => {
    for (const html of ["<".repeat(500_000), "<!--".repeat(100_000), "<script>".repeat(60_000), '<a href="x '.repeat(50_000)]) {
      const t0 = performance.now();
      extractCompanyIds({ html });
      expect(performance.now() - t0).toBeLessThan(2000);
    }
  });
});
