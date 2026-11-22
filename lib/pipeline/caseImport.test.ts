import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importCases, type CaseLookups } from "./caseImport";
import { fixtureSources } from "./sources";

const RAW = '<html><head><title>Surowa</title><link rel="icon" href="/fav.png"></head><body>RAW-BODY</body></html>';
const ICON = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const LOGO = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9]);
const LANDING_1 = "https://lp-one.example/?utm_id=abc&utm_visit=1&offer=77";

const entry = (url: string, type: string, body: Buffer | string, mime: string, ip: string, startedDateTime: string) => ({
  _resourceType: type,
  startedDateTime,
  serverIPAddress: ip,
  request: { method: "GET", url },
  response: {
    status: 200,
    headers: [
      { name: "Content-Type", value: mime },
      { name: "Server", value: "nginx" },
      { name: "Content-Encoding", value: "br" },
    ],
    content: typeof body === "string" ? { mimeType: mime, text: body } : { mimeType: mime, text: body.toString("base64"), encoding: "base64" },
  },
});

/** A fake MPEG-TS segment: two 188-byte packets starting with the sync byte, the payload filled with `fill`. */
const tsSegment = (fill: number) => {
  const b = Buffer.alloc(376, fill);
  b[0] = 0x47;
  b[188] = 0x47;
  return b;
};

