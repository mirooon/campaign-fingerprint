import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchBinary, fetchPage, parseMetaRefresh, type HopFn, type HopResponse } from "./fetchPage";

/** Fixture-style hop: maps URL -> canned response. */
function mapHop(routes: Record<string, Partial<HopResponse> & { html?: string }>): HopFn & { calls: string[] } {
  const calls: string[] = [];
  const fn: HopFn = async ({ url }) => {
    calls.push(url.toString());
    const r = routes[url.toString()];
    if (!r) throw Object.assign(new Error(`no route ${url}`), { code: "ENOTFOUND" });
    return {
      status: r.status ?? 200,
      headers: r.headers ?? (r.html !== undefined ? { "content-type": "text/html; charset=utf-8" } : {}),
      body: r.body ?? Buffer.from(r.html ?? ""),
      truncated: r.truncated ?? false,
      remoteAddress: r.remoteAddress ?? "198.51.100.10",
    };
  };
  return Object.assign(fn, { calls });
}

describe("fetchPage redirect handling (injected hop)", () => {
  it("follows 301/302 chains and records each hop", async () => {
    const hop = mapHop({
      "https://ad.example/r?id=1": { status: 301, headers: { location: "/step2" } },
      "https://ad.example/step2": { status: 302, headers: { location: "https://landing.test/oferta" } },
      "https://landing.test/oferta": { html: "<title>Oferta</title>" },
    });
    const res = await fetchPage("https://ad.example/r?id=1", { hop });
    expect(res.ok).toBe(true);
    expect(res.finalUrl).toBe("https://landing.test/oferta");
    expect(res.redirectChain.map((h) => [h.url, h.status, h.kind])).toEqual([
      ["https://ad.example/r?id=1", 301, "http"],
      ["https://ad.example/step2", 302, "http"],
    ]);
    expect(res.body).toContain("Oferta");
  });

  it("follows meta refresh as a recorded hop", async () => {
    const hop = mapHop({
      "https://a.example/": { html: '<meta http-equiv="refresh" content="0; url=https://b.example/final">' },
      "https://b.example/final": { html: "<p>koniec</p>" },
    });
    const res = await fetchPage("https://a.example/", { hop });
    expect(res.finalUrl).toBe("https://b.example/final");
    expect(res.redirectChain[0]).toMatchObject({ kind: "meta-refresh", url: "https://a.example/" });
  });

  it("stops redirect loops and over-long chains", async () => {
    const loop = mapHop({
      "https://a.example/": { status: 302, headers: { location: "https://b.example/" } },
      "https://b.example/": { status: 302, headers: { location: "https://a.example/" } },
    });
    expect((await fetchPage("https://a.example/", { hop: loop })).errorCode).toBe("too-many-redirects");

    const routes: Record<string, Partial<HopResponse>> = {};
    for (let i = 0; i < 12; i++) routes[`https://r.example/${i}`] = { status: 302, headers: { location: `/${i + 1}` } };
    const res = await fetchPage("https://r.example/0", { hop: mapHop(routes), maxRedirects: 8 });
    expect(res.errorCode).toBe("too-many-redirects");
    expect(res.redirectChain.length).toBe(9);
  });

  it("refuses non-http schemes, including on redirect", async () => {
    const hop = mapHop({ "https://a.example/": { status: 302, headers: { location: "file:///etc/passwd" } } });
    expect((await fetchPage("file:///etc/passwd", { hop })).errorCode).toBe("invalid-url");
    expect((await fetchPage("ftp://a.example/x", { hop })).errorCode).toBe("invalid-url");
    expect((await fetchPage("javascript:alert(1)", { hop })).errorCode).toBe("invalid-url");
    const redirected = await fetchPage("https://a.example/", { hop });
    expect(redirected.errorCode).toBe("blocked");
    expect(hop.calls).toEqual(["https://a.example/"]);
  });

  it("decodes legacy Polish charsets", async () => {
    const body = Buffer.from([0x5a, 0x61, 0xbf, 0xf3, 0xb3, 0xe6]); // "Zażółć" in windows-1250
    const hop = mapHop({ "https://pl.example/": { body, headers: { "content-type": "text/html; charset=windows-1250" } } });
    expect((await fetchPage("https://pl.example/", { hop })).body).toBe("Zażółć");
  });
});

