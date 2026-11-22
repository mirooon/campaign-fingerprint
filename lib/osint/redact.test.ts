import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { defangHost, defangText, maskMetaToken, maskText, maskUrl, redactHar, redactPageHtml } from "./redact";

const TOKEN = "EAABsbCS1iHgBO7Zx9yQ2testtoken";
const sha12 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);

describe("maskMetaToken / maskUrl", () => {
  it("replaces a Meta token with its prefix and a hash, so equal tokens stay recognisable but unusable", () => {
    expect(maskMetaToken(TOKEN)).toBe(`EA…[sha256:${sha12(TOKEN)}]`);
  });

  it("masks token values (also the short EABC prefix) and the analyst's IP in the query of a URL, nothing else", () => {
    const out = maskUrl(`https://lp.example/p?x=1&token=${TOKEN}&ip=192.0.2.10&sub=EABCdefgh&name=Eagle`);
    expect(out).toBe(`https://lp.example/p?x=1&token=EA…[sha256:${sha12(TOKEN)}]&ip=[zredagowane]&sub=EA…[sha256:${sha12("EABCdefgh")}]&name=Eagle`);
    expect(maskUrl("https://lp.example/p?ip=nie-adres")).toBe("https://lp.example/p?ip=nie-adres");
    expect(maskUrl("https://lp.example/EAGLEEYES")).toBe("https://lp.example/EAGLEEYES");
  });
});

describe("maskText", () => {
  it("masks long tokens and token parameters in free text, but leaves ordinary words", () => {
    const text = `Link: https://a.example/?access_token=${TOKEN} i EARLYBIRDS oraz ${TOKEN}`;
    const out = maskText(text);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain("EARLYBIRDS");
    expect(out.match(/EA…\[sha256:/g)).toHaveLength(2);
  });
});

describe("redactPageHtml", () => {
  const visit = { ip_address: "192.0.2.10", country: "XX", city: "Testowo", zip: "00-000", asn: "AS64500", ja3_hash: "a".repeat(32), ja4: "t13d1516h2_abc", fingerprint: "fp-123456", user_agent: "Mozilla/5.0 Test", window: "1920x1080", campaign_human_id: 77 };
  const aio = JSON.stringify({ campaign: { uuid: "11111111-1111-4111-8111-111111111111" }, visit });
  const html = `<html><script>window.aio = JSON.parse('${aio.replace(/'/g, "\\'")}');</script><a href="https://t.example/c?ip=192.0.2.10&token=${TOKEN}">x</a><p>zwykły tekst</p></html>`;
  const { text, changed } = redactPageHtml(html);

  it("removes the visitor record of the platform, keeping the campaign number the method needs", () => {
    expect(changed).toBe(true);
    for (const v of ["192.0.2.10", "Testowo", "00-000", "AS64500", "a".repeat(32), "t13d1516h2_abc", "fp-123456", "1920x1080", "Mozilla/5.0 Test"]) expect(text, v).not.toContain(v);
    expect(text).toContain('"campaign_human_id":77');
    expect(text).toContain("11111111-1111-4111-8111-111111111111");
    expect(text).toContain("zwykły tekst");
  });

  it("masks the token and the IP in links and handles an assignment in plain JavaScript", () => {
    expect(text).not.toContain(TOKEN);
    expect(text).toContain("ip=[zredagowane]");
    const js = redactPageHtml(`<script>window.aio.visit.ip_address = "192.0.2.77"; window.aio.visit.fingerprint = 'zz-999999';</script> adres 192.0.2.77`);
    expect(js.text).not.toContain("192.0.2.77");
    expect(js.text).not.toContain("zz-999999");
  });

  it("keeps the operator's keys of the visitor record and their repetitions in the page, removing only the analyst's values everywhere", () => {
    const lander = "/landers/22222222-2222-4222-8222-222222222222/";
    const v = { campaign_human_id: 5, domain: "strona.example", launcher: "33333333-3333-4333-8333-333333333333", path: lander, landing_uuids: ["22222222-2222-4222-8222-222222222222"], query: "?fbclid=klik-123456", ip_address: "192.0.2.44", useragent: "Mozilla/5.0 Analityk", location_city: "Testowo-Dolne" };
    const page = `<!-- saved from url=(0040)https://strona.example${lander}?fbclid=klik-123456 --><script>window.aio = ${JSON.stringify({ visit: v })};</script><script src="${lander}app.js"></script><p>Mozilla/5.0 Analityk 192.0.2.44 Testowo-Dolne</p>`;
    const out = redactPageHtml(page).text;
    for (const keep of ['"domain":"strona.example"', '"launcher":"33333333-3333-4333-8333-333333333333"', `"path":"${lander}"`, `src="${lander}app.js"`, `saved from url=(0040)https://strona.example${lander}?fbclid=klik-123456`]) expect(out, keep).toContain(keep);
    expect(out).toContain(`"query":"[zredagowane]"`);
    for (const gone of ["192.0.2.44", "Mozilla/5.0 Analityk", "Testowo-Dolne"]) expect(out, gone).not.toContain(gone);
  });

  it("reports no change for a page without such data", () => {
    const plain = "<html><body>nic</body></html>";
    expect(redactPageHtml(plain)).toEqual({ text: plain, changed: false });
  });
});

describe("redactHar", () => {
  const har = JSON.stringify({
    log: {
      entries: [
        {
          request: {
            method: "POST",
            url: `https://lp.example/api/aio?token=${TOKEN}`,
            headers: [{ name: "Cookie", value: "sid=abc" }, { name: "User-Agent", value: "Mozilla/5.0 Test" }, { name: "Authorization", value: "Bearer x" }],
            cookies: [{ name: "sid", value: "abc" }],
            queryString: [{ name: "token", value: TOKEN }],
            postData: { mimeType: "application/json", text: JSON.stringify({ fingerprint: "fp-123456", ja3_hash: "b".repeat(32), name: "ok" }) },
          },
          response: {
            headers: [{ name: "Set-Cookie", value: "sid=abc; Path=/" }, { name: "Content-Type", value: "text/html" }],
            cookies: [{ name: "sid", value: "abc" }],
            content: { mimeType: "text/html", text: `<script>window.aio=JSON.parse('{"visit":{"ip_address":"192.0.2.10"}}')</script>` },
          },
        },
      ],
    },
  });
  const { text, changed } = redactHar(har);

  it("drops cookies and credentials, the analyst's browser fingerprint and the visitor record, and masks tokens", () => {
    expect(changed).toBe(true);
    for (const v of ["sid=abc", "Bearer x", "fp-123456", "192.0.2.10", TOKEN, "b".repeat(32)]) expect(text, v).not.toContain(v);
    const parsed = JSON.parse(text) as { log: { entries: Array<{ request: { headers: Array<{ name: string; value: string }>; method: string } }> } };
    expect(parsed.log.entries[0].request.method).toBe("POST");
    expect(parsed.log.entries[0].request.headers.find((h) => h.name === "Cookie")?.value).toBe("[zredagowane]");
  });

  it("is an error for text that is not a HAR, not silently passed on", () => {
    expect(() => redactHar("to nie json")).toThrow();
  });
});

describe("defanging for documents", () => {
  it("rewrites the scheme and the host of an address, leaving path and query as they are", () => {
    expect(defangText("zob. https://lp.sklep.example/oferta?a=1.2 oraz http://x.test/")).toBe("zob. hxxps://lp[.]sklep[.]example/oferta?a=1.2 oraz hxxp://x[.]test/");
  });
  it("rewrites a bare host", () => {
    expect(defangHost("lp.sklep.example")).toBe("lp[.]sklep[.]example");
  });
});
