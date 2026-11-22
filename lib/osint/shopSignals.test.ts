import { describe, expect, it } from "vitest";
import { extractShopSignals, parsePrice } from "./shopSignals";

/** A synthetic shop page: `body` between a header with a menu and a footer. */
function page(body: string, opts: { footer?: string; menu?: string; head?: string } = {}): string {
  return `<html><head><title>Nowy Market – elektronika</title>${opts.head ?? ""}</head><body>
    <nav>${opts.menu ?? ""}</nav>${body}<footer>${opts.footer ?? ""}</footer></body></html>`;
}

const FULL_MENU = `<a href="/regulamin">Regulamin</a> <a href="/zwroty">Zwroty i reklamacje</a> <a href="/polityka-prywatnosci">Polityka prywatności</a> <a href="/kontakt">Kontakt</a>`;

function products(n: number, oldPrice: number, price: number): string {
  return Array.from({ length: n }, (_, i) => `<div class="product"><h3>Produkt ${i}</h3><del>${oldPrice} zł</del> <span class="price">${price} zł</span><button>Dodaj do koszyka</button></div>`).join("");
}

describe("extractShopSignals", () => {
  it("returns null for an article without prices or a cart", () => {
    const html = `<html><head><title>Jak rozpoznać oszustwo</title></head><body><article><p>Tekst poradnika o bezpieczeństwie w sieci.</p></article></body></html>`;
    expect(extractShopSignals({ html, url: "https://blog.example/post" })).toBeNull();
  });

  it("reads missing legal pages from menu and footer links", () => {
    const html = page(products(3, 100, 90), { menu: `<a href="/kontakt">Kontakt</a>` });
    const s = extractShopSignals({ html, url: "https://nowymarket.test/" });
    expect(s?.legalPages).toEqual({ terms: false, returns: false, privacy: false, contact: true });
    expect(s?.legalPagesMissing).toEqual(expect.arrayContaining(["terms", "returns", "privacy"]));
    expect(s?.legalPagesMissing).not.toContain("contact");
  });

  it("recognises legal pages by link path when the text is an icon", () => {
    const html = page(products(2, 100, 90), { footer: `<a href="/pages/terms-of-service">i</a><a href="/Refund-Policy">i</a><a href="/privacy">i</a><a href="/contact-us">i</a>` });
    expect(extractShopSignals({ html, url: "https://nowymarket.test/" })?.legalPagesMissing).toEqual([]);
  });

  it("flags a shop-wide deep discount and the missing 30-day price", () => {
    const s = extractShopSignals({ html: page(products(10, 500, 100), { menu: FULL_MENU }), url: "https://nowymarket.test/" });
    expect(s?.discounts).toMatchObject({ pricedItems: 10, discountedShare: 1, medianDiscountPct: 80, maxDiscountPct: 80 });
    expect(s?.sitewideDeepDiscount).toBe(true);
    expect(s?.omnibusMissing).toBe(true);
  });

  it("does not flag the 30-day price when the phrase is present", () => {
    const html = page(products(10, 500, 100) + `<p>Najniższa cena z 30 dni przed obniżką: 480 zł</p>`, { menu: FULL_MENU });
    const s = extractShopSignals({ html, url: "https://nowymarket.test/" });
    expect(s?.omnibusMissing).toBe(false);
  });

  it("does not call a few moderate discounts shop-wide", () => {
    const html = page(products(2, 100, 80) + Array.from({ length: 8 }, (_, i) => `<div><span class="price">${50 + i} zł</span></div>`).join(""), { menu: FULL_MENU });
    const s = extractShopSignals({ html, url: "https://nowymarket.test/" });
    expect(s?.sitewideDeepDiscount).toBe(false);
    expect(s?.discounts.discountedShare).toBeCloseTo(0.2);
  });

  it("detects a purchase pop-up, a stock claim and a closing story as techniques", () => {
    const html = page(
      products(3, 100, 90) + `<div class="toast">Anna z Radomia kupiła 5 min temu</div><p>Ostatnie 3 sztuki!</p><p>Rodzinny sklep się zamyka, wyprzedaż całego magazynu</p>`,
      { menu: FULL_MENU },
    );
    const s = extractShopSignals({ html, url: "https://nowymarket.test/" });
    expect(s?.techniques).toEqual(expect.arrayContaining(["recent_purchase_popup", "low_stock_claim", "closing_down_story"]));
  });

  it("detects a countdown element near an offer and a crypto discount", () => {
    const html = page(products(3, 100, 90) + `<div class="sale-countdown" id="timer">00:14:59</div><p>Dodatkowy rabat 10% przy płatności kryptowalutą</p>`, { menu: FULL_MENU });
    const s = extractShopSignals({ html, url: "https://nowymarket.test/" });
    expect(s?.techniques).toEqual(expect.arrayContaining(["countdown_timer", "crypto_discount"]));
  });

  it("flags a bank transfer as the only payment method", () => {
    const html = page(products(3, 100, 90) + `<p>Płatność: przelew bankowy</p>`, { menu: FULL_MENU });
    const s = extractShopSignals({ html, url: "https://nowymarket.test/" });
    expect(s?.paymentMethods).toEqual(["transfer"]);
    expect(s?.transferOnly).toBe(true);
    expect(s?.irreversibleOnly).toBe(false);
  });

  it("flags crypto, BLIK and gift cards as irreversible only", () => {
    const html = page(products(3, 100, 90) + `<p>Płacisz: BLIK, Bitcoin</p><img src="/img/paysafecard.png" alt="logo">`, { menu: FULL_MENU });
    const s = extractShopSignals({ html, url: "https://nowymarket.test/" });
    expect(s?.paymentMethods).toEqual(expect.arrayContaining(["blik", "crypto", "gift_card"]));
    expect(s?.irreversibleOnly).toBe(true);
  });

  it("reads payment methods from logo file names in the footer", () => {
    const html = page(products(3, 100, 90), { menu: FULL_MENU, footer: `<img src="/p/visa.svg"><img src="/p/przelewy24.png" alt=""><img src="/p/paypal-logo.png">` });
    expect(extractShopSignals({ html, url: "https://nowymarket.test/" })?.paymentMethods).toEqual(expect.arrayContaining(["card", "przelewy24", "paypal"]));
  });

  it("flags a private person as the recipient of the transfer", () => {
    const html = page(products(3, 100, 90) + `<p>Dane do przelewu: Odbiorca: Jan Kowalski, tytuł przelewu: prezent</p>`, { menu: FULL_MENU });
    expect(extractShopSignals({ html, url: "https://nowymarket.test/" })?.paymentRecipientPerson).toBe(true);
  });

  it("does not take a firm as the recipient", () => {
    const html = page(products(3, 100, 90) + `<p>Odbiorca: Nowy Market Sp. z o.o., tytuł: numer zamówienia</p>`, { menu: FULL_MENU });
    expect(extractShopSignals({ html, url: "https://nowymarket.test/" })?.paymentRecipientPerson).toBe(false);
  });

  it("reads a wide delivery time", () => {
    const html = page(products(3, 100, 90) + `<p>Czas realizacji zamówienia: 3-45 dni roboczych</p>`, { menu: FULL_MENU });
    const s = extractShopSignals({ html, url: "https://nowymarket.test/" });
    expect(s?.deliveryDays).toEqual({ min: 3, max: 45 });
    expect(s?.deliveryWide).toBe(true);
  });

  it("flags perfect and narrow-window reviews from JSON-LD", () => {
    const reviews = Array.from({ length: 30 }, (_, i) => ({
      "@type": "Review",
      author: { "@type": "Person", name: `Autor ${i}` },
      datePublished: `2026-11-${String(1 + (i % 10)).padStart(2, "0")}`,
      reviewRating: { "@type": "Rating", ratingValue: "5" },
    }));
    const ld = JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: "Produkt", review: reviews, aggregateRating: { "@type": "AggregateRating", ratingValue: "5", reviewCount: "30" } });
    const html = page(products(3, 100, 90), { menu: FULL_MENU, head: `<script type="application/ld+json">${ld}</script>` });
    const s = extractShopSignals({ html, url: "https://nowymarket.test/" });
    expect(s?.reviews).toMatchObject({ count: 30, share5: 1, source: "jsonld" });
    expect(s?.reviews?.windowDays).toBeLessThanOrEqual(10);
    expect(s?.reviewsAllPerfect).toBe(true);
    expect(s?.reviewsNarrowWindow).toBe(true);
  });

  it("flags a shop with products and no opinions at all", () => {
    const s = extractShopSignals({ html: page(products(3, 100, 90), { menu: FULL_MENU }), url: "https://nowymarket.test/" });
    expect(s?.reviews).toBeNull();
    expect(s?.reviewsNone).toBe(true);
  });

  it("flags another shop's name and an old year in the footer", () => {
    const html = page(products(3, 100, 90), { menu: FULL_MENU, footer: `<p>© 2019 Inny Sklep. Wszelkie prawa zastrzeżone.</p>` });
    const s = extractShopSignals({ html, url: "https://nowymarket.test/", firstSeen: "2026-11-01" });
    expect(s?.footerBrandMismatch).toEqual({ footer: "Inny Sklep", brand: "nowymarket" });
    expect(s?.footerYearStale).toBe(true);
  });

  it("accepts the shop's own name in the footer", () => {
    const html = page(products(3, 100, 90), { menu: FULL_MENU, footer: `<p>© 2026 Nowy Market Sp. z o.o.</p>` });
    const s = extractShopSignals({ html, url: "https://nowymarket.test/", firstSeen: "2026-11-01" });
    expect(s?.footerBrandMismatch).toBeNull();
    expect(s?.footerYearStale).toBe(false);
  });

  it("reads the claimed seniority and compares it with the archive", () => {
    const html = page(products(3, 100, 90) + `<p>Nowy Market, od 1998 roku z Wami.</p>`, { menu: FULL_MENU });
    const without = extractShopSignals({ html, url: "https://nowymarket.test/" });
    expect(without?.claimedSince).toMatchObject({ year: 1998 });
    expect(without?.claimedSinceContradicted).toBe(false);
    const withArchive = extractShopSignals({ html, url: "https://nowymarket.test/", archiveFirstSeen: "2026-09-01" });
    expect(withArchive?.claimedSinceContradicted).toBe(true);
  });

  it("reads years of experience against the first sighting", () => {
    const html = page(products(3, 100, 90) + `<p>20 lat na rynku</p>`, { menu: FULL_MENU });
    expect(extractShopSignals({ html, url: "https://nowymarket.test/", firstSeen: "2026-11-01" })?.claimedSince).toMatchObject({ year: 2006 });
  });

  it("raises no flag for an honest synthetic shop", () => {
    const items = ["120", "80", "45", "300", "60"].map((p, i) => `<div class="product"><h3>Towar ${i}</h3><span class="price">${p} zł</span></div>`).join("");
    const ld = JSON.stringify({
      "@type": "Product",
      review: [5, 5, 5, 4, 5, 4, 5, 3, 5, 5, 4, 1, 5, 5].map((r, i) => ({ "@type": "Review", author: { name: `Klient ${i}` }, datePublished: `2026-0${1 + (i % 9)}-15`, reviewRating: { ratingValue: r } })),
    });
    const html = page(items + `<p>Płatność: karta, BLIK, Przelewy24, przelew</p><p>Czas realizacji: 1-3 dni</p>` + `<p>Najniższa cena z 30 dni</p>`, {
      menu: FULL_MENU,
      head: `<script type="application/ld+json">${ld}</script>`,
      footer: `<p>© 2026 Nowy Market</p>`,
    });
    const s = extractShopSignals({ html, url: "https://nowymarket.test/", firstSeen: "2026-11-01" });
    expect(s).not.toBeNull();
    expect(s?.flags).toEqual([]);
  });
});