let root: string;
let cases: string;
let out: string;

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "case-import-"));
  cases = path.join(root, "cases");
  out = path.join(root, "out");
  // Case 1: HAR (raw server response, an embedded third-party frame first) + saved page + screenshot of the ad
  const c1 = path.join(cases, "sprawa-1");
  mkdirSync(c1, { recursive: true });
  writeFileSync(path.join(c1, "Strona testowa.html"), `<!DOCTYPE html>\n<!-- saved from url=(0058)${LANDING_1} -->\n<html><body>RENDERED</body></html>`);
  writeFileSync(
    path.join(c1, "lp-one.example.har"),
    JSON.stringify({
      log: {
        entries: [
          entry("https://player.vendor.test/embed/?v=1", "document", "<html>FRAME</html>", "text/html", "198.51.100.7", "2026-01-15T09:10:00.100Z"),
          entry(LANDING_1, "document", Buffer.from(RAW), "text/html; charset=utf-8", "203.0.113.10", "2026-01-15T09:10:01.000Z"),
          entry("https://lp-one.example/fav.png", "other", ICON, "image/png", "[2001:db8::10]", "2026-01-15T09:10:02.000Z"),
          entry("https://lp-one.example/js/trap.js?v=3", "script", 'console.log("Moduł testowy: start!");', "application/javascript", "203.0.113.10", "2026-01-15T09:10:02.100Z"),
          entry("https://cdn.vendor.test/lib.js", "script", 'console.log("Obcy skrypt!");', "application/javascript", "192.0.2.77", "2026-01-15T09:10:02.200Z"),
        ],
      },
    }),
  );
  writeFileSync(path.join(c1, "Zrzut ekranu 2026-01-15 101500.png"), ICON);
  // Case 2: saved page only (browser "save as": local asset folder, ".pobrane" suffix on scripts)
  const c2 = path.join(cases, "sprawa-2");
  mkdirSync(path.join(c2, "Oferta_files"), { recursive: true });
  writeFileSync(
    path.join(c2, "Oferta.html"),
    `<!-- saved from url=(0025)https://lp-two.test/offer -->\n<html><head><script src="./Oferta_files/main.js.pobrane"></script></head><body>SAVED-BODY</body></html>`,
  );
  writeFileSync(path.join(c2, "Oferta_files", "logo.png"), LOGO);
  writeFileSync(path.join(c2, "Oferta_files", "main.js.pobrane"), "console.log(1)");
  // Not a case: no page capture inside
  mkdirSync(path.join(cases, "notatki"), { recursive: true });
  writeFileSync(path.join(cases, "notatki", "czytaj.txt"), "x");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("importCases (saved page + HAR + screenshot per case -> offline fixtures)", () => {
  it("writes one input record per case with the landing URL, the screenshot and the capture time", async () => {
    await importCases({ casesDir: cases, outDir: out });
    const records = JSON.parse(readFileSync(path.join(out, "input.json"), "utf8"));
    expect(records).toEqual([
      { id: "sprawa-1", landing_url: LANDING_1, screenshot: path.join(cases, "sprawa-1", "Zrzut ekranu 2026-01-15 101500.png"), first_seen: "2026-01-15T09:10:00.100Z" },
      { id: "sprawa-2", landing_url: "https://lp-two.test/offer", screenshot: null, first_seen: null },
    ]);
    expect(JSON.parse(readFileSync(path.join(out, "mapping.json"), "utf8"))).toEqual({ id: "id", landingUrl: "landing_url", imagePath: "screenshot", firstSeen: "first_seen" });
  });

  it("records the SHA-256, size and import time of every input file of a case in provenance.json", async () => {
    await importCases({ casesDir: cases, outDir: out });
    const prov = JSON.parse(readFileSync(path.join(out, "provenance.json"), "utf8")) as {
      generatedAt: string;
      cases: Array<{ id: string; importedAt: string; files: Array<{ role: string; path: string; sha256: string | null; size: number; modifiedUtc: string | null }> }>;
    };
    const c1 = prov.cases.find((c) => c.id === "sprawa-1")!;
    expect(c1.files.map((f) => f.role).sort()).toEqual(["har", "saved_html", "screenshot"]);
    for (const f of c1.files) expect(f.sha256, f.role).toBe(createHash("sha256").update(readFileSync(f.path)).digest("hex"));
    expect(c1.files.find((f) => f.role === "screenshot")!.size).toBe(ICON.length);
    expect(c1.importedAt).toBe(prov.generatedAt);
  });

  it("serves the raw HAR document (not an embedded frame) at the normalised landing URL, with its headers and IPs", async () => {
    await importCases({ casesDir: cases, outDir: out });
    const src = fixtureSources(path.join(out, "fixtures"));
    const page = await src.fetchPage("https://lp-one.example/?offer=77");
    expect(page.status).toBe(200);
    expect(page.body).toBe(RAW);
    expect(page.headers.server).toBe("nginx");
    expect(await src.fetchBinary("https://lp-one.example/fav.png")).toEqual(ICON);
    const dns = await src.dns("lp-one.example", ["A", "AAAA"]);
    expect([dns.a, dns.aaaa]).toEqual([["203.0.113.10"], ["2001:db8::10"]]);
  });

  it("falls back to the saved page, undoing the browser's download suffix and serving its local images", async () => {
    await importCases({ casesDir: cases, outDir: out });
    const src = fixtureSources(path.join(out, "fixtures"));
    const page = await src.fetchPage("https://lp-two.test/offer");
    expect(page.body).toContain('src="./Oferta_files/main.js"');
    expect(page.body).toContain("SAVED-BODY");
    expect(await src.fetchBinary("https://lp-two.test/Oferta_files/logo.png")).toEqual(LOGO);
  });

  it("keeps the page's own scripts (same domain in the HAR, every script of _files), never a third-party script", async () => {
    await importCases({ casesDir: cases, outDir: out });
    const src = fixtureSources(path.join(out, "fixtures"));
    expect((await src.fetchBinary("https://lp-one.example/js/trap.js"))?.toString()).toContain("Moduł testowy");
    expect(await src.fetchBinary("https://cdn.vendor.test/lib.js")).toBeNull();
    expect((await src.fetchBinary("https://lp-two.test/Oferta_files/main.js"))?.toString()).toBe("console.log(1)");
  });

  it("records passive lookups for landing domains when a lookup source is given", async () => {
    const asked: string[] = [];
    const lookups: CaseLookups = {
      dns: async (name, types) => {
        asked.push(`${name}:${types.join(",")}`);
        return name === "lp-two.test" ? { A: ["203.0.113.20"], NS: ["ns1.dns-host.test", "ns2.dns-host.test"] } : { NS: ["ns1.dns-host.test"] };
      },
      rdapRaw: async (domain) => ({
        objectClassName: "domain",
        ldhName: domain,
        events: [{ eventAction: "registration", eventDate: "2026-01-05T10:00:00Z" }],
        entities: [{ roles: ["registrar"], publicIds: [{ type: "IANA Registrar ID", identifier: "9991" }], vcardArray: ["vcard", [["fn", {}, "text", "Zeta Names Inc"]]] }],
      }),
      txt: async (name) => (name === "20.113.0.203.origin.asn.cymru.com" ? ["64500 | 203.0.113.0/24 | ZZ | other | 2026-01-01"] : name === "AS64500.asn.cymru.com" ? ["64500 | ZZ | other | 2026-01-01 | EXAMPLE-NET, ZZ"] : []),
    };
    await importCases({ casesDir: cases, outDir: out, lookups });
    const src = fixtureSources(path.join(out, "fixtures"));
    // A records captured in the HAR are kept; hosts without a HAR are resolved through the lookup source
    expect((await src.dns("lp-one.example", ["A"])).a).toEqual(["203.0.113.10"]);
    expect((await src.dns("lp-two.test", ["A", "NS"])).ns).toEqual(["ns1.dns-host.test", "ns2.dns-host.test"]);
    expect((await src.dns("lp-two.test", ["A"])).a).toEqual(["203.0.113.20"]);
    expect(await src.rdap("lp-two.test")).toMatchObject({ registrar: "Zeta Names Inc", registrarIanaId: "9991", created: "2026-01-05T10:00:00.000Z" });
    expect(await src.asn("203.0.113.20")).toMatchObject({ asn: 64500, asName: "EXAMPLE-NET, ZZ" });
    expect(asked).not.toContain("player.vendor.test:A,AAAA");
  });

  it("names the lookups that failed instead of dropping them silently", async () => {
    const lookups: CaseLookups = {
      dns: async () => ({}),
      rdapRaw: async (domain) => {
        if (domain === "lp-one.example") throw new Error("HTTP 429");
        return null;
      },
      txt: async () => [],
    };
    const fresh = path.join(root, "out-failures");
    const res = await importCases({ casesDir: cases, outDir: fresh, lookups });
    expect(res.failedLookups).toEqual(["rdap:lp-one.example", "rdap:lp-two.test"]);
  });
});

