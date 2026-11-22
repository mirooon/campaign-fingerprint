import { describe, expect, it } from "vitest";
import { decodeHtmlEntities, extractFromHtml, extractFromText, findEmails, findPolishPhones, findTelegram, findTrackers, findWhatsapp, normalizePhone, verificationTokens } from "./extract";

// Synthetic landing page: fictional person, reserved domains only.
const LANDING_HTML = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<base href="https://zysk-krypto.example/sub/">
<title>  Inwestuj z Adamem Testowym &ndash; Zysk&nbsp;Krypto  </title>
<meta name="description" content="Fikcyjna platforma inwestycyjna. Zadzwo&#324;: +48 501 234 567">
<meta property="og:title" content="Adam Testowy zdradza sekret">
<meta content="/img/og.png" property='og:image'>
<meta property="og:site_name" content=Zysk-Krypto>
<meta name="generator" content="WordPress 6.4">
<meta http-equiv="refresh" content="5; URL='https://lp.zysk-krypto.test/start'">
<link rel="canonical" href="/oferta">
<link rel="apple-touch-icon" href="/apple.png">
<link rel="shortcut icon" href="/static/fav.ico">
<link rel="stylesheet" href="https://cdn.example.com/style.css">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-ABC1234567');
  gtag('config', 'UA-12345678-1');
  gtag('config', 'AW-123456789');