describe("parsePrice", () => {
  it("reads decimal and thousands marks", () => {
    expect(parsePrice("1 299,00 zł")).toBe(1299);
    expect(parsePrice("€ 49.90")).toBe(49.9);
    expect(parsePrice("1.299 PLN")).toBe(1299);
    expect(parsePrice("bez ceny")).toBeNull();
  });
});

describe("extractShopSignals: weak attributes", () => {
  const item = (name: string) => `<div class="product"><h3>${name}</h3><span class="price">100 zł</span><button>Dodaj do koszyka</button></div>`;

  it("flags a small catalogue of three unrelated categories", () => {
    const html = page(item("iPhone 15 Pro") + item("Klocki LEGO Technic") + item("Kurtka zimowa męska") + item("Wiertarka udarowa"), { menu: FULL_MENU });
    const s = extractShopSignals({ html, url: "https://nowymarket.test/" });
    expect(s?.catalogIncoherent).toBe(true);
    expect(s?.catalogCategories).toEqual(expect.arrayContaining(["elektronika", "zabawki", "odzież"]));
    expect(s?.flags).toContain("catalogIncoherent");
  });

  it("accepts a catalogue of one category, and flags products foreign to the shop's own name", () => {
    const one = page(item("iPhone 15") + item("Słuchawki bezprzewodowe") + item("Laptop 15 cali"), { menu: FULL_MENU });
    expect(extractShopSignals({ html: one, url: "https://nowymarket.test/" })?.catalogIncoherent).toBe(false);
    const yarn = page(item("iPhone 15") + item("Laptop 15 cali") + item("Dron z kamerą"), { menu: FULL_MENU }).replace("Nowy Market – elektronika", "Włóczki i robótki");
    expect(extractShopSignals({ html: yarn, url: "https://nowymarket.test/" })?.catalogIncoherent).toBe(true);
  });

  it("detects the waitlist, the trial subscription and the BLIK-by-messenger instruction", () => {
    const html = page(
      products(3, 100, 90) +
        `<p>Rabat dostępny po zapisie na listę oczekujących, wymagana dopłata 29 zł.</p><p>Okres próbny 7 dni, potem automatyczne odnowienie subskrypcji.</p><p>Przyślij kod BLIK przez Messenger.</p>`,
      { menu: FULL_MENU },
    );
    expect(extractShopSignals({ html, url: "https://nowymarket.test/" })?.techniques).toEqual(expect.arrayContaining(["waitlist_upsell", "trial_subscription", "blik_via_messenger"]));
  });

  it("does not take an ordinary page for those techniques", () => {
    const s = extractShopSignals({ html: page(products(3, 100, 90) + `<p>Płatność BLIK w koszyku. Subskrybuj newsletter.</p>`, { menu: FULL_MENU }), url: "https://nowymarket.test/" });
    expect(s?.techniques).not.toEqual(expect.arrayContaining(["trial_subscription"]));
    expect(s?.techniques).not.toContain("blik_via_messenger");
    expect(s?.techniques).not.toContain("waitlist_upsell");
  });

  it("flags 25 reviews of a widget without a single reply of the seller, and not when one answers", () => {
    const review = (n: number, reply: boolean) =>
      `<div class="review" data-rating="5"><span class="author">Klient ${n}</span><time datetime="2026-0${1 + (n % 9)}-10">x</time><p>Super</p>${reply ? '<div class="reply">Dziękujemy</div>' : ""}</div>`;
    const silent = page(products(3, 100, 90) + Array.from({ length: 25 }, (_, n) => review(n, false)).join(""), { menu: FULL_MENU });
    const s = extractShopSignals({ html: silent, url: "https://nowymarket.test/" });
    expect(s?.reviews).toMatchObject({ source: "html", count: 25, sellerReplies: 0 });
    expect(s?.reviewsNoSellerReply).toBe(true);
    const answered = page(products(3, 100, 90) + Array.from({ length: 25 }, (_, n) => review(n, n === 3)).join(""), { menu: FULL_MENU });
    expect(extractShopSignals({ html: answered, url: "https://nowymarket.test/" })?.reviewsNoSellerReply).toBe(false);
  });
});