describe("importCases (untidy case folders)", () => {
  let dir: string;
  let outDir: string;
  const doc = (title: string, body = "") => `<html><head><title>${title}</title></head><body>${body}</body></html>`;
  const saved = (url: string, html: string) => `<!DOCTYPE html>\n<!-- saved from url=(0099)${url} -->\n${html}`;
  const har = (entries: unknown[], pageTitle?: string) => JSON.stringify({ log: { pages: pageTitle ? [{ title: pageTitle }] : [], entries } });
  const records = () => JSON.parse(readFileSync(path.join(outDir, "input.json"), "utf8")) as Array<Record<string, unknown>>;
  const byId = (id: string) => records().find((r) => r.id === id);

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "case-import-untidy-"));
    outDir = path.join(dir, "out");
    const cs = path.join(dir, "cases");
    const mk = (...p: string[]) => {
      const d = path.join(cs, ...p);
      mkdirSync(d, { recursive: true });
      return d;
    };

    // 7: only a video of the ad with its yt-dlp description
    const c7 = mk("7");
    writeFileSync(path.join(c7, "Zobacz [111222333444555_3].mp4"), "video");
    writeFileSync(
      path.join(c7, "Zobacz [111222333444555_3].info.json"),
      JSON.stringify({ webpage_url: "https://www.facebook.com/ads/library/?id=111222333444555", playlist_uploader: "LasTestowy", epoch: 1767953733 }),
    );

    // 42: one ad, three saved pages in sub-folders, all behind one address
    const c42 = mk("42");
    writeFileSync(path.join(c42, "reklama_1.png"), ICON);
    const URL42 = "https://funnel.test/?utm_id=x1&utm_visit=v1";
    // strona_1: saved from disk, so without an address; its HAR holds only third-party frames
    const s1 = mk("42", "strona_1");
    writeFileSync(path.join(s1, "Artykuł.html"), `<!-- saved from url=(0014)about:internet -->\n${doc("Artykuł", '<img src="https://funnel.test/a.png"><img src="https://funnel.test/b.png"><a href="https://real-news.test/">źródło</a>')}`);
    writeFileSync(
      path.join(s1, ".har"),
      har([entry("https://tags.vendor.test/a?id=1", "document", "<html>TAG</html>", "text/html", "198.51.100.9", "2026-01-20T11:00:07.000Z")], "file:///C:/Users/x/Downloads/Artyku%C5%82.html"),
    );
    const s2 = mk("42", "strona_2");
    writeFileSync(path.join(s2, "Produkt.html"), saved(URL42, doc("Produkt", "RENDERED")));
    writeFileSync(path.join(s2, "produkt.har"), har([entry(URL42, "document", doc("Produkt", "RAW-PRODUCT"), "text/html", "203.0.113.61", "2026-01-20T11:05:42.000Z")], URL42));
    const s3 = mk("42", "strona_3");
    writeFileSync(path.join(s3, "Portal.html"), saved(URL42, doc("Portal", "RENDERED")));
    writeFileSync(path.join(s3, "funnel.test.har"), har([entry(URL42, "document", doc("Portal", "RAW-WHITE"), "text/html", "203.0.113.61", "2026-01-20T11:08:23.000Z")], URL42));

    // 11: phone screenshots, a screen recording, the saved page and a capture bundle of the same page in a sub-folder
    const c11 = mk("11");
    for (const n of ["IMG_0101.PNG", "IMG_0102.PNG", "IMG_0103.PNG"]) writeFileSync(path.join(c11, n), ICON);
    writeFileSync(path.join(c11, "ScreenRecording.MP4"), "video");
    writeFileSync(path.join(c11, "Lek.html"), saved("https://pill.test/?land_id=1&key=k1", doc("Lek", "RENDERED")));
    const bundle = mk("11", "pill_test", "pill_test");
    mkdirSync(path.join(bundle, "resources", "document"), { recursive: true });
    writeFileSync(path.join(bundle, "resources", "document", "index_1.html"), doc("Lek", "RESOURCE-COPY"));
    // the page's video player saved as HLS: segment names carry a hash, the playlist names them without it
    mkdirSync(path.join(bundle, "resources", "media"), { recursive: true });
    writeFileSync(path.join(bundle, "resources", "media", "output_001_bbbbbbbb.ts"), tsSegment(2));
    writeFileSync(path.join(bundle, "resources", "media", "output_000_aaaaaaaa.ts"), tsSegment(1));
    writeFileSync(path.join(bundle, "resources", "media", "output_cccccccc.m3u8"), "#EXTM3U\n#EXTINF:10.0,\noutput_000.ts\n#EXTINF:10.0,\noutput_001.ts\n");
    writeFileSync(path.join(bundle, "dom.html"), doc("Lek", "DOM"));
    writeFileSync(path.join(bundle, "screenshot.png"), LOGO);
    writeFileSync(path.join(bundle, "manifest.json"), JSON.stringify({ tool: "page-capture 0.1.0", page_url: "https://pill.test/?land_id=2&key=[REDACTED]" }));
    writeFileSync(path.join(bundle, "page.mhtml"), "From: <Saved by Blink>\nSnapshot-Content-Location: https://pill.test/?land_id=2&key=k2\nSubject: Lek\n\n");
    writeFileSync(path.join(bundle, "page.har"), har([entry("https://pill.test/?land_id=2&key=[REDACTED]", "document", doc("Lek", "RAW-PILL"), "text/html", "203.0.113.14", "2026-01-12T09:30:03.000Z")], "Lek"));

    // 1 and 4: the HAR of case 4 was filed in the folder of case 1
    const URL4 = "https://clone.test/L1/?clickid=abc";
    const c1 = mk("1");
    writeFileSync(path.join(c1, "Dwa.html"), saved("https://two.test/?utm_id=q", doc("Dwa", "RENDERED")));
    writeFileSync(path.join(c1, "two.test.har"), har([entry("https://two.test/?utm_id=q", "document", doc("Dwa", "RAW-TWO"), "text/html", "203.0.113.2", "2026-01-09T08:10:04.000Z")]));
    writeFileSync(path.join(c1, "clone.test.har"), har([entry(URL4, "document", doc("Trzy", "RAW-THREE"), "text/html", "203.0.113.3", "2026-01-09T08:40:01.000Z")]));
    const c4 = mk("4");
    writeFileSync(path.join(c4, "Trzy.html"), saved(URL4, doc("Trzy", "RENDERED")));

    await importCases({ casesDir: cs, outDir });
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps a case that holds only a video and its yt-dlp description, with the advertiser and the ad-library ID", () => {
    expect(byId("7")).toMatchObject({ landing_url: null, advertiser: "LasTestowy", ad_library_id: "111222333444555", first_seen: "2026-01-09T10:15:33.000Z" });
    expect(String(byId("7")!.video)).toMatch(/Zobacz \[111222333444555_3\]\.mp4$/);
    expect(JSON.parse(readFileSync(path.join(outDir, "mapping.json"), "utf8"))).toMatchObject({ videoPath: "video", advertiser: "advertiser", extraImagePaths: "more_screenshots" });
  });

  it("gives one record per different page of a case and keeps apart copies of one address with different content", async () => {
    expect(records().filter((r) => r.case === "42").map((r) => r.id)).toEqual(["42_strona_1", "42_strona_2", "42_strona_3"]);
    for (const id of ["42_strona_1", "42_strona_2", "42_strona_3"]) expect(String(byId(id)!.screenshot)).toMatch(/reklama_1\.png$/);
    const src = fixtureSources(path.join(outDir, "fixtures"));
    // utm_* are tracking parameters, so all three share one normalised address
    expect((await src.fetchPage("https://funnel.test/")).body).toContain("Artykuł");
    expect(byId("42_strona_2")!.landing_url).toBe("https://funnel.test/?utm_id=x1&utm_visit=v1#capture=42_strona_2");
    expect((await src.fetchPage("https://funnel.test/#capture=42_strona_2")).body).toContain("RAW-PRODUCT");
    expect((await src.fetchPage("https://funnel.test/#capture=42_strona_3")).body).toContain("RAW-WHITE");
  });

  it("takes the host of a page saved from disk from the other captures of the case, never from a third-party frame or an outbound link", async () => {
    expect(byId("42_strona_1")!.landing_url).toBe("https://funnel.test/");
    const prov = JSON.parse(readFileSync(path.join(outDir, "provenance.json"), "utf8")) as { cases: Array<{ id: string; landingInferred: boolean; bodySource: string }> };
    expect(prov.cases.find((c) => c.id === "42_strona_1")).toMatchObject({ landingInferred: true, bodySource: "saved-html" });
  });

  it("reads a capture bundle in a sub-folder and merges it with the saved copy of the same page", async () => {
    const r = records().filter((x) => x.id === "11" || x.case === "11");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "11", landing_url: "https://pill.test/?land_id=1&key=k1", first_seen: "2026-01-12T09:30:03.000Z" });
    expect(String(r[0].screenshot)).toMatch(/IMG_0101\.PNG$/);
    expect((r[0].more_screenshots as string[]).map((p) => path.basename(p))).toEqual(["IMG_0102.PNG", "IMG_0103.PNG"]);
    expect(String(r[0].video)).toMatch(/ScreenRecording\.MP4$/);
    // the page's own video, stitched from its HLS segments in playlist order, is a further video of the case
    const more = r[0].more_videos as string[];
    expect(more.map((p) => path.basename(p))).toEqual(["11-wideo-strony.ts"]);
    expect(readFileSync(more[0])).toEqual(Buffer.concat([tsSegment(1), tsSegment(2)]));
    expect(JSON.parse(readFileSync(path.join(outDir, "mapping.json"), "utf8"))).toMatchObject({ extraVideoPaths: "more_videos" });
    const src = fixtureSources(path.join(outDir, "fixtures"));
    expect((await src.fetchPage("https://pill.test/?key=k1&land_id=1")).body).toContain("RAW-PILL");
    expect((await src.dns("pill.test", ["A"])).a).toEqual(["203.0.113.14"]);
  });

  it("uses a HAR filed in another case when it holds exactly the address of the saved page", async () => {
    const src = fixtureSources(path.join(outDir, "fixtures"));
    expect((await src.fetchPage("https://clone.test/L1/?clickid=abc")).body).toContain("RAW-THREE");
    expect((await src.fetchPage("https://two.test/")).body).toContain("RAW-TWO");
    expect(records().map((r) => r.id)).toEqual(["1", "4", "7", "11", "42_strona_1", "42_strona_2", "42_strona_3"]);
    const prov = JSON.parse(readFileSync(path.join(outDir, "provenance.json"), "utf8")) as { cases: Array<{ id: string; harFromCase: string | null }> };
    expect(prov.cases.find((c) => c.id === "4")!.harFromCase).toBe("1");
  });
});

