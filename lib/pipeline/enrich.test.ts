import { describe, expect, it } from "vitest";
import type { ArchivedCopy, ArchiveSource } from "../osint/archive";
import type { FetchPageResult } from "../osint/fetchPage";
import { enrichItems } from "./enrich";
import type { EnrichmentSources } from "./sources";
import type { Item } from "./types";

/** Live sources that record the requested page addresses and answer with an empty page. */
function recordingLive(requested: string[]): EnrichmentSources {
  const page = (url: string): FetchPageResult => ({
    requestedUrl: url,
    finalUrl: url,
    status: 200,
    ok: true,
    redirectChain: [],
    contentType: "text/html",
    headers: {},
    bytes: 0,
    truncated: false,
    body: "<html><body>x</body></html>",
    bodySha256: null,
    userAgent: "test",
    remoteAddress: null,
    error: null,
    errorCode: null,
    fetchedAt: "2026-01-15T00:00:00.000Z",
    durationMs: 0,
  });
  return {
    mode: "live",
    fetchPage: async (url) => {
      requested.push(url);
      return page(url);
    },
    fetchBinary: async () => null,
    dns: async (name) => ({ name, a: [], aaaa: [], cname: [], ns: [], mx: [], txt: [], errors: {} }) as unknown as Awaited<ReturnType<EnrichmentSources["dns"]>>,
    rdap: async () => null,
    ct: async () => null,
    asn: async () => null,
  };
}

describe("enrichItems: the landing page in live mode", () => {
  it("requests the full address with fbclid and utm_* (many scam pages answer only to it), keyed by the normalised address", async () => {
    const url = "https://lp.example/landers/x/?clickid=c1&fbclid=IwAR0&utm_source=fb";
    const item: Item = { id: "m1", platform: null, advertiser: null, text: null, imageUrl: null, imagePath: null, landingUrl: url, firstSeen: null, lastSeen: null, label: null, persona: null, deepfakeScore: null, videoPath: null, extra: {} };
    const requested: string[] = [];
    const out = await enrichItems([item], { sources: recordingLive(requested), baseDir: "." });
    expect(requested[0]).toBe(url);
    expect(out.perItem.m1.pageKey).toBe("https://lp.example/landers/x/?clickid=c1");
    expect(Object.keys(out.pages)).toEqual(["https://lp.example/landers/x/?clickid=c1"]);
  });
});

/** Live sources whose page does not answer (network error); RDAP gives `created` when asked for it. */
function deadLive(opts: { created?: string; status?: number; body?: string; errorCode?: FetchPageResult["errorCode"] } = {}): EnrichmentSources {
  const live = recordingLive([]);
  const failed = opts.status === undefined && opts.body === undefined;
  return {
    ...live,
    fetchPage: async (url) => ({
      requestedUrl: url,
      finalUrl: url,
      status: failed ? null : (opts.status ?? 200),
      ok: !failed && (opts.status ?? 200) < 400,
      redirectChain: [],
      contentType: failed ? null : "text/html",
      headers: {},
      bytes: 0,
      truncated: false,
      body: opts.body ?? null,
      bodySha256: null,
      userAgent: "test",
      remoteAddress: null,
      error: failed ? "getaddrinfo ENOTFOUND" : null,
      errorCode: failed ? (opts.errorCode ?? "network") : null,
      fetchedAt: "2026-11-22T00:00:00.000Z",
      durationMs: 0,
    }),
    rdap: async (domain) => (opts.created ? ({ domain, registrar: null, registrarIanaId: null, created: opts.created, expires: null, updated: null, status: [], nameservers: [], abuseEmail: null, source: null }) : null),
  };
}

describe("enrichItems: domains of contact addresses", () => {
  it("looks up the domain of an e-mail address that is not the shop's own, once, and not a free mailbox or the shop's domain", async () => {
    const body = '<html><body><p>Kontakt: info@inny.test, biuro@sklep.example, kontakt@gmail.com</p></body></html>';
    const item: Item = { ...deadItem, landingUrl: "https://sklep.example/" };
    const asked: string[] = [];
    const sources = { ...deadLive({ status: 200, body }), rdap: async (domain: string) => (asked.push(domain), null) };
    const out = await enrichItems([item], { sources, baseDir: "." });
    expect(Object.keys(out.domains).sort()).toEqual(["inny.test", "sklep.example"]);
    expect(asked.filter((d) => d === "inny.test")).toHaveLength(1);
  });
});

