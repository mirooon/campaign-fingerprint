import { describe, expect, it } from "vitest";
import { detectPageLanguage, domainLangMismatch, fakeCourierPayment, privacyControllerMismatch, tldRare } from "./siteAttributes";

describe("tldRare", () => {
  it("flags a TLD outside the list of typical shop TLDs", () => {
    expect(tldRare("promo-okazje.sbs")).toBe("sbs");
    expect(tldRare("sklep.top")).toBe("top");
  });
  it("accepts a typical TLD and a two-label public suffix", () => {
    expect(tldRare("sklep.pl")).toBeNull();
    expect(tldRare("www.shop.co.uk")).toBeNull();
    expect(tldRare("sklep.com")).toBeNull();
  });
});

describe("detectPageLanguage", () => {
  it("takes the lang attribute and otherwise the language with the most function words", () => {
    expect(detectPageLanguage('<html lang="pl-PL"><body>x</body></html>', "x")).toBe("pl");
    expect(detectPageLanguage("<html><body></body></html>", "Dziękujemy za zakupy oraz wybór, to jest nasza oferta dla Państwa, nie czekaj, tylko kup")).toBe("pl");
    expect(detectPageLanguage("<html></html>", "abc")).toBeNull();
  });
});

describe("domainLangMismatch", () => {
  it("flags words of another language in the domain name of a page in Polish", () => {
    expect(domainLangMismatch("gunstig-kaufen.test", "pl")).toEqual({ domainLang: "de", pageLang: "pl" });
  });
  it("accepts a domain in the language of the page, a neutral domain and an unknown page language", () => {
    expect(domainLangMismatch("tanie-zakupy.test", "pl")).toBeNull();
    expect(domainLangMismatch("xk7qpz.test", "pl")).toBeNull();
    expect(domainLangMismatch("gunstig-kaufen.test", null)).toBeNull();
  });
});

describe("privacyControllerMismatch", () => {
  const shop = "sklep.test";
  it("flags a data controller whose address is on another domain than every contact address of the page", () => {
    const text = "Administratorem danych jest Firma Przykład, kontakt w sprawie danych: rodo@inna.test. Kontakt ze sklepem: biuro@sklep.test";
    expect(privacyControllerMismatch(text, ["rodo@inna.test", "biuro@sklep.test"], shop)).toEqual({ controllerDomains: ["inna.test"] });
  });
  it("accepts a controller on the shop's domain or on the domain of a contact address", () => {
    const text = "Administratorem danych jest Firma Przykład, e-mail: rodo@sklep.test. Kontakt: biuro@sklep.test";
    expect(privacyControllerMismatch(text, ["rodo@sklep.test", "biuro@sklep.test"], shop)).toBeNull();
  });
  it("gives no verdict without a controller phrase or without other addresses to compare", () => {
    expect(privacyControllerMismatch("Kontakt: biuro@sklep.test", ["biuro@sklep.test"], shop)).toBeNull();
    expect(privacyControllerMismatch("Administratorem danych jest X, rodo@inna.test", ["rodo@inna.test"], shop)).toBeNull();
  });
});

describe("fakeCourierPayment", () => {
  const form = '<input name="card_number" autocomplete="cc-number"><select><option>Wybierz paczkomat</option></select>';
  it("flags a page that imitates a courier and asks for a card with a parcel locker choice", () => {
    expect(fakeCourierPayment(`<html><head><title>InPost - odbierz paczkę</title></head><body>${form}</body></html>`, "https://x7k2qp.test/pay")).toBe(true);
  });
  it("does not flag a card form without a courier, or a courier page without a card field", () => {
    expect(fakeCourierPayment(`<html><head><title>Sklep</title></head><body>${form}</body></html>`, "https://sklep.test/")).toBe(false);
    expect(fakeCourierPayment("<html><head><title>InPost</title></head><body>Wybierz paczkomat</body></html>", "https://x.test/")).toBe(false);
  });
});