describe("importCases: a HAR without the document body (request list of a scan)", () => {
  let dir: string;
  const TENANT = "3c9e1f20-7a4b-4d6e-9f81-2b5c0d7e4a19";
  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "case-import-requests-"));
    const c = path.join(dir, "cases", "scan-1");
    mkdirSync(c, { recursive: true });
    const req = (url: string, type: string, mime: string) => ({ _resourceType: type, request: { method: "GET", url }, response: { status: 200, content: { mimeType: mime } } });
    writeFileSync(
      path.join(c, "scan.har"),
      JSON.stringify({
        log: {
          pages: [{ title: "https://lander-skan.example/oferta/" }],
          entries: [
            req("https://lander-skan.example/oferta/", "document", "text/html"),
            req(`https://cdn.example/_cdn/production/landing-cdn/${TENANT}/5d2a8c1e-0b7f-4e93-a6d4-1f8e2c9b7a30/app.js`, "script", "application/javascript"),
            req("https://lander-skan.example/include/events-stat.js", "script", "application/javascript"),
          ],
        },
      }),
    );
    await importCases({ casesDir: path.join(dir, "cases"), outDir: path.join(dir, "out") });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps the page with an empty body and records its requests for the page kit", async () => {
    const records = JSON.parse(readFileSync(path.join(dir, "out", "input.json"), "utf8")) as Array<Record<string, unknown>>;
    expect(records.map((r) => [r.id, r.landing_url])).toEqual([["scan-1", "https://lander-skan.example/oferta/"]]);
    const src = fixtureSources(path.join(dir, "out", "fixtures"));
    const reqs = src.requestsFor?.("https://lander-skan.example/oferta/") ?? [];
    expect(reqs).toHaveLength(3);
    expect(reqs.some((u) => u.includes(`/landing-cdn/${TENANT}/`))).toBe(true);
  });
});