describe("enrichItems: contact domain that serves no website", () => {
  const body = "<html><body><p>Kontakt: info@inny.test</p></body></html>";
  const item: Item = { ...deadItem, landingUrl: "https://sklep.example/" };
  const withMx = (answers: boolean): EnrichmentSources => {
    const base = deadLive({ status: 200, body });
    return {
      ...base,
      dns: async (name) => ({ name, a: [], aaaa: [], cname: [], ns: [], mx: name === "inny.test" ? ["mx.inny.test"] : [], txt: [], errors: {} }) as unknown as Awaited<ReturnType<EnrichmentSources["dns"]>>,
      fetchPage: async (url, o) => (url.includes("inny.test") && !answers ? (await deadLive().fetchPage(url, o)) : base.fetchPage(url, o)),
    };
  };
  it("marks a live-checked contact domain with MX records and no HTTP answer", async () => {
    const out = await enrichItems([item], { sources: withMx(false), baseDir: "." });
    expect(out.domains["inny.test"].contactDomainDead).toBe(true);
    expect(out.domains["sklep.example"].contactDomainDead).toBeUndefined();
  });
  it("leaves a contact domain that answers, and never asks in an offline run", async () => {
    expect((await enrichItems([item], { sources: withMx(true), baseDir: "." })).domains["inny.test"].contactDomainDead).toBeUndefined();
    const offline = { ...withMx(false), mode: "offline" as const };
    expect((await enrichItems([item], { sources: offline, baseDir: "." })).domains["inny.test"].contactDomainDead).toBeUndefined();
  });
});

function archiveSource(name: "urlscan" | "wayback", copies: ArchivedCopy[], calls: string[] = []): ArchiveSource {
  return { name, available: async () => ({ ok: true }), lookup: async (url) => (calls.push(url), copies) };
}

const deadItem: Item = { id: "m1", platform: null, advertiser: null, text: null, imageUrl: null, imagePath: null, landingUrl: "https://dead.example/lp/", firstSeen: "2026-10-20T00:00:00Z", lastSeen: null, label: null, persona: null, deepfakeScore: null, videoPath: null, extra: {} };
const waybackCopy = (capturedAt: string, extra: Partial<ArchivedCopy> = {}): ArchivedCopy => ({
  source: "wayback",
  url: "https://dead.example/lp/",
  sourceUrl: "https://web.archive.org/web/20261018020257/https://dead.example/lp/",
  capturedAt,
  fetchedAt: "2026-11-22T10:00:00.000Z",
  html: '<html><head><title>Archived Offer</title><script src="https://cdn.example/js/app.min.js"></script></head><body><form action="https://forms.example/send.php"></form></body></html>',
  ...extra,
});