</script>
<script>(function(w,d,s,l,i){w[l]=w[l]||[];})(window,document,'script','dataLayer','GTM-AB12CD3');</script>
<script>
!function(f,b,e,v,n,t,s){}(window, document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '1234567890123456');
fbq('track', 'PageView');
</script>
<script>
!function (w, d, t) { w.TiktokAnalyticsObject=t; ttq.load('C4ABCDEFGH1234567890'); ttq.page(); }(window, document, 'ttq');
</script>
<script type="text/javascript">
   (function(m,e,t,r,i,k,a){})(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
   ym(98765432, "init", { clickmap:true });
</script>
</head>
<body>
<!-- stary tracker: UA-99999999-2 -->
<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=1234567890123456&amp;ev=PageView&amp;noscript=1"/></noscript>
<h1>Adam Testowy: &bdquo;Zarobi&lstrok;em 10 000 z&lstrok; w tydzie&nacute;!&rdquo;</h1>
<p>Kontakt: <a href="mailto:kontakt@zysk-krypto.example?subject=Pytanie">napisz</a>, tel. <a href="tel:+48501234567">501 234 567</a></p>
<p>Biuro: (22) 123 45 67, e-mail BOK@Zysk-Krypto.example</p>
<p>Telegram: <a href="https://t.me/zysk_krypto_pl">kanał</a>, WhatsApp: <a href="https://wa.me/48600111222">czat</a></p>
<p>Wpłaty BTC: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa</p>
<p>USDT TRC20: <span data-clipboard-text="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t">kopiuj</span></p>
<img src="/img/logo@2x.png" alt="logo">
<a href="https://partner-news.test/artykul?utm_source=fb&amp;id=7">Czytaj</a>
<a href="https://www.partner-news.test/inny">Inny</a>
<a href="/regulamin">Regulamin</a>
<a href="https://zysk-krypto.example/kontakt">Kontakt</a>
<form action="https://collect.leads.test/submit" method="post"><input name="phone"></form>
<script>setTimeout(function(){ window.location.href = "https://lp.zysk-krypto.test/go?src=fb"; }, 3000);</script>
<script>var city = "Warszawa"; var location2 = 1; var location = "Warszawa";</script>
<button onclick="location.replace('/promo')">Dołącz</button>
</body></html>`;

describe("extractFromHtml (realistic landing page)", () => {
  const page = extractFromHtml(LANDING_HTML, "https://zysk-krypto.example/landing?fbclid=abc");

  it("extracts title, description, Open Graph and generator", () => {
    expect(page.title).toBe("Inwestuj z Adamem Testowym – Zysk Krypto");
    expect(page.description).toBe("Fikcyjna platforma inwestycyjna. Zadzwoń: +48 501 234 567");
    expect(page.ogTitle).toBe("Adam Testowy zdradza sekret");
    expect(page.ogImage).toBe("https://zysk-krypto.example/img/og.png");
    expect(page.ogSiteName).toBe("Zysk-Krypto");
    expect(page.ogDescription).toBeNull();
    expect(page.generator).toBe("WordPress 6.4");
  });

  it("resolves canonical and favicon against <base href>, preferring rel=icon over apple-touch-icon", () => {
    expect(page.canonical).toBe("https://zysk-krypto.example/oferta");
    expect(page.faviconUrl).toBe("https://zysk-krypto.example/static/fav.ico");
  });

  it("finds all tracker IDs, including one in an HTML comment", () => {
    expect(page.trackers).toEqual([
      { kind: "ga4", id: "G-ABC1234567" },
      { kind: "google_ads", id: "AW-123456789" },
      { kind: "gtm", id: "GTM-AB12CD3" },
      { kind: "meta_pixel", id: "1234567890123456" },
      { kind: "tiktok_pixel", id: "C4ABCDEFGH1234567890" },
      { kind: "ua", id: "UA-12345678-1" },
      { kind: "ua", id: "UA-99999999-2" },
      { kind: "yandex_metrica", id: "98765432" },
    ]);
  });

  it("lists outbound URLs (normalised, own site excluded) and their registrable domains", () => {
    expect(page.outboundDomains).toEqual([
      "example.com",
      "facebook.com",
      "googletagmanager.com",
      "leads.test",
      "partner-news.test",
      "t.me",
      "wa.me",
    ]);
    expect(page.outboundUrls).toContain("https://partner-news.test/artykul?id=7");
    expect(page.outboundUrls).toContain("https://www.partner-news.test/inny");
    expect(page.outboundUrls).toContain("https://collect.leads.test/submit");
    expect(page.outboundUrls.some((u) => u.includes("zysk-krypto.example"))).toBe(false);
  });

  it("extracts contact pivots from visible text and attributes", () => {
    expect(page.emails).toEqual(["bok@zysk-krypto.example", "kontakt@zysk-krypto.example"]);
    expect(page.phones).toEqual(["+48501234567", "+48221234567"]);
    expect(page.telegram).toEqual(["t.me/zysk_krypto_pl"]);
    expect(page.whatsapp).toEqual(["+48600111222"]);
    expect(page.wallets).toEqual([
      { kind: "btc", address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" },
      { kind: "tron", address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
    ]);
  });

  it("records meta refresh and JS redirect targets without executing anything", () => {
    expect(page.metaRefresh).toBe("https://lp.zysk-krypto.test/start");
    expect(page.jsRedirects).toEqual(["https://lp.zysk-krypto.test/go?src=fb", "https://zysk-krypto.example/promo"]);
  });

  it("builds visible text without scripts, comments or tags", () => {
    expect(page.visibleText).toContain("Adam Testowy: „Zarobiłem 10 000 zł w tydzień!”");
    expect(page.visibleText).not.toContain("gtag");
    expect(page.visibleText).not.toContain("fbq");
    expect(page.visibleText).not.toContain("stary tracker");
    expect(page.visibleText).not.toMatch(/<|>/);
  });
});

describe("extractFromHtml edge cases", () => {
  it("returns an empty extract for empty input", () => {
    const e = extractFromHtml("");
    expect(e.title).toBeNull();
    expect(e.faviconUrl).toBeNull();
    expect(e.trackers).toEqual([]);
    expect(e.visibleText).toBe("");
  });

  it("falls back to /favicon.ico at the origin when no icon link exists", () => {
    const e = extractFromHtml("<html><head><title>X</title></head><body>hi</body></html>", "https://a.example/p/page.html");
    expect(e.faviconUrl).toBe("https://a.example/favicon.ico");
    expect(e.title).toBe("X");
  });

  it("handles any attribute order and unquoted values", () => {
    const e = extractFromHtml(
      `<meta content=Opis name=description><link href='/i.png' rel=icon><link href="https://b.example/c" rel="canonical">`,
      "https://b.example/",
    );
    expect(e.description).toBe("Opis");
    expect(e.faviconUrl).toBe("https://b.example/i.png");
    expect(e.canonical).toBe("https://b.example/c");
  });

  it("resolves relative meta refresh targets and ignores refresh without URL", () => {
    expect(extractFromHtml(`<meta http-equiv="Refresh" content="0;url=/next">`, "https://c.example/a/b").metaRefresh).toBe(
      "https://c.example/next",
    );
    expect(extractFromHtml(`<meta http-equiv="refresh" content="10">`, "https://c.example/").metaRefresh).toBeNull();
  });

  it("does not treat non-URL string assignments as redirects", () => {
    const e = extractFromHtml(`<script>var location = "Warszawa"; location.href = 'https://d.test/x';</script>`, "https://c.example/");
    expect(e.jsRedirects).toEqual(["https://d.test/x"]);
  });

  it("never throws on malformed HTML", () => {
    const broken = `<a href="https://x.test/a <b>unclosed <title>T <meta name= <<<>>> <script>var a = "<a href='https://y.test'>"`;
    expect(() => extractFromHtml(broken, "https://z.example/")).not.toThrow();
    expect(() => extractFromHtml("<<<<!--", undefined)).not.toThrow();
    expect(() => extractFromHtml(`<meta content="x`, "https://z.example/")).not.toThrow();
  });

  it("stays linear on pathological input (no '>', unclosed comments/scripts, unclosed quotes)", () => {
    const inputs = ["<".repeat(500_000), "<!--".repeat(100_000), "<script>".repeat(60_000), '<a href="x '.repeat(50_000)];
    for (const input of inputs) {
      const t0 = performance.now();
      extractFromHtml(input, "https://z.example/");
      expect(performance.now() - t0).toBeLessThan(2000);
    }
  });

  it("finds contacts beyond the 5000-char visibleText cap and redirects in javascript: hrefs", () => {
    const filler = "<p>" + "lorem ipsum dolor sit amet ".repeat(400) + "</p>";
    const e = extractFromHtml(
      `${filler}<p>Kontakt: biuro@daleko.example, 501 234 567</p><a href="javascript:location.href='/dalej'">x</a>`,
      "https://z.example/",
    );
    expect(e.visibleText.length).toBe(5000);
    expect(e.emails).toEqual(["biuro@daleko.example"]);
    expect(e.phones).toEqual(["+48501234567"]);
    expect(e.jsRedirects).toEqual(["https://z.example/dalej"]);
  });

  it("does not parse tags inside script bodies as outbound links", () => {
    const e = extractFromHtml(`<script>document.write('<a href="https://inside.test/">x</a>')</script>`, "https://z.example/");
    expect(e.outboundDomains).toEqual([]);
  });
});