describe("importCases: folders collected from public sources (scan service, web archive, press)", () => {
  let dir: string;
  const casesDir = () => path.join(dir, "cases");
  const outDir = () => path.join(dir, "out");
  const LANDER = "7b1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
  const TARGET = `https://lander-skan.example/landers/${LANDER}/?clickid=c0ffee12&key=0123456789abcdef0123456789abcdef&fbclid=IwAR0test&utm_source=fb`;
  const LABELS = { rodzina: "RODZINA-ZNACZNIK", odcisk: "ODCISK-ZNACZNIK", pewnosc: "PEWNOSC-ZNACZNIK", uwagi: "UWAGI-ZNACZNIK" };
  const SOURCES = [{ url: "https://skaner.example/result/0001/", typ: "urlscan", data_wpisu: "2026-01-15T09:10:00Z", data_dostepu: "2026-01-20" }];
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 7, 7, 7]);
  type Prov = { cases: Array<Record<string, unknown> & { id: string }> };
  const prov = () => JSON.parse(readFileSync(path.join(outDir(), "provenance.json"), "utf8")) as Prov;
  const records = () => JSON.parse(readFileSync(path.join(outDir(), "input.json"), "utf8")) as Array<Record<string, unknown>>;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "case-import-collected-"));
    // scan-service layout: the service's own result page, a HAR rebuilt from its request list, the search record, its screenshot of the page
    const s = path.join(casesDir(), "skan-1");
    mkdirSync(s, { recursive: true });
    writeFileSync(path.join(s, "zrodlo.json"), JSON.stringify({ cel: TARGET, zrodla: SOURCES, ...LABELS, pliki: {} }));
    writeFileSync(path.join(s, "urlscan_wynik.html"), `<html><head><title>Wynik skanu</title></head><body>${'<a href="https://lander-skan.example/">x</a>'.repeat(5)}</body></html>`);
    const req = (url: string, type: string, hash: string) => ({
      _resourceType: type,
      _urlscan_hash: hash,
      startedDateTime: "2026-01-15T09:10:00.000Z",
      serverIPAddress: "192.0.2.10",
      request: { method: "GET", url },
      response: { status: 200, headers: [{ name: "server", value: "nginx" }], content: {} },
    });
    writeFileSync(
      path.join(s, "zadania_urlscan.har"),
      JSON.stringify({
        log: {
          pages: [{ title: "" }],
          entries: [
            req(TARGET, "document", "a".repeat(64)),
            req(`https://cdn.example/_cdn/production/landing-cdn/${LANDER}/app.js`, "script", "b".repeat(64)),
            req("https://tracker.example/click?key=0123456789abcdef0123456789abcdef", "xhr", "c".repeat(64)),
          ],
        },
      }),
    );
    writeFileSync(
      path.join(s, "urlscan_rekord.json"),
      JSON.stringify({ page: { ip: "192.0.2.10", asn: "AS64500", asnname: "TESTNET-AS, ZZ", server: "nginx", tlsIssuer: "Test CA", domainAgeDays: 3, title: "Tytuł strony" } }),
    );
    writeFileSync(path.join(s, "zrzut_urlscan.png"), PNG);
    // web-archive copy: the archived body, the capture index and the address
    const w = path.join(casesDir(), "archiwum-1");
    mkdirSync(w, { recursive: true });
    writeFileSync(path.join(w, "zrodlo.json"), JSON.stringify({ cel: "archiwum.example", zrodla: [], ...LABELS }));
    writeFileSync(path.join(w, "wayback_20260115093000.html"), '<html><head><title>Kopia</title><script src="/web/20260115093000js_/https://archiwum.example/app.js"></script></head><body>ARCHIVED-BODY</body></html>');
    writeFileSync(path.join(w, "wayback_cdx.json"), JSON.stringify({ wiersze: [] }));
    // press folder: an article about the scam (not the landing page), images named by role, registry data from the collection date
    const p = path.join(casesDir(), "prasa-1");
    mkdirSync(p, { recursive: true });
    writeFileSync(path.join(p, "zrodlo.json"), JSON.stringify({ cel: "prasa-lander.example", zrodla: [], ...LABELS }));
    writeFileSync(path.join(p, "artykul_prasowy.html"), '<html><head><title>Artykuł</title></head><body><a href="https://prasa-lander.example/">lander</a></body></html>');
    writeFileSync(path.join(p, "reklama_fb_zrzut.png"), PNG);
    writeFileSync(path.join(p, "lander_zrzut.jpg"), PNG);
    writeFileSync(path.join(p, "formularz_zrzut.jpg"), PNG);
    writeFileSync(
      path.join(p, "rdap_dns.json"),
      JSON.stringify({
        domena: "prasa-lander.example",
        dostep: "2026-01-20T10:00:00Z",
        utworzona: "2026-01-10T18:19:13Z",
        wygasa: "2027-01-10T18:19:13Z",
        rejestrator: ["Test Registrar IANA:9999"],
        status: ["client transfer prohibited"],
        ns: ["ns1.dns.example.", "ns2.dns.example."],
        a: ["192.0.2.44"],
      }),
    );
    await importCases({ casesDir: casesDir(), outDir: outDir() });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("scan service: keeps the full target address (path, click id, key, fbclid, utm) instead of the host of the result page", () => {
    const rec = records().find((r) => r.id === "skan-1")!;
    expect(rec.landing_url).toBe(TARGET);
    expect(rec.first_seen).toBe("2026-01-15T09:10:00.000Z");
    const src = fixtureSources(path.join(outDir(), "fixtures"));
    const key = new URL(TARGET);
    key.searchParams.delete("fbclid");
    key.searchParams.delete("utm_source");
    key.searchParams.sort();
    const reqs = src.requestsFor?.(key.toString()) ?? [];
    expect(reqs.some((u) => u.includes(`/landing-cdn/${LANDER}/`))).toBe(true);
    expect(prov().cases.find((c) => c.id === "skan-1")).toMatchObject({ bodySource: "har", landingInferred: false, savedHtml: null });
  });

  it("scan service: the service's screenshot is a page screenshot, not an ad screenshot (no OCR of the advertiser, no creative hash)", () => {
    const rec = records().find((r) => r.id === "skan-1")!;
    expect(rec.screenshot).toBeNull();
    expect(rec.more_screenshots).toBeUndefined();
    expect(prov().cases.find((c) => c.id === "skan-1")!.pageScreenshots).toEqual([path.join(casesDir(), "skan-1", "zrzut_urlscan.png")]);
  });

  it("scan service: the search record is page metadata (IP, ASN, server, TLS issuer, domain age, title)", async () => {
    expect(prov().cases.find((c) => c.id === "skan-1")!.scan).toEqual({ ip: "192.0.2.10", asn: "AS64500", asnName: "TESTNET-AS, ZZ", server: "nginx", tlsIssuer: "Test CA", domainAgeDays: 3, title: "Tytuł strony" });
    const asn = await fixtureSources(path.join(outDir(), "fixtures")).asn("192.0.2.10");
    expect(asn?.asn).toBe(64500);
  });

  it("never carries the label fields of the source file into the material; public sources go to provenance.json", () => {
    const files = ["input.json", "mapping.json", "fixtures/http.json", "fixtures/dns.json"].map((f) => readFileSync(path.join(outDir(), f), "utf8")).join("\n");
    for (const v of Object.values(LABELS)) expect(files).not.toContain(v);
    const p = prov();
    expect(JSON.stringify(p.cases)).not.toContain(LABELS.rodzina);
    expect(p.cases.find((c) => c.id === "skan-1")!.sources).toEqual(SOURCES);
  });

  it("web archive: the address from the source file, the capture time from the file name, the archived body as the page", async () => {
    const rec = records().find((r) => r.id === "archiwum-1")!;
    expect(rec.landing_url).toBe("https://archiwum.example/");
    expect(rec.first_seen).toBe("2026-01-15T09:30:00.000Z");
    expect(prov().cases.find((c) => c.id === "archiwum-1")).toMatchObject({ bodySource: "wayback", landingInferred: false });
    const page = await fixtureSources(path.join(outDir(), "fixtures")).fetchPage("https://archiwum.example/");
    const body = page.body?.toString() ?? "";
    expect(body).toContain("ARCHIVED-BODY");
    expect(body).toContain('src="https://archiwum.example/app.js"');
  });

  it("press folder: image roles from the names, the article is not the landing page, registry data from the collection date", async () => {
    const rec = records().find((r) => r.id === "prasa-1")!;
    expect(rec.landing_url).toBe("https://prasa-lander.example/");
    expect(rec.screenshot).toBe(path.join(casesDir(), "prasa-1", "reklama_fb_zrzut.png"));
    const c = prov().cases.find((x) => x.id === "prasa-1")!;
    expect(c).toMatchObject({ bodySource: "none", savedHtml: null });
    expect(c.pageScreenshots).toEqual(["formularz_zrzut.jpg", "lander_zrzut.jpg"].map((f) => path.join(casesDir(), "prasa-1", f)));
    const src = fixtureSources(path.join(outDir(), "fixtures"));
    expect((await src.dns("prasa-lander.example", ["NS"])).ns).toEqual(["ns1.dns.example", "ns2.dns.example"]);
    expect((await src.dns("prasa-lander.example", ["A"])).a).toEqual(["192.0.2.44"]);
    const rdap = await src.rdap("prasa-lander.example");
    expect(rdap?.created?.slice(0, 10)).toBe("2026-01-10");
    expect(rdap?.registrar).toContain("Test Registrar");
  });
});

