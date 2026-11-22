import { describe, expect, it } from "vitest";
import { extractFromHtml } from "../osint/extract";
import { renderShopSignals, shopFacts } from "./shopFacts";

const html = `<html><head><title>Nowy Market</title></head><body><nav><a href="/kontakt">Kontakt</a></nav>
  ${Array.from({ length: 6 }, () => `<div><del>500 zł</del> <span class="price">100 zł</span> <button>Dodaj do koszyka</button></div>`).join("")}
  <p>Płatność: przelew bankowy. Kontakt: kontakt@gmail.com, ul. Przykładowa 1, 00-001 Miasto</p><footer>© 2019 Inny Sklep</footer></body></html>`;

describe("shopFacts", () => {
  it("is null for a page that is not a shop", () => {
    expect(shopFacts(extractFromHtml("<html><body><p>Artykuł</p></body></html>", "https://blog.example/"), "2026-11-01")).toBeNull();
  });

  it("states each flag with its figure and the contact data", () => {
    const f = shopFacts(extractFromHtml(html, "https://nowymarket.test/"), "2026-11-01")!;
    expect(f.flags.map((x) => x.flag)).toEqual(expect.arrayContaining(["sitewideDeepDiscount", "omnibusMissing", "transferOnly", "footerBrandMismatch", "footerYearStale", "legalPagesMissing"]));
    expect(f.flags.find((x) => x.flag === "sitewideDeepDiscount")?.detail).toContain("80%");
    expect(f.email_domains).toEqual([{ domain: "gmail.com", kind: "free_mail" }]);
    expect(f.address.completeness).toBe("full");
  });

  it("renders a block per ad and the caveat that the flags do not link", () => {
    const f = shopFacts(extractFromHtml(html, "https://nowymarket.test/"), "2026-11-01");
    const md = renderShopSignals([{ item_id: "a", shop_signals: f }, { item_id: "b", shop_signals: null }]);
    expect(md).toContain("#### Sygnały sklepu");
    expect(md).toContain("**a**");
    expect(md).not.toContain("**b**");
    expect(md).toContain("nie łączą reklam");
    expect(renderShopSignals([{ item_id: "b" }])).toBe("");
  });
});