describe("findTrackers", () => {
  it("accepts GA4 in context with short ids and canonicalises case", () => {
    expect(findTrackers(`gtag('config', 'g-abc123')`)).toEqual([{ kind: "ga4", id: "G-ABC123" }]);
    expect(findTrackers(`https://www.googletagmanager.com/gtag/js?l=dataLayer&id=G-XYZ987`)).toEqual([
      { kind: "ga4", id: "G-XYZ987" },
    ]);
  });

  it("accepts bare GA4 ids only with exactly 10 chars containing a digit and a letter", () => {
    expect(findTrackers("id: G-ABC1234567")).toEqual([{ kind: "ga4", id: "G-ABC1234567" }]);
    expect(findTrackers("G-ABCDEFGHIJ")).toEqual([]); // no digit
    expect(findTrackers("G-1234567890")).toEqual([]); // no letter
    expect(findTrackers("G-ABC123")).toEqual([]); // too short without context
    expect(findTrackers("G-ABC1234567X")).toEqual([]); // too long
    expect(findTrackers("myG-ABC1234567")).toEqual([]); // inside a longer token
  });

  it("finds UA, GTM and Google Ads ids conservatively", () => {
    expect(findTrackers("UA-1234567-12 and GTM-K9ZQ2P and AW-1234567890")).toEqual([
      { kind: "google_ads", id: "AW-1234567890" },
      { kind: "gtm", id: "GTM-K9ZQ2P" },
      { kind: "ua", id: "UA-1234567-12" },
    ]);
    expect(findTrackers("UA-123-1")).toEqual([]);
    expect(findTrackers("GTM-XXXXXXX G-XXXXXXXXXX")).toEqual([]); // template placeholders
    expect(findTrackers("AW-12345")).toEqual([]);
  });

  it("finds Meta, TikTok and Yandex ids in their usual snippets", () => {
    expect(findTrackers(`<img src="https://www.facebook.com/tr?ev=PageView&amp;id=1234567890123456">`)).toEqual([
      { kind: "meta_pixel", id: "1234567890123456" },
    ]);
    expect(findTrackers(`fbq("init", "98765432109876")`)).toEqual([{ kind: "meta_pixel", id: "98765432109876" }]);
    expect(findTrackers(`fbq('init', '123')`)).toEqual([]);
    expect(
      findTrackers(`https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=c9abcdefgh1234567890&lib=ttq`),
    ).toEqual([{ kind: "tiktok_pixel", id: "C9ABCDEFGH1234567890" }]);
    expect(findTrackers(`ttq.load('short')`)).toEqual([]);
    expect(findTrackers(`mc.yandex.ru/watch/12345678`)).toEqual([{ kind: "yandex_metrica", id: "12345678" }]);
    expect(findTrackers(`new Ya.Metrika2({id: 55555555, clickmap: true})`)).toEqual([
      { kind: "yandex_metrica", id: "55555555" },
    ]);
    expect(findTrackers(`ym(12345, 'init', {})`)).toEqual([{ kind: "yandex_metrica", id: "12345" }]);
    expect(findTrackers(`ym(1234, 'init', {})`)).toEqual([]);
  });

  it("dedupes repeated ids", () => {
    expect(findTrackers("GTM-AB12CD3 GTM-AB12CD3")).toEqual([{ kind: "gtm", id: "GTM-AB12CD3" }]);
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes basic, numeric and Polish named entities", () => {
    expect(decodeHtmlEntities("&amp;&lt;&gt;&quot;&apos;")).toBe(`&<>"'`);
    expect(decodeHtmlEntities("&#322;&#x142;&#X141;")).toBe("łłŁ");
    expect(decodeHtmlEntities("Zarobi&lstrok;em &oacute;smy &Sacute;wiat &zdot;&Zdot; &aogon;&eogon;&cacute;&nacute;&zacute;")).toBe(
      "Zarobiłem ósmy Świat żŻ ąęćńź",
    );
    expect(decodeHtmlEntities("a&nbsp;b")).toBe("a b");
  });

  it("leaves unknown entities and replaces invalid code points", () => {
    expect(decodeHtmlEntities("&unknownentity;")).toBe("&unknownentity;");
    expect(decodeHtmlEntities("&#0;&#xD800;")).toBe("��");
    expect(decodeHtmlEntities("plain text")).toBe("plain text");
  });
});