describe("importCases: HAR entries of an earlier page in the same browser session (B-211)", () => {
  let dir: string;
  const at = (s: number) => `2026-02-01T10:00:${String(s).padStart(2, "0")}.000Z`;
  const PAGE = "https://lander-sesja.example/oferta/";

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "case-import-session-"));
    const c = path.join(dir, "cases", "sesja-1");
    mkdirSync(c, { recursive: true });
    const redirect = { ...entry("https://trk-sesja.example/go?k=1", "document", "", "text/html", "192.0.2.50", at(4)), response: { status: 302, headers: [{ name: "Location", value: PAGE }], content: {} } };
    writeFileSync(
      path.join(c, "sesja.har"),
      JSON.stringify({
        log: {
          pages: [{ title: PAGE }],
          entries: [
            entry("https://inna-strona.example/", "document", "<html>INNA</html>", "text/html", "192.0.2.201", at(0)),
            entry("https://cdn.inna-strona.example/app.js", "script", "x", "application/javascript", "192.0.2.202", at(1)),
            entry("https://inna-strona.example/logo.png", "image", ICON, "image/png", "192.0.2.201", at(2)),
            redirect,
            entry(PAGE, "document", "<html><body>OFERTA</body></html>", "text/html", "192.0.2.60", at(5)),
            entry("https://lander-sesja.example/app.js", "script", "y", "application/javascript", "192.0.2.60", at(6)),
          ],
        },
      }),
    );
    await importCases({ casesDir: path.join(dir, "cases"), outDir: path.join(dir, "out") });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("drops hosts, IPs, requests and images recorded before the page's document, keeping its redirect", async () => {
    const src = fixtureSources(path.join(dir, "out", "fixtures"));
    const reqs = src.requestsFor?.(PAGE) ?? [];
    expect(reqs.some((u) => u.includes("inna-strona.example"))).toBe(false);
    expect(reqs).toContain("https://lander-sesja.example/app.js");
    expect((await src.dns("inna-strona.example", ["A"])).a ?? []).toEqual([]);
    expect((await src.dns("cdn.inna-strona.example", ["A"])).a ?? []).toEqual([]);
    expect(reqs).toContain("https://trk-sesja.example/go?k=1");
    expect((await src.dns("lander-sesja.example", ["A"])).a).toEqual(["192.0.2.60"]);
    expect(await src.fetchBinary("https://inna-strona.example/logo.png")).toBeNull();
  });
});

