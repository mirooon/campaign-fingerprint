import { describe, expect, it } from "vitest";
import {
  domSimhash,
  extractPageKit,
  hasCyrillic,
  normalizeComment,
  normalizeEndpointPath,
  simhashDistance,
} from "./pagekit";

const PAGE = "https://lp.oferta-demo.example/rejestracja/krok1";

function kit(html: string, url = PAGE) {
  return extractPageKit(html, url);
}

function keys(html: string, url = PAGE): string[] {
  return kit(html, url).endpoints.map((e) => e.key);
}

// ---------------------------------------------------------------------------
// Realistic but fictional templates for the DOM simhash tests
// ---------------------------------------------------------------------------

function newsTemplate(o: { title: string; lead: string; paragraphs: string[]; cls: string }): string {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${o.title}</title><link rel="stylesheet" href="/css/${o.cls}.css"></head>
<body class="${o.cls}">
<header class="top"><div class="logo"><a href="/"><img src="/img/logo.png" alt="logo"></a></div>
<nav><ul><li><a href="/kraj">Kraj</a></li><li><a href="/swiat">Świat</a></li><li><a href="/biznes">Biznes</a></li><li><a href="/sport">Sport</a></li></ul></nav></header>
<main><article><h1>${o.title}</h1><p class="lead">${o.lead}</p>
<figure><img src="/img/a.jpg" alt=""><figcaption>Zdjęcie ilustracyjne</figcaption></figure>
${o.paragraphs.map((p) => `<p>${p}</p>`).join("\n")}
<blockquote><p>Cytat z wywiadu.</p></blockquote>
<form action="/api/lead" method="post"><label>Imię</label><input name="imie"><label>E-mail</label><input name="email"><button>Wyślij</button></form>
</article>
<aside><h3>Najczęściej czytane</h3><ul><li><a href="/1">Pierwszy</a></li><li><a href="/2">Drugi</a></li><li><a href="/3">Trzeci</a></li></ul></aside></main>
<footer><p>Stopka redakcji</p><p><a href="/regulamin">Regulamin</a> · <a href="/prywatnosc">Prywatność</a></p></footer>
</body></html>`;
}

function tableTemplate(): string {
  const rows = Array.from({ length: 6 }, (_, i) => `<tr><td class="c${i}"><img src="/g/${i}.gif"></td><td><font size="2"><b>Nagroda ${i}</b></font><br><span>Opis</span></td><td><input type="checkbox" name="n${i}"></td></tr>`).join("\n");
  return `<html><head><title>Konkurs</title></head><body bgcolor="#fff"><center>
<table width="600" border="0"><tbody>
<tr><td colspan="3"><h2>Wygraj nagrodę</h2></td></tr>
${rows}
<tr><td colspan="3"><form method="post" action="/odbierz"><select name="rozmiar"><option>S</option><option>M</option><option>L</option></select><textarea name="uwagi"><div>nie tag</div></textarea><input type="submit" value="Odbierz"></form></td></tr>
</tbody></table></center></body></html>`;
}

describe("endpoints: forms", () => {
  it("resolves form actions, detects method and same/cross origin", () => {
    const html = `
      <form action="/api/v1/submit/0b9a5c3e-1d2f-4a6b-9c8d-7e6f5a4b3c2d/" method="post"></form>
      <form action="https://leads-api.example/api/lead"></form>
      <form action="#"></form><form action=""></form><form action="javascript:void(0)"></form><form action="mailto:a@b.example"></form>`;
    const eps = kit(html).endpoints;
    expect(eps).toEqual([
      {
        key: "*/api/v1/submit/<uuid>/",
        host: "lp.oferta-demo.example",
        pathTemplate: "/api/v1/submit/<uuid>/",
        sameOrigin: true,
        method: "POST",
        via: "form",
        raw: "/api/v1/submit/0b9a5c3e-1d2f-4a6b-9c8d-7e6f5a4b3c2d/",
      },
      {
        key: "leads-api.example/api/lead",
        host: "leads-api.example",
        pathTemplate: "/api/lead",
        sameOrigin: false,
        method: "GET",
        via: "form",
        raw: "https://leads-api.example/api/lead",
      },
    ]);
  });

  it("honours <base href> for form actions", () => {
    const html = `<base href="https://cdn-pages.test/kit/"><form action="send.php" method="POST"></form>`;
    expect(kit(html).endpoints[0]).toMatchObject({ key: "cdn-pages.test/kit/send.php", sameOrigin: false, method: "POST" });
  });
});

describe("endpoints: inline scripts", () => {
  it("fetch with quotes, concatenation, template literal prefix and method option", () => {
    const html = `<script>
      fetch("https://api.backend.example/v2/leads", { method: 'POST', body: d });
      fetch('/api/v2/lead/' + id);
      window.fetch(\`/api/track/\${uid}/send\`);
    </script>`;
    const eps = kit(html).endpoints;
    expect(eps.map((e) => [e.key, e.via, e.method])).toEqual([
      ["*/api/track/", "fetch", null],
      ["*/api/v2/lead/", "fetch", null],
      ["api.backend.example/v2/leads", "fetch", "POST"],
    ]);
  });

  it("XMLHttpRequest.open with any variable name", () => {
    const html = `<script>var req = new XMLHttpRequest(); req.open("POST", "https://crm.example/postback.php"); req.send(f);</script>`;
    expect(kit(html).endpoints[0]).toMatchObject({ key: "crm.example/postback.php", via: "xhr", method: "POST" });
  });

  it("axios variants", () => {
    const html = `<script>
      axios.post('/api/register', data);
      axios.get("https://geo.example/lookup");
      axios({ method: 'post', url: 'https://hooks.example/collect' });
      const api = axios.create({ baseURL: "https://core.example/api" });
      axios("https://plain.example/endpoint");
    </script>`;
    const byKey = Object.fromEntries(kit(html).endpoints.map((e) => [e.key, [e.via, e.method]]));
    expect(byKey).toEqual({
      "*/api/register": ["axios", "POST"],
      "geo.example/lookup": ["axios", "GET"],
      "hooks.example/collect": ["axios", null],
      "core.example/api": ["axios", null],
      "plain.example/endpoint": ["axios", null],
    });
  });

  it("jQuery variants", () => {
    const html = `<script>
      $.ajax("/ajax/form-handler");
      $.ajax({ type: "POST", url: "https://leads.example/save", data: x });
      $.post("send.php", d);
      $.get('/ajax/geo');
      jQuery.getJSON("https://cfg.example/settings.json");
      jQuery.post("https://other.example/in");
    </script>`;
    const byKey = Object.fromEntries(kit(html).endpoints.map((e) => [e.key, [e.via, e.method]]));
    expect(byKey).toEqual({
      "*/ajax/form-handler": ["jquery", null],
      "leads.example/save": ["jquery", null],
      "*/rejestracja/send.php": ["jquery", "POST"],
      "*/ajax/geo": ["jquery", "GET"],
      "cfg.example/settings.json": ["jquery", "GET"],
      "other.example/in": ["jquery", "POST"],
    });
  });

  it("API-like literals with markers, ignoring non-markers, comments and static files", () => {
    const html = `<script>
      var cloak = "/api/v1/trigger/field/";
      var sub = "https://backend.example/api/v1/submit/0b9a5c3e-1d2f-4a6b-9c8d-7e6f5a4b3c2d/";
      var cb = '//cb.example/callback/12345';
      var about = "/about/team";
      var logo = "/api/img/logo.png";
      fetch("/data/config.js");
      // fetch("/api/old-lead")
      /* $.post("/api/older-lead") */
      var img = "data:image/png;base64,AAAA";
    </script>`;
    expect(keys(html)).toEqual([
      "*/api/v1/trigger/field/",
      "backend.example/api/v1/submit/<uuid>/",
      "cb.example/callback/<n>",
    ]);
    expect(kit(html).endpoints.every((e) => e.via === "literal")).toBe(true);
  });

  it("does not scan external or non-JS scripts and keeps the first via when deduplicating", () => {
    const html = `<script src="/js/app.js">fetch("/api/ignored")</script>
      <script type="application/ld+json">{"url": "https://x.example/register"}</script>
      <form action="/api/lead" method="post"></form>
      <script>$.post("/api/lead", d);</script>`;
    const eps = kit(html).endpoints;
    expect(eps).toHaveLength(1);
    expect(eps[0]).toMatchObject({ key: "*/api/lead", via: "form", method: "POST" });
  });

  it("returns endpoints sorted by key and caps the raw literal", () => {
    const long = `https://zz.example/api/${"x".repeat(400)}`;
    const html = `<script>fetch("/api/b"); fetch("/api/a"); fetch("${long}");</script>`;
    const eps = kit(html).endpoints;
    expect(eps.map((e) => e.key)).toEqual(["*/api/a", "*/api/b", `zz.example/api/${"x".repeat(400)}`]);
    expect(eps[2].raw.length).toBe(300);
  });
});

