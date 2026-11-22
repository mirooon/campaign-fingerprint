import { describe, expect, it } from "vitest";
import { addressKey, extractPostalAddresses } from "./postalAddress";

describe("extractPostalAddresses", () => {
  it("reads a full Polish address: street, number, postal code and city", () => {
    const r = extractPostalAddresses({ text: "Kontakt: Nowy Market, ul. Przykładowa 1, 00-001 Miasto. Tel. 000" });
    expect(r.completeness).toBe("full");
    expect(r.addresses[0]).toMatchObject({ street: "Przykładowa", number: "1", postalCode: "00-001", city: "Miasto" });
  });

  it("reads the postal code before the city and the street after it", () => {
    const r = extractPostalAddresses({ text: "Siedziba: 00-001 Miasto Przykładowe, ulica Testowa 12A/5" });
    expect(r.completeness).toBe("full");
    expect(r.addresses[0]).toMatchObject({ number: "12A", flat: "5", city: "Miasto Przykładowe" });
  });

  it("reads an address from the JSON-LD PostalAddress", () => {
    const ld = JSON.stringify({ "@type": "Store", address: { "@type": "PostalAddress", streetAddress: "ul. Przykładowa 1", postalCode: "00-001", addressLocality: "Miasto" } });
    const r = extractPostalAddresses({ text: "", jsonLd: [JSON.parse(ld)] });
    expect(r.completeness).toBe("full");
  });

  it("takes a lone city for a city-only address", () => {
    expect(extractPostalAddresses({ text: "Adres: Miasto" }).completeness).toBe("city_only");
  });

  it("takes a postal box for a po_box address", () => {
    expect(extractPostalAddresses({ text: "Adres: Skrytka pocztowa 123, 00-001 Miasto" }).completeness).toBe("po_box");
  });

  it("gives none for a text without an address", () => {
    expect(extractPostalAddresses({ text: "Dodaj do koszyka. Cena 100 zł." }).completeness).toBe("none");
  });

  it("does not take a price or a date for an address", () => {
    expect(extractPostalAddresses({ text: "Promocja do 12-11 00-001 sztuk" }).completeness).toBe("none");
  });
});

describe("addressKey", () => {
  const a = { street: "Przykładowa", number: "1", postalCode: "00-001", city: "Miasto" };

  it("is the same for spelling variants of the same address", () => {
    const [x] = extractPostalAddresses({ text: "ul. Przykładowa 1, 00-001 Miasto" }).addresses;
    const [y] = extractPostalAddresses({ text: "ulica PRZYKŁADOWA 1; 00001 Miasto" }).addresses;
    const [z] = extractPostalAddresses({ text: "Al. Przykładowa 1/7, 00-001 Miasto" }).addresses;
    expect(addressKey(x)).toBe(addressKey(y));
    expect(addressKey(x)).toBe(addressKey(z));
    expect(addressKey(a)).toBe(addressKey(x));
  });

  it("differs for another number or city", () => {
    expect(addressKey({ ...a, number: "2" })).not.toBe(addressKey(a));
    expect(addressKey({ ...a, city: "Inne" })).not.toBe(addressKey(a));
  });
});
