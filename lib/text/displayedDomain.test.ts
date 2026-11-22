import { describe, expect, it } from "vitest";
import { displayedDomainMismatch } from "./displayedDomain";

const none = { text: null, barDomains: [] as string[] };

describe("displayedDomainMismatch (bait domain in the ad)", () => {
  it("flags a link caption of a well-known portal over a page of another domain", () => {
    const r = displayedDomainMismatch({ ...none, ocr: "Sponsorowane\nONET.PL\nSzok! Znany prezenter zdradził sposób", landing: ["trasa.example", "losowa-strona.test"] });
    expect(r).toEqual({ displayed: "onet.pl", landing: "losowa-strona.test", source: "ocr", confidence: "high", displayedBrandDomain: true });
  });

  it("reads a domain written in the text of the ad and marks a domain that is not a known brand", () => {
    const r = displayedDomainMismatch({ ocr: null, text: "Więcej na www.sklep-przyklad.com już dziś", barDomains: [], landing: ["losowa-strona.test"] });
    expect(r).toMatchObject({ displayed: "sklep-przyklad.com", landing: "losowa-strona.test", source: "text", confidence: "medium" });
    expect(r).not.toHaveProperty("displayedBrandDomain");
  });

  it("returns null when the caption matches a domain of the redirect chain or of the address bar", () => {
    expect(displayedDomainMismatch({ ...none, ocr: "ONET.PL", landing: ["onet.pl"] })).toBeNull();
    expect(displayedDomainMismatch({ ...none, ocr: "wejdź: sklep-przyklad.com", landing: ["przekierowanie.test", "sklep-przyklad.com", "losowa-strona.test"] })).toBeNull();
    expect(displayedDomainMismatch({ ocr: "8 sklep-przyklad.com", text: null, barDomains: ["sklep-przyklad.com"], landing: ["losowa-strona.test"] })).toBeNull();
  });

  it("returns null when the creative shows no domain, only a platform's own or no landing page is known", () => {
    expect(displayedDomainMismatch({ ...none, ocr: "Sponsorowane\nZnany prezenter zdradził sposób\nWięcej…", landing: ["losowa-strona.test"] })).toBeNull();
    expect(displayedDomainMismatch({ ...none, ocr: "facebook.com\nSponsorowane", landing: ["losowa-strona.test"] })).toBeNull();
    expect(displayedDomainMismatch({ ...none, ocr: "ONET.PL", landing: [] })).toBeNull();
  });

  it("does not take an e-mail address or a full link in the text for a caption", () => {
    expect(displayedDomainMismatch({ ocr: null, text: "Pisz: biuro@onet.pl albo wejdź https://onet.pl/x", barDomains: [], landing: ["losowa-strona.test"] })).toBeNull();
  });
});