describe("SSRF guard (live hop)", () => {
  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://10.0.0.5:8080/admin",
    "http://localhost/",
    "http://0x7f000001/",
    "http://2130706433/",
  ])("blocks %s before connecting", async (url) => {
    const res = await fetchPage(url, { timeoutMs: 2000 });
    expect(res.errorCode).toBe("blocked");
  });

  it("blocks hostnames that resolve to private addresses (checked inside the socket lookup)", async () => {
    const resolver = async () => [{ address: "192.168.1.10", family: 4 }];
    const res = await fetchPage("http://intranet.example/", { resolver, timeoutMs: 2000 });
    expect(res.errorCode).toBe("blocked");
    expect(res.error).toContain("192.168.1.10");
  });

  it("blocks mixed answers where any address is private (DNS rebinding style)", async () => {
    const resolver = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    expect((await fetchPage("http://rebind.example/", { resolver, timeoutMs: 2000 })).errorCode).toBe("blocked");
  });
});

describe("live hop against a local server (guard explicitly disabled)", () => {
  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "/gzip" });
        res.end();
      } else if (req.url === "/gzip") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip" });
        res.end(zlib.gzipSync(Buffer.from("<html><title>Spakowana</title></html>")));
      } else if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(Buffer.alloc(50_000, 0x61));
      } else if (req.url === "/bomb") {
        res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
        res.end(zlib.gzipSync(Buffer.alloc(5_000_000, 0x61)));
      } else if (req.url === "/slow") {
        setTimeout(() => res.end("late"), 3000);
      } else if (req.url === "/img") {
        res.writeHead(200, { "content-type": "image/png" });
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it("follows a real redirect and gunzips", async () => {
    const res = await fetchPage(`${base}/redirect`, { unsafeAllowPrivateNetworks: true });
    expect(res.status).toBe(200);
    expect(res.redirectChain).toHaveLength(1);
    expect(res.body).toContain("Spakowana");
    expect(res.remoteAddress).toBe("127.0.0.1");
  });

  it("caps the body size, also after decompression (zip bomb)", async () => {
    const big = await fetchPage(`${base}/big`, { unsafeAllowPrivateNetworks: true, maxBytes: 1000 });
    expect(big.truncated).toBe(true);
    expect(big.bytes).toBe(1000);
    const bomb = await fetchPage(`${base}/bomb`, { unsafeAllowPrivateNetworks: true, maxBytes: 10_000 });
    expect(bomb.truncated).toBe(true);
    expect(bomb.bytes).toBe(10_000);
  });

  it("enforces the time budget", async () => {
    const res = await fetchPage(`${base}/slow`, { unsafeAllowPrivateNetworks: true, timeoutMs: 300 });
    expect(res.errorCode).toBe("timeout");
  });

  it("fetchBinary returns raw bytes", async () => {
    const { meta, data } = await fetchBinary(`${base}/img`, { unsafeAllowPrivateNetworks: true });
    expect(meta.contentType).toBe("image/png");
    expect(data?.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
});

describe("parseMetaRefresh", () => {
  it("parses common variants", () => {
    expect(parseMetaRefresh(`<meta http-equiv='Refresh' content='5;URL=/x'>`, "https://a.example/")).toEqual({
      delay: 5,
      url: "https://a.example/x",
    });
    expect(parseMetaRefresh(`<meta content="0;url=javascript:alert(1)" http-equiv="refresh">`, "https://a.example/")).toBeNull();
    expect(parseMetaRefresh(`<meta name="x" content="y">`, "https://a.example/")).toBeNull();
  });
});