describe("findEmails", () => {
  it("finds, lower-cases and dedupes addresses", () => {
    expect(findEmails("Napisz: jan.kowalski@firma.example lub JAN.KOWALSKI@FIRMA.EXAMPLE, a@b.co")).toEqual([
      "jan.kowalski@firma.example",
      "a@b.co",
    ]);
  });

  it("handles mailto: (including %40) and a trailing period", () => {
    expect(findEmails("mailto:biuro%40firma.example")).toEqual(["biuro@firma.example"]);
    expect(findEmails("Kontakt: kontakt@firma.example.")).toEqual(["kontakt@firma.example"]);
  });

  it("rejects file names, hosts without a TLD and TLDs with digits", () => {
    expect(findEmails("logo@2x.png icon@3x.webp style@1.css app@2x.js")).toEqual([]);
    expect(findEmails("user@localhost user@host.c0m")).toEqual([]);
    expect(findEmails("x..y@firma.example")).toEqual([]);
  });
});

describe("normalizePhone", () => {
  it("normalises Polish numbers to E.164", () => {
    expect(normalizePhone("501 234 567")).toBe("+48501234567");
    expect(normalizePhone("+48 501-234-567")).toBe("+48501234567");
    expect(normalizePhone("0048501234567")).toBe("+48501234567");
    expect(normalizePhone("48501234567")).toBe("+48501234567");
    expect(normalizePhone("0 22 123 45 67")).toBe("+48221234567");
  });

  it("keeps other international numbers and rejects junk", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("+48 50123456")).toBeNull(); // 8 national digits
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("findPolishPhones", () => {
  it("accepts +48 / 0048 / (+48) prefixed numbers in common groupings", () => {
    const text =
      "+48 501 234 567; +48601234567; 0048 502-234-567; (+48) 503.234.567; +48 (22) 123 45 67; +48 12 345 67 88";
    expect(findPolishPhones(text)).toEqual([
      "+48501234567",
      "+48601234567",
      "+48502234567",
      "+48503234567",
      "+48221234567",
      "+48123456788",
    ]);
  });

  it("accepts unprefixed 3-3-3 mobile and 2-3-2-2 landline numbers with valid prefixes", () => {
    expect(findPolishPhones("Zadzwoń: 501 234 567 albo 602-345-678")).toEqual(["+48501234567", "+48602345678"]);
    expect(findPolishPhones("Biuro (22) 123 45 67, oddział 61 234 56 78")).toEqual(["+48221234567", "+48612345678"]);
  });

  it("parses tel: links, including foreign numbers", () => {
    expect(findPolishPhones("tel:+48501234567 tel:+44 20 7946 0958")).toEqual(["+48501234567", "+442079460958"]);
  });

  it("rejects bare digit runs, prices, IDs, IBANs and invalid prefixes", () => {
    expect(findPolishPhones("ID 501234567, nr 123456789")).toEqual([]);
    expect(findPolishPhones("Zarobisz 1 000 000 zł albo 100 000 000")).toEqual([]);
    expect(findPolishPhones("Tylko 500 000 000 zł")).toEqual([]);
    expect(findPolishPhones("cena 501 234 567 zł")).toEqual([]);
    expect(findPolishPhones("1 501 234 567")).toEqual([]);
    expect(findPolishPhones("501 234 5678")).toEqual([]);
    expect(findPolishPhones("+48 501 234 5678")).toEqual([]);
    expect(findPolishPhones("PL61 1090 1014 0000 0712 1981 2874")).toEqual([]);
    expect(findPolishPhones("201 234 567")).toEqual([]); // 20 is neither a mobile prefix nor an area code
    expect(findPolishPhones("501 234-567")).toEqual([]); // mixed separators
  });
});

describe("findTelegram", () => {
  it("canonicalises usernames from t.me, telegram.me, telegram.dog, t.me/s/ and tg://", () => {
    expect(
      findTelegram(
        "https://t.me/Zysk_Krypto_PL t.me/s/kanal_inwestycje telegram.me/someuser1 telegram.dog/otheruser tg://resolve?domain=zysk_bot https://t.me/channel_name/123",
      ),
    ).toEqual([
      "t.me/zysk_krypto_pl",
      "t.me/kanal_inwestycje",
      "t.me/someuser1",
      "t.me/otheruser",
      "t.me/zysk_bot",
      "t.me/channel_name",
    ]);
  });

  it("keeps invite links with their case", () => {
    expect(findTelegram("https://t.me/+AbCdEf12345 i https://t.me/joinchat/XyZ_98765abc")).toEqual([
      "t.me/+AbCdEf12345",
      "t.me/joinchat/XyZ_98765abc",
    ]);
  });

  it("accepts @username only near the word Telegram/tg", () => {
    expect(findTelegram("Napisz na Telegramie: @zysk_admin.")).toEqual(["t.me/zysk_admin"]);
    expect(findTelegram("tg @inwestor_pl")).toEqual(["t.me/inwestor_pl"]);
    expect(findTelegram("Instagram: @someuser")).toEqual([]);
    expect(findTelegram("Telegram: admin@mailbox.example")).toEqual([]);
  });

  it("rejects reserved paths, short or invalid usernames and look-alike hosts", () => {
    expect(findTelegram("t.me/share/url?url=x t.me/abc t.me/1user notat.me/username t.me/joinchat")).toEqual([]);
  });
});

describe("findWhatsapp", () => {
  it("extracts numbers from wa.me and send?phone= links and group invites", () => {
    expect(
      findWhatsapp(
        "https://wa.me/48600111222 https://api.whatsapp.com/send?phone=48600111333&text=Hej whatsapp://send?text=hi&phone=%2B447700900123 https://chat.whatsapp.com/AbCdEfGhIjKlMn",
      ),
    ).toEqual(["+48600111222", "+48600111333", "+447700900123", "chat.whatsapp.com/AbCdEfGhIjKlMn"]);
  });

  it("rejects too-short numbers and look-alike hosts", () => {
    expect(findWhatsapp("wa.me/123 xwa.me/48600111222")).toEqual([]);
  });
});

describe("extractFromText (ad copy)", () => {
  it("pulls URLs (refanged, tracking stripped) and contact pivots from an ad", () => {
    const ad =
      "Adam Testowy poleca! Sprawdź hxxps://zysk-krypto[.]example/promo?fbclid=123 lub www.zysk-krypto.example. " +
      "Zadzwoń +48 501 234 567, pisz kontakt@zysk-krypto.example, Telegram @zysk_admin, " +
      "WhatsApp wa.me/48600111222, BTC 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
    const e = extractFromText(ad);
    expect(e.urls).toEqual(["https://zysk-krypto.example/promo", "https://www.zysk-krypto.example/"]);
    expect(e.emails).toEqual(["kontakt@zysk-krypto.example"]);
    expect(e.phones).toEqual(["+48501234567"]);
    expect(e.telegram).toEqual(["t.me/zysk_admin"]);
    expect(e.whatsapp).toEqual(["+48600111222"]);
    expect(e.wallets).toEqual([{ kind: "btc", address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" }]);
  });

  it("returns empty lists for empty text", () => {
    expect(extractFromText("")).toEqual({ urls: [], emails: [], phones: [], telegram: [], whatsapp: [], sharedDocs: [], onion: [], onionV2: [], messengers: [], wallets: [] });
  });
});

describe("domain verification tokens (B-155)", () => {
  it("reads the Meta, Google and Yandex verification meta tags of a page", () => {
    const html = `<html><head>
      <meta name="facebook-domain-verification" content="k2j3h4g5f6d7s8a9q0w1e2r3t4y5u6" />
      <meta content="AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde" name="google-site-verification">
      <meta name="yandex-verification" content="1a2b3c4d5e6f7a8b" />
      <meta name="google-site-verification" content="" />
    </head></html>`;
    expect(findTrackers(html).filter((t) => t.kind.endsWith("verification"))).toEqual([
      { kind: "google_site_verification", id: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde" },
      { kind: "meta_domain_verification", id: "k2j3h4g5f6d7s8a9q0w1e2r3t4y5u6" },
      { kind: "yandex_verification", id: "1a2b3c4d5e6f7a8b" },
    ]);
  });

  it("reads tokens from TXT records and rejects generic records", () => {
    expect(verificationTokens(["facebook-domain-verification=k2j3h4g5f6d7s8a9q0w1e2r3t4y5u6", "v=spf1 include:_spf.example ~all", "google-site-verification="])).toEqual([
      { kind: "meta_domain_verification", id: "k2j3h4g5f6d7s8a9q0w1e2r3t4y5u6" },
    ]);
  });
});

describe("more trackers (B-162, B-178)", () => {
  it("reads Clarity, Matomo, PostHog and the AdSense publisher ID", () => {
    const html = `<script>(function(c,l,a,r,i,t,y){})(window, document, "clarity", "script", "k3x9q2w7ab");</script>
      <script src="https://www.clarity.ms/tag/k3x9q2w7ab"></script>
      <script>_paq.push(['setTrackerUrl', 'https://stat.przyklad.test/matomo.php']); _paq.push(['setSiteId', '17']);</script>
      <script>posthog.init('phc_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0', {api_host: 'https://eu.posthog.com'})</script>
      <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456"></script>`;
    const got = findTrackers(html).filter((t) => ["clarity", "matomo", "posthog", "adsense"].includes(t.kind));
    expect(got).toEqual([
      { kind: "adsense", id: "ca-pub-1234567890123456" },
      { kind: "clarity", id: "k3x9q2w7ab" },
      { kind: "matomo", id: "stat.przyklad.test/17" },
      { kind: "posthog", id: "phc_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0" },
    ]);
  });
});