describe("enrichItems: archive step", () => {
  it("feeds the features from a copy when the live page is dead, and keeps where it came from", async () => {
    const out = await enrichItems([deadItem], { sources: deadLive(), baseDir: ".", archive: { sources: [archiveSource("wayback", [waybackCopy("2026-10-18T02:02:57.000Z")])] } });
    const page = out.pages["https://dead.example/lp/"];
    expect(page.fetch.ok).toBe(false);
    expect(page.bodySource).toBe("wayback");
    expect(page.extract?.title).toBe("Archived Offer");
    expect(page.kit?.assets?.length).toBeGreaterThan(0);
    expect(page.archive).toMatchObject({ source: "wayback", sourceUrl: expect.stringContaining("web.archive.org"), capturedAt: "2026-10-18T02:02:57.000Z", used: true });
    expect((page.archive as Record<string, unknown>).html).toBeUndefined();
    expect(out.perItem.m1.archive).toEqual({ status: "used", detail: "copy from wayback of 2026-10-18" });
  });

  it("takes the request list of a urlscan copy without a DOM as the page's resources", async () => {
    const copy: ArchivedCopy = { ...waybackCopy("2026-10-19T00:00:00.000Z"), source: "urlscan", html: undefined, requests: [{ url: "https://dead.example/lp/", sha256: "1".repeat(64) }, { url: "https://cdn.example/js/app.min.js", sha256: "2".repeat(64) }] };
    const out = await enrichItems([deadItem], { sources: deadLive(), baseDir: ".", archive: { sources: [archiveSource("urlscan", [copy])] } });
    const page = out.pages["https://dead.example/lp/"];
    expect(page.bodySource).toBe("urlscan");
    expect(page.extract).toBeNull();
    expect(page.kit?.assets?.some((a) => a.key.includes("app.min.js"))).toBe(true);
    expect(page.archive?.requests).toHaveLength(2);
  });

  it("rejects a copy from before the registration: it is kept as information, gives no features and marks the domain re-registered", async () => {
    const out = await enrichItems([deadItem], { sources: deadLive({ created: "2026-09-10T00:00:00Z" }), baseDir: ".", archive: { sources: [archiveSource("wayback", [waybackCopy("2016-05-01T00:00:00.000Z")])] } });
    const page = out.pages["https://dead.example/lp/"];
    expect(page.extract).toBeNull();
    expect(page.kit).toBeNull();
    expect(page.bodySource).toBeUndefined();
    expect(page.archive).toMatchObject({ used: false, rejected: { reason: "copy made before the domain was registered" } });
    expect(out.domains["dead.example"].reRegistered).toBe(true);
    expect(out.perItem.m1.archive?.status).toBe("rejected");
  });

  it("checks the era of the domain with the archive's own RDAP lookup when the page sources have none (a run on saved files)", async () => {
    const rdap = async (domain: string) => ({ domain, registrar: null, registrarIanaId: null, created: "2026-09-10T00:00:00Z", expires: null, updated: null, status: [], nameservers: [], abuseEmail: null, source: null });
    const out = await enrichItems([deadItem], { sources: deadLive(), baseDir: ".", skip: { rdap: false }, archive: { sources: [archiveSource("wayback", [waybackCopy("2016-05-01T00:00:00.000Z")])], rdap } });
    expect(out.pages["https://dead.example/lp/"].archive).toMatchObject({ used: false, rejected: { reason: "copy made before the domain was registered" } });
    expect(out.domains["dead.example"].reRegistered).toBe(true);
  });

  it("does not ask the archives when the page was fetched", async () => {
    const calls: string[] = [];
    const out = await enrichItems([deadItem], { sources: deadLive({ status: 200, body: "<html><title>Live</title></html>" }), baseDir: ".", archive: { sources: [archiveSource("wayback", [waybackCopy("2026-10-18T00:00:00.000Z")], calls)] } });
    expect(calls).toEqual([]);
    expect(out.pages["https://dead.example/lp/"].archive).toBeUndefined();
    expect(out.perItem.m1.archive).toBeUndefined();
  });

  it("asks the archives for a page that answered with an error status or with a block page", async () => {
    for (const live of [deadLive({ status: 503, body: "" }), deadLive({ status: 200, body: "<html><title>This domain is parked</title></html>" })]) {
      const out = await enrichItems([deadItem], { sources: live, baseDir: ".", archive: { sources: [archiveSource("wayback", [waybackCopy("2026-10-18T00:00:00.000Z")])], isBlockPage: (t) => t.some((x) => /parked/i.test(x ?? "")) } });
      expect(out.pages["https://dead.example/lp/"].bodySource).toBe("wayback");
    }
  });

  it("leaves a dead page as it was when the step is not enabled", async () => {
    const out = await enrichItems([deadItem], { sources: deadLive(), baseDir: "." });
    expect(out.pages["https://dead.example/lp/"].bodySource).toBeUndefined();
    expect(out.perItem.m1.archive).toBeUndefined();
  });

  it("skips the step with the reason when the run is offline, and for an address that was refused", async () => {
    const calls: string[] = [];
    const src = archiveSource("wayback", [waybackCopy("2026-10-18T00:00:00.000Z")], calls);
    const off = await enrichItems([deadItem], { sources: deadLive(), baseDir: ".", archive: { sources: [src], skipReason: "tryb offline: bez zapytań sieciowych" } });
    expect(off.perItem.m1.archive).toEqual({ status: "skipped", detail: "tryb offline: bez zapytań sieciowych" });
    const refused = await enrichItems([deadItem], { sources: deadLive({ errorCode: "blocked" }), baseDir: ".", archive: { sources: [src] } });
    expect(refused.perItem.m1.archive?.status).toBe("skipped");
    expect(refused.perItem.m1.archive?.detail).toMatch(/URL/);
    expect(calls).toEqual([]);
  });

  it("says that there is neither a page nor a copy", async () => {
    const out = await enrichItems([deadItem], { sources: deadLive(), baseDir: ".", archive: { sources: [archiveSource("wayback", []), archiveSource("urlscan", [])] } });
    expect(out.perItem.m1.archive).toEqual({ status: "none", detail: "no archived copy (wayback, urlscan)" });
  });
});