describe("normalizeEndpointPath", () => {
  it.each([
    ["/api/v1/submit/0b9a5c3e-1d2f-4a6b-9c8d-7e6f5a4b3c2d/", "/api/v1/submit/<uuid>/"],
    ["/API//Lead/12345", "/api/lead/<n>"],
    ["/t/9f86d081884c7d659a2feaa0c55ad015", "/t/<hex>"],
    ["/s/a1b2c3d4e5f6g7h8i9", "/s/<id>"],
    ["/f/xyzabcde", "/f/xyzabcde"],
    ["", "/"],
    ["/", "/"],
    ["lead.php", "/lead.php"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeEndpointPath(input)).toBe(expected);
  });
});

describe("DOM simhash", () => {
  const a1 = newsTemplate({ title: "Skandal w studiu", lead: "Wywiad, który zniknął.", paragraphs: ["Jeden.", "Dwa.", "Trzy."], cls: "alfa" });
  const a2 = newsTemplate({ title: "Inny tytuł zupełnie", lead: "Całkiem inna treść i inne słowa.", paragraphs: ["Raz dwa trzy cztery.", "Pięć.", "Sześć siedem."], cls: "beta" });
  const b = tableTemplate();

  it("same structure with different text and attributes gives distance 0", () => {
    const h1 = domSimhash(a1).simhash!;
    const h2 = domSimhash(a2).simhash!;
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
    expect(simhashDistance(h1, h2)).toBe(0);
  });

  it("structurally different templates are far apart", () => {
    const d = simhashDistance(domSimhash(a1).simhash!, domSimhash(b).simhash!);
    expect(d).toBeGreaterThanOrEqual(12);
  });

  it("does not tokenise raw-text content and returns null for tiny pages", () => {
    const withScript = a1.replace("<main>", "<main><script>var s='<div><p><span>';</script><style>p>a{}</style>");
    const withScriptOnly = a1.replace("<main>", "<main><script></script><style></style>");
    expect(domSimhash(withScript).simhash).toBe(domSimhash(withScriptOnly).simhash);
    expect(domSimhash("<html><body><p>krótko</p></body></html>")).toEqual({ simhash: null, tagCount: 3 });
    expect(domSimhash(b).tagCount).toBeGreaterThan(25);
  });

  it("is also exposed through extractPageKit", () => {
    const k = kit(a1);
    expect(k.domSimhash).toBe(domSimhash(a1).simhash);
    expect(k.tagCount).toBe(domSimhash(a1).tagCount);
  });
});

