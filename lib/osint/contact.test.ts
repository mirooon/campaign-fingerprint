import { describe, expect, it } from "vitest";
import { classifyEmailDomain, extractContactSignals, phoneAreaMismatch } from "./contact";

describe("classifyEmailDomain", () => {
  it("marks a free mailbox", () => {
    expect(classifyEmailDomain("kontakt@gmail.com", "sklep.test")).toBe("free_mail");
    expect(classifyEmailDomain("a@wp.pl", "sklep.test")).toBe("free_mail");
  });
  it("marks the shop's own domain and its subdomains", () => {
    expect(classifyEmailDomain("biuro@sklep.test", "www.sklep.test")).toBe("site");
    expect(classifyEmailDomain("biuro@mail.sklep.test", "sklep.test")).toBe("site");
  });
  it("marks another domain", () => {
    expect(classifyEmailDomain("info@inny.test", "sklep.test")).toBe("other_domain");
  });
});

describe("extractContactSignals", () => {
  const html = `<html><body><footer>Kontakt: info@inny.test, kontakt@gmail.com, biuro@sklep.test<br>ul. Przykładowa 1, 00-001 Miasto</footer></body></html>`;
  it("classifies each address and lists the other domains", () => {
    const c = extractContactSignals({ html, text: "Kontakt: info@inny.test, kontakt@gmail.com, biuro@sklep.test ul. Przykładowa 1, 00-001 Miasto", url: "https://sklep.test/", emails: ["info@inny.test", "kontakt@gmail.com", "biuro@sklep.test"], phones: [] });
    expect(c.emailDomains.map((e) => e.kind)).toEqual(["other_domain", "free_mail", "site"]);
    expect(c.otherEmailDomains).toEqual(["inny.test"]);
    expect(c.address.completeness).toBe("full");
  });
});

describe("phoneAreaMismatch", () => {
  it("flags a landline area code that belongs to another known city", () => {
    expect(phoneAreaMismatch("+48122345678", "Poznań")).toEqual({ area: "12", city: "Poznań" });
  });
  it("accepts a matching city and ignores mobiles and unknown cities", () => {
    expect(phoneAreaMismatch("+48612345678", "Poznań")).toBeNull();
    expect(phoneAreaMismatch("+48501234567", "Poznań")).toBeNull();
    expect(phoneAreaMismatch("+48122345678", "Nieznane")).toBeNull();
  });
});