describe("enrichItems: further videos of a record (the landing page's video)", () => {
  it("the voice step reads the windows of the record's own video and of its further videos", async () => {
    const item: Item = { id: "v1", platform: null, advertiser: null, text: null, imageUrl: null, imagePath: null, landingUrl: null, firstSeen: null, lastSeen: null, label: null, persona: null, deepfakeScore: null, videoPath: "/x/nagranie.mp4", extraVideoPaths: ["/x/wideo-strony.ts"], extra: {} };
    const asked: string[] = [];
    const win = (embedding: number[]) => ({ start: 0, end: 3, levelDb: -20, speech: 0.9, embedding });
    const out = await enrichItems([item], {
      sources: recordingLive([]),
      baseDir: "/",
      speaker: true,
      voiceIndex: { model: "test", persons: {} },
      voicesAdapter: async (files) => {
        asked.push(...files);
        return { "/x/nagranie.mp4": [win([1, 0])], "/x/wideo-strony.ts": [win([0, 1])] };
      },
    });
    expect(asked).toEqual(["/x/nagranie.mp4", "/x/wideo-strony.ts"]);
    expect(out.perItem.v1.voices?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("enrichItems: company registers (opt-in)", () => {
  const body = "<html><body><p>Fikcyjny Sklep Sp. z o.o., NIP 123-456-32-18</p></body></html>";
  const item: Item = { ...deadItem, landingUrl: "https://sklep.example/", firstSeen: "2026-10-01T00:00:00Z" };
  const answer = { result: { subject: { name: "ZUPEŁNIE INNA FIRMA SP. Z O.O.", statusVat: "Czynny", workingAddress: "ul. Testowa 1, 00-001 Miasto", registrationLegalDate: "2026-08-01", removalDate: null } } };

  it("asks the VAT white list for the NIP of the page only when the flag is on, and keeps no persons", async () => {
    const asked: string[] = [];
    const fetchImpl = async (url: string) => (asked.push(url), new Response(JSON.stringify({ ...answer, representatives: [{ lastName: "Nazwisko" }] })));
    const sources = deadLive({ status: 200, body });
    const off = await enrichItems([item], { sources, baseDir: "." });
    expect(off.perItem[deadItem.id].companyRegistry).toBeUndefined();
    const on = await enrichItems([item], { sources, baseDir: ".", companyRegistry: { fetchImpl, cache: false } });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("/api/search/nip/1234563218");
    expect(on.perItem[deadItem.id].companyRegistry?.[0]).toMatchObject({ source: "vat", id: "1234563218", found: true, name: "ZUPEŁNIE INNA FIRMA SP. Z O.O." });
    expect(JSON.stringify(on)).not.toContain("Nazwisko");
  });

  it("does not ask in offline mode", async () => {
    const asked: string[] = [];
    const sources = { ...deadLive({ status: 200, body }), mode: "offline" as const };
    await enrichItems([item], { sources, baseDir: ".", companyRegistry: { fetchImpl: async (u: string) => (asked.push(u), new Response("{}")), cache: false } });
    expect(asked).toEqual([]);
  });
});

describe("enrichItems: RDAP and DNS without an answer", () => {
  const body = "<html><body><p>Oferta</p></body></html>";
  const item: Item = { ...deadItem, landingUrl: "https://www.sklep.example/", text: "Zapisz się: https://formularz.test/zapis" };
  type Dns = Awaited<ReturnType<EnrichmentSources["dns"]>>;
  const answer = (name: string, errors: Dns["errors"] = {}): Dns => ({ name, a: [], aaaa: [], cname: [], ns: [], mx: [], txt: [], errors });
  /** Live sources: RDAP of formularz.test fails (no network), sklep.example has no record; DNS of www.sklep.example times out and NS/MX/TXT of formularz.test throws. */
  const failing = (): EnrichmentSources => ({
    ...deadLive({ status: 200, body }),
    rdap: async (domain) => {
      if (domain === "formularz.test") throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } });
      return null;
    },
    dns: async (name, types) => {
      if (name === "www.sklep.example") return answer(name, { A: "timeout", AAAA: "timeout" });
      if (name === "formularz.test" && types.includes("NS")) throw new Error("queryNs ECONNREFUSED formularz.test");
      return answer(name);
    },
  });

  it("puts each failure into the record's errors with the reason, and lists the failed lookups of its domains", async () => {
    const out = await enrichItems([item], { sources: failing(), baseDir: "." });
    const enr = out.perItem[item.id];
    expect(enr.errors).toEqual([
      "RDAP did not answer for formularz.test: no network connection",
      "DNS did not answer for formularz.test: no network connection",
      "DNS did not answer for www.sklep.example: A, AAAA: no answer within the time limit",
    ]);
    expect(enr.lookups).toEqual({ domains: ["formularz.test", "sklep.example"], failed: ["dns:formularz.test", "dns:sklep.example", "rdap:formularz.test"] });
    // a registry without a record (null) is data, not a failure; the run goes on past a DNS query that throws
    expect(enr.errors.some((e) => e.includes("RDAP did not answer for sklep.example"))).toBe(false);
    expect(out.domains["formularz.test"].rdap).toBeNull();
  });

  it("lists the looked-up domains without failures when everything answers, and nothing when RDAP and DNS are skipped", async () => {
    const ok = await enrichItems([item], { sources: deadLive({ status: 200, body }), baseDir: "." });
    expect(ok.perItem[item.id].lookups).toEqual({ domains: ["formularz.test", "sklep.example"], failed: [] });
    expect(ok.perItem[item.id].errors).toEqual([]);
    const skipped = await enrichItems([item], { sources: failing(), baseDir: ".", skip: { rdap: true, dns: true } });
    expect(skipped.perItem[item.id].lookups).toBeUndefined();
    expect(skipped.perItem[item.id].errors).toEqual([]);
  });
});