describe("hidden fields", () => {
  it("collects lower-cased names regardless of attribute order and quoting", () => {
    const html = `<form>
      <input type="hidden" name="read_time" value="0">
      <input name='Fill_Time' type='HIDDEN'>
      <input value=1 name=device_id type=hidden>
      <input type="text" name="email"><input type="hidden" value="no-name">
      <input type="hidden" name="read_time"></form>`;
    expect(kit(html).hiddenFields).toEqual(["device_id", "fill_time", "read_time"]);
  });
});

describe("assets", () => {
  it("collects js/css with same-origin path keys and cross-origin host keys", () => {
    const html = `<link rel="stylesheet" href="/static/css/Main.CSS?v=3">
      <link rel="preload stylesheet" href="https://fonts.example/f.css">
      <link rel="icon" href="/favicon.ico">
      <script src="/static/js/lead.9f8e7d.js?x=1#y"></script>
      <script src="https://cdn.example/libs/jquery-3.7.1.min.js"></script>
      <script src="/static/js/lead.9f8e7d.js"></script>`;
    const assets = kit(html).assets;
    expect(assets.map((a) => [a.key, a.kind, a.sameOrigin, a.basename])).toEqual([
      ["/static/css/main.css", "css", true, "main.css"],
      ["/static/js/lead.9f8e7d.js", "js", true, "lead.9f8e7d.js"],
      ["cdn.example/libs/jquery-3.7.1.min.js", "js", false, "jquery-3.7.1.min.js"],
      ["fonts.example/f.css", "css", false, "f.css"],
    ]);
    expect(assets[1].url).toBe("https://lp.oferta-demo.example/static/js/lead.9f8e7d.js");
  });
});