describe("importCases: requests of the analyst's browser extensions (B-116)", () => {
  let dir: string;
  const PAGE = "https://lander-rozszerzenie.example/";

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "case-import-ext-"));
    const c = path.join(dir, "cases", "ext-1");
    mkdirSync(c, { recursive: true });
    const fromExtension = { ...entry("https://api.rozszerzenie-analityka.example/check?u=1", "xhr", "{}", "application/json", "192.0.2.90", "2026-02-01T10:00:02.000Z"), _initiator: { type: "script", stack: { callFrames: [{ url: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/content.js" }] } } };
    const fromPage = { ...entry("https://trk.przyklad.test/event", "xhr", "{}", "application/json", "192.0.2.91", "2026-02-01T10:00:03.000Z"), _initiator: { type: "script", stack: { callFrames: [{ url: PAGE }] } } };
    writeFileSync(
      path.join(c, "ext.har"),
      JSON.stringify({ log: { pages: [{ title: PAGE }], entries: [entry(PAGE, "document", "<html><body>STRONA</body></html>", "text/html", "192.0.2.80", "2026-02-01T10:00:01.000Z"), fromExtension, fromPage] } }),
    );
    await importCases({ casesDir: path.join(dir, "cases"), outDir: path.join(dir, "out") });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("drops a request initiated by a browser extension and keeps the page's own", () => {
    const reqs = fixtureSources(path.join(dir, "out", "fixtures")).requestsFor?.(PAGE) ?? [];
    expect(reqs.some((u) => u.includes("rozszerzenie-analityka"))).toBe(false);
    expect(reqs).toContain("https://trk.przyklad.test/event");
  });
});

describe("importCases: certificate of the page from the HAR", () => {
  let dir: string;
  const PAGE = "https://lander-certyfikat.example/";

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "case-import-tls-"));
    const c = path.join(dir, "cases", "tls-1");
    mkdirSync(c, { recursive: true });
    const main = { ...entry(PAGE, "document", "<html><body>STRONA</body></html>", "text/html", "192.0.2.80", "2026-02-01T10:00:01.000Z"), _securityDetails: { issuer: "Test CA", subjectName: "inny.test", sanList: ["inny.test"], validFrom: 1769904000, validTo: 1772496000 } };
    writeFileSync(path.join(c, "tls.har"), JSON.stringify({ log: { pages: [{ title: PAGE }], entries: [main] } }));
    await importCases({ casesDir: path.join(dir, "cases"), outDir: path.join(dir, "out") });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps the issuer, names and validity of the document's certificate as a fixture of the page", () => {
    const tls = fixtureSources(path.join(dir, "out", "fixtures")).tlsFor?.(PAGE);
    expect(tls).toEqual({ issuer: "Test CA", validFrom: 1769904000, validTo: 1772496000, sanList: ["inny.test"], subjectName: "inny.test" });
  });
});

