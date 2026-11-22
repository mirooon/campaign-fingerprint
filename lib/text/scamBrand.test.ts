/**
 * Brand of the scam itself (B-139): the product or "investment platform" name the operator gives (not the
 * brand it impersonates). Fictional brands only.
 */
import { describe, expect, it } from "vitest";
import { normalizeBrand, scamBrands } from "./scamBrand";

const keys = (text: string, landingName?: string) => scamBrands({ body: text, landingName }).map((b) => b.key);

describe("scam brand candidates", () => {
  it("reads a product with a descriptive suffix and a CamelCase platform name with its version", () => {
    expect(keys("Zamów Fikcyjnol Forte już dziś")).toContain("fikcyjnolforte");
    expect(keys("Platforma TradeSynthIQ 4.7 zarabia za ciebie")).toContain("tradesynthiq47");
    expect(normalizeBrand("TradeSynthIQ 4.7")).toBe(normalizeBrand("tradesynthiq47"));
  });

  it("reads a company name before a legal form and the platform's lander name", () => {
    expect(keys("Operatorem jest Zyskowo Invest S.A. z siedzibą")).toContain("zyskowoinvest");
    expect(keys("", "Fikcyjnol Forte PL")).toContain("fikcyjnolfortepl");
  });

  it("does not take a bank, a portal or a platform the scam impersonates for its own brand", () => {
    expect(keys("Bank PKO BP Plus i Onet Premium polecają")).toEqual([]);
  });

  it("drops an inflected name of an impersonated courier", () => {
    expect(keys("Twoja paczka InPostu czeka na dopłatę")).toEqual([]);
  });

  it("does not take a person's name for a brand", () => {
    expect(keys("Adam Testowy poleca platformę")).toEqual([]);
  });
});
