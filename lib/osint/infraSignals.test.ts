import { describe, expect, it } from "vitest";
import { brandInPath, detectCms, hostingOutsideEu } from "./infraSignals";

describe("brandInPath", () => {
  it("names a brand that stands in the path of a domain that does not carry it", () => {
    expect(brandInPath("https://x7k2qp.test/inpost/paczka/123")).toBe("inpost");
    expect(brandInPath("https://szybka-wysylka.test/OLX/odbior")).toBe("olx");
  });
  it("ignores a brand that the domain itself carries and brands only in a query or a longer word", () => {
    expect(brandInPath("https://inpost-paczki.test/inpost/status")).toBeNull();
    expect(brandInPath("https://sklep.test/?ref=inpost")).toBeNull();
    expect(brandInPath("https://sklep.test/dpdk-sklep/produkt")).toBeNull();
  });
});

describe("detectCms", () => {
  it("reads the generator tag and the paths of the page's files", () => {
    expect(detectCms({ generator: "WordPress 6.5; WooCommerce 8.0", html: "" })).toEqual(["wordpress", "woocommerce"]);
    expect(detectCms({ generator: null, html: '<script src="https://cdn.shopify.com/s/files/x.js"></script>' })).toEqual(["shopify"]);
    expect(detectCms({ generator: null, html: '<link href="/wp-content/themes/a/style.css">' })).toEqual(["wordpress"]);
    expect(detectCms({ generator: "PrestaShop", html: "" })).toEqual(["prestashop"]);
  });
  it("gives nothing for a page without a platform trace", () => {
    expect(detectCms({ generator: null, html: "<html><body>Strona</body></html>" })).toEqual([]);
  });
});

describe("hostingOutsideEu", () => {
  it("gives the country when no address of the host is in the EU or EEA", () => {
    expect(hostingOutsideEu(["US"])).toBe("US");
    expect(hostingOutsideEu(["US", "CN"])).toBe("US");
  });
  it("gives nothing when one address is inside, or no country is known", () => {
    expect(hostingOutsideEu(["US", "DE"])).toBeNull();
    expect(hostingOutsideEu(["NO"])).toBeNull();
    expect(hostingOutsideEu([null])).toBeNull();
    expect(hostingOutsideEu([])).toBeNull();
  });
});