describe("importCases: a page video saved as HLS", () => {
  it("is the video of a case that has no other recording", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "case-hls-"));
    try {
      const media = path.join(dir, "cases", "vsl", "resources", "media");
      mkdirSync(media, { recursive: true });
      writeFileSync(path.join(media, "output_000.ts"), tsSegment(3));
      writeFileSync(path.join(media, "output_001.ts"), tsSegment(4));
      // a TypeScript source with the same extension is not a video segment
      writeFileSync(path.join(dir, "cases", "vsl", "notatka.ts"), "export const x = 1;\n");
      await importCases({ casesDir: path.join(dir, "cases"), outDir: path.join(dir, "out") });
      const [rec] = JSON.parse(readFileSync(path.join(dir, "out", "input.json"), "utf8")) as Array<Record<string, unknown>>;
      expect(rec).toMatchObject({ id: "vsl" });
      expect(readFileSync(String(rec.video))).toEqual(Buffer.concat([tsSegment(3), tsSegment(4)]));
      expect(rec.more_videos).toBeUndefined();
      const prov = JSON.parse(readFileSync(path.join(dir, "out", "provenance.json"), "utf8")) as { cases: Array<{ files: Array<{ role: string }> }> };
      expect(prov.cases[0].files.map((f) => f.role)).toContain("page_video");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Known defect found by the final test gate (I19), left for the owner's decision: the visitor record of a
 * landing-page platform also holds the page's own domain and the lander id, which are the operator's data, not
 * the analyst's. The redaction on reading removes every key of the record but the campaign number and then
 * replaces each removed value in the whole page, the "saved from url" comment included, so the page loses its
 * address and the case is dropped. `it.fails` until the redaction keeps such values.
 */
describe("importCases: saved page whose visitor record holds the page's domain and lander id (known defect)", () => {
  let dir: string;
  let result: Awaited<ReturnType<typeof importCases>>;
  const UUID = "33333333-3333-4333-8333-333333333333";
  const PAGE = `https://lander-wizyta.example/landers/${UUID}/`;
  const AIO = JSON.stringify({ visit: { domain: "lander-wizyta.example", uuid: UUID, ip_address: "192.0.2.44", campaign_human_id: 5 } });

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "case-import-visit-"));
    const c = path.join(dir, "cases", "wizyta-1");
    mkdirSync(c, { recursive: true });
    writeFileSync(path.join(c, "Oferta.html"), `<!-- saved from url=(${String(PAGE.length).padStart(4, "0")})${PAGE} -->\n<html><script>window.aio = JSON.parse('${AIO}');</script><body>STRONA</body></html>`);
    result = await importCases({ casesDir: path.join(dir, "cases"), outDir: path.join(dir, "out") });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.fails("keeps the case with its address and removes only the analyst's IP", () => {
    expect(result.skipped).toEqual([]);
    const records = JSON.parse(readFileSync(path.join(dir, "out", "input.json"), "utf8"));
    expect(records.map((r: { landing_url: string }) => r.landing_url)).toEqual([PAGE]);
    expect(readFileSync(path.join(dir, "out", "input.json"), "utf8")).not.toContain("192.0.2.44");
  });
});
