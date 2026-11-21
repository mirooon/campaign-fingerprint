import { describe, expect, it } from "vitest";
import {
  extractUrlsFromText,
  hostOf,
  normalizeUrl,
  refang,
  registrableDomain,
  resolveUrl,
  toAsciiHost,
  toUnicodeHost,
} from "./urls";

describe("refang", () => {
  it("undoes common defanging", () => {
    expect(refang("hxxps://evil[.]example/path")).toBe("https://evil.example/path");
    expect(refang("hxxp://a(.)b(.)test")).toBe("http://a.b.test");
    expect(refang("https[:]//x[.]test")).toBe("https://x.test");
  });
});

describe("normalizeUrl", () => {
  it("lower-cases scheme/host, drops fragment, default port and credentials", () => {
    const n = normalizeUrl("HTTPS://User:Pw@Promo.Zysk-Krypto.EXAMPLE:443/Landing?b=2&a=1#top")!;
    expect(n.url).toBe("https://promo.zysk-krypto.example/Landing?a=1&b=2");
    expect(n.host).toBe("promo.zysk-krypto.example");
    expect(n.registrableDomain).toBe("zysk-krypto.example");
    expect(n.subdomain).toBe("promo");
    expect(n.port).toBeNull();
  });

  it("strips per-click tracking parameters but keeps others", () => {
    const n = normalizeUrl("https://a.example/p?utm_source=fb&fbclid=XYZ&gclid=1&aff=77")!;
    expect(n.url).toBe("https://a.example/p?aff=77");
    expect(n.removedParams.sort()).toEqual(["fbclid", "gclid", "utm_source"]);
  });

  it("adds a default scheme to bare hosts and refangs", () => {
    expect(normalizeUrl("zysk-krypto.example/oferta")?.url).toBe("https://zysk-krypto.example/oferta");
    expect(normalizeUrl("hxxp://zysk-krypto[.]example")?.url).toBe("http://zysk-krypto.example/");
    expect(normalizeUrl("//cdn.example/x.js")?.url).toBe("https://cdn.example/x.js");
  });

  it("converts IDN hosts to punycode and keeps a unicode display form", () => {
    const n = normalizeUrl("https://bänk-przykład.example/logowanie")!;
    expect(n.host).toBe("xn--bnk-przykad-l8a44j.example");
    expect(n.isIdn).toBe(true);
    expect(n.hostUnicode).toBe("bänk-przykład.example");
    expect(n.registrableDomain).toBe("xn--bnk-przykad-l8a44j.example");
  });

  it("treats PSL private suffixes as separate sites", () => {
    expect(normalizeUrl("https://scam-a.github.io/x")?.registrableDomain).toBe("scam-a.github.io");
    expect(normalizeUrl("https://www.bbc.co.uk/")?.registrableDomain).toBe("bbc.co.uk");
    expect(normalizeUrl("https://sklep.example.com.pl/")?.registrableDomain).toBe("example.com.pl");
  });

  it("handles IP hosts", () => {
    const n = normalizeUrl("http://203.0.113.7:8080/a")!;
    expect(n.isIp).toBe(true);
    expect(n.registrableDomain).toBeNull();
    expect(n.url).toBe("http://203.0.113.7:8080/a");
    expect(normalizeUrl("http://[2001:db8::1]/")?.url).toBe(
      "http://[2001:0db8:0000:0000:0000:0000:0000:0001]/",
    );
  });

  it("rejects non-http schemes and garbage", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("ftp://files.example/x")).toBeNull();
    expect(normalizeUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl("")).toBeNull();
  });
});

describe("domain helpers", () => {
  it("registrableDomain works on hosts and URLs", () => {
    expect(registrableDomain("a.b.zysk.example")).toBe("zysk.example");
    expect(registrableDomain("https://www.zysk.example/x")).toBe("zysk.example");
    expect(registrableDomain("203.0.113.1")).toBeNull();
    expect(registrableDomain("localhost")).toBeNull();
  });

  it("hostOf / punycode helpers", () => {
    expect(hostOf("https://WWW.Example.com./a")).toBe("www.example.com");
    expect(hostOf("no scheme")).toBeNull();
    expect(toAsciiHost("Bücher.example")).toBe("xn--bcher-kva.example");
    expect(toUnicodeHost("xn--bcher-kva.example")).toBe("bücher.example");
  });

  it("resolveUrl resolves relative links and refuses dangerous schemes", () => {
    expect(resolveUrl("/favicon.png", "https://a.example/x/y")).toBe("https://a.example/favicon.png");
    expect(resolveUrl("img/a.png", "https://a.example/x/y")).toBe("https://a.example/x/img/a.png");
    expect(resolveUrl("javascript:void(0)", "https://a.example/")).toBeNull();
    expect(resolveUrl("mailto:a@b.example", "https://a.example/")).toBeNull();
  });
});

describe("extractUrlsFromText", () => {
  it("finds plain, defanged and www URLs in ad copy", () => {
    const text =
      "Kliknij: https://zysk-krypto.example/start?fbclid=abc. Albo hxxps://kopia[.]example/x, www.trzecia.test!";
    expect(extractUrlsFromText(text)).toEqual([
      "https://zysk-krypto.example/start",
      "https://kopia.example/x",
      "https://www.trzecia.test/",
    ]);
  });
});

describe("normalizeUrl fragment", () => {
  it("keeps the fragment apart from the canonical URL", () => {
    const n = normalizeUrl("https://lp.example/landers/a_b_c/#tickets")!;
    expect(n.url).toBe("https://lp.example/landers/a_b_c/");
    expect(n.fragment).toBe("tickets");
    expect(normalizeUrl("https://lp.example/")!.fragment).toBeUndefined();
  });
});