describe("comments", () => {
  it("collects HTML and inline-JS comments, skips strings and trivial ones", () => {
    const html = `<!--   Szablon   strony v2  — sekcja FORMULARZ -->
      <!--[if lt IE 9]><script src="x.js"></script><![endif]-->
      <!-- ===================== -->
      <!-- krótki -->
      <script>
        var u = "https://x.example/y"; // dalej: walidacja pola telefonu
        /* blok:
         * obsługa wysyłki leadów
         */
        var s = '// to nie jest komentarz';
      </script>
      <style>/* css comment is ignored */</style>`;
    const k = kit(html);
    expect(k.comments).toEqual([
      "szablon strony v2 — sekcja formularz",
      "dalej: walidacja pola telefonu",
      "blok: obsługa wysyłki leadów",
    ]);
    expect(k.cyrillicComments).toBe(false);
  });

  it("normalizeComment rules", () => {
    expect(normalizeComment("<!--  Hello   World Template  -->")).toBe("hello world template");
    expect(normalizeComment("// short")).toBeNull();
    expect(normalizeComment("[if IE]><p>x</p><![endif]")).toBeNull();
    expect(normalizeComment("1234567890123456")).toBeNull();
    expect(normalizeComment(`/* ${"x".repeat(500)} */`)!.length).toBe(300);
  });

  it("flags Cyrillic comments (including trivial ones)", () => {
    const html = `<script>
      // вставляем форму после блока phone
      var a = 1;
    </script>`;
    const k = kit(html);
    expect(k.cyrillicComments).toBe(true);
    expect(k.comments).toEqual(["вставляем форму после блока phone"]);
    expect(kit("<!-- тест -->").cyrillicComments).toBe(true);
    expect(hasCyrillic("Zаrabiaj")).toBe(true); // Cyrillic "а"
    expect(hasCyrillic("Zarabiaj")).toBe(false);
  });
});

describe("robustness", () => {
  it("never throws on garbage and handles an invalid page URL", () => {
    expect(() => extractPageKit("<<<<form action=", "not a url")).not.toThrow();
    const k = extractPageKit(`<form action="/api/lead"></form><script>fetch("https://abs.example/api/x")</script>`, "not a url");
    expect(k.endpoints.map((e) => e.key)).toEqual(["abs.example/api/x"]);
    expect(extractPageKit("", PAGE)).toMatchObject({ endpoints: [], domSimhash: null, tagCount: 0 });
  });

  it("stays fast on 2 MB pathological inputs", () => {
    const inputs = [
      "<".repeat(2_000_000),
      "<a ".repeat(700_000),
      "<!--".repeat(500_000),
      `<script>${"'".repeat(2_000_000)}</script>`,
      `<script>${"fetch('/api/x'+".repeat(140_000)}</script>`,
      `<div>${'<input type=hidden name="a"'.repeat(70_000)}`,
      `<script>${"`${".repeat(600_000)}</script>`,
    ];
    for (const html of inputs) {
      const t0 = performance.now();
      extractPageKit(html, PAGE);
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(1500);
    }
  });
});

describe("path identifiers (account IDs in same-origin resource paths)", () => {
  const ID = "1b2c3d4e-aaaa-4bbb-8ccc-0123456789ab";

  it("keeps a UUID that is a path segment of at least two same-origin resources", () => {
    const html = `<html><head>
      <link rel="icon" href="/_cdn/landing/${ID.toUpperCase()}/5f6e7d8c-1111-4222-8333-444455556666/favicon.png">
      <script src="/_cdn/landing/${ID}/main.js"></script></head>
      <body><img src="https://shop-a.example/_cdn/landing/${ID}/hero.jpg"></body></html>`;
    // the second UUID sits in one resource only (a per-page ID), so it is left out
    expect(extractPageKit(html, "https://shop-a.example/").pathIds).toEqual([{ id: ID, prefix: "/_cdn/landing/" }]);
  });

  it("ignores UUIDs on other hosts and in navigation links", () => {
    const html = `<html><body>
      <script src="https://cdn.vendor.test/${ID}/a.js"></script>
      <img src="https://cdn.vendor.test/${ID}/b.png">
      <a href="/offer/${ID}/one">1</a><a href="/offer/${ID}/two">2</a></body></html>`;
    expect(extractPageKit(html, "https://shop-a.example/").pathIds).toEqual([]);
  });
});
