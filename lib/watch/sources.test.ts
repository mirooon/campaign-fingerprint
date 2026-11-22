import { describe, expect, it } from "vitest";
import type { AdLibrarySource, AdRecord } from "../adlib/types";
import type { CtStreamEvent } from "../ct/stream";
import { buildFingerprints } from "../ct/fingerprint";
import { DEFAULT_CT_CONFIG } from "../ct/config";
import { ArchiveLookupError } from "../osint/archive/http";
import type { UrlscanScan } from "../osint/archive/urlscan";
import type { CampaignsFile } from "../graph/model";
import { parseRecipes, type WatchRecipe } from "./recipes";
import { createAdlibWatchSource, createCertlistWatchSource, createCtWatchSource, createUrlscanWatchSource } from "./sources";

const NOW = new Date("2026-11-22T10:00:00Z");
const recipesOf = (json: unknown[]): WatchRecipe[] => parseRecipes(json);

const scan = (id: string, url: string, tenant?: string): UrlscanScan => ({
  id,
  url,
  sourceUrl: `https://urlscan.test/result/${id}/`,
  capturedAt: "2026-11-21T10:00:00.000Z",
  meta: {},
  ...(tenant ? { requests: [{ url: `https://cdn.test/landing-cdn/${tenant}/main.js` }] } : {}),
});

describe("źródło urlscan", () => {
  it("każdy przepis to zapytanie, każdy skan to trafienie z przepisem", async () => {
    const asked: string[] = [];
    const src = createUrlscanWatchSource({
      searcher: { available: async () => ({ ok: true }), searchScans: async (q) => (asked.push(q), [scan("1", "https://a.test/x"), scan("2", "https://b.test/")]) },
    });
    const recipes = recipesOf([{ id: "r1", source: "urlscan", query: "domain:a.test" }]);
    const res = await src.poll({ now: NOW, recipes });
    expect(asked).toEqual(["domain:a.test"]);
    expect(res.hits.map((h) => [h.url, h.recipe])).toEqual([["https://a.test/x", "r1"], ["https://b.test/", "r1"]]);
  });

  it("ekstraktor cechy ze skanu zostawia tylko wartości z listy alarmowej i opisuje je w potwierdzeniu", async () => {
    const src = createUrlscanWatchSource({
      searcher: {
        available: async () => ({ ok: true }),
        searchScans: async () => [scan("1", "https://a.test/", "tenant-aaa"), scan("2", "https://b.test/", "tenant-zzz"), scan("3", "https://c.test/")],
      },
    });
    const recipes = recipesOf([{ id: "najemca", source: "urlscan", query: "x", feature: { name: "najemca", regex: "landing-cdn/([a-z-]+)/", alarm: ["tenant-aaa"] } }]);
    const res = await src.poll({ now: NOW, recipes });
    expect(res.hits.map((h) => [h.url, h.confirmations])).toEqual([["https://a.test/", ["najemca: tenant-aaa"]]]);
  });

  it("bez sieci albo klucza pomija z powodem, a limit w trakcie zwraca to, co już jest, i powód", async () => {
    const recipes = recipesOf([{ id: "r1", source: "urlscan", query: "x" }, { id: "r2", source: "urlscan", query: "y" }]);
    const down = createUrlscanWatchSource({ searcher: { available: async () => ({ ok: false, reason: "limit zapytań urlscan", howToGetAccess: "klucz API" }), searchScans: async () => [] } });
    expect((await down.poll({ now: NOW, recipes })).skipped).toContain("limit zapytań urlscan");
    let n = 0;
    const limited = createUrlscanWatchSource({
      searcher: {
        available: async () => ({ ok: true }),
        searchScans: async () => {
          if (n++) throw new ArchiveLookupError("urlscan", "limit (HTTP 429)", 60);
          return [scan("1", "https://a.test/")];
        },
      },
    });
    const res = await limited.poll({ now: NOW, recipes });
    expect(res.hits).toHaveLength(1);
    expect(res.skipped).toBe("przepis r2: limit (HTTP 429)");
  });
});

describe("źródło Lista Ostrzeżeń CERT", () => {
  const recipes = recipesOf([{ id: "seria", source: "certlist", query: "^smart[a-z]+\\.test$", confirm: { registrars: ["Registrar Jeden"], nameserverPairs: [["ns1.test", "ns2.test"]] } }]);
  const facts: Record<string, { registrar: string | null; created: string | null; nameservers: string[] }> = {
    "smartone.test": { registrar: "Registrar Jeden Ltd", created: "2026-11-21T18:20:00Z", nameservers: ["ns1.test", "ns2.test"] },
    "smarttwo.test": { registrar: "Inny Rejestrator", created: "2026-11-21T18:20:00Z", nameservers: ["ns1.test", "ns2.test"] },
  };
  const make = (lists: string[][]) => {
    let stored: Set<string> | null = null;
    let i = 0;
    return createCertlistWatchSource({
      fetchList: async () => ({ domains: lists[i++] }),
      snapshot: { load: async () => stored, save: async (d) => void (stored = d) },
      facts: async (d) => facts[d] ?? null,
    });
  };

  it("pierwszy przebieg zapisuje stan, drugi daje różnicę przefiltrowaną regexem i RDAP/NS (inny rejestrator odpada)", async () => {
    const src = make([["old.test"], ["old.test", "smartone.test", "smarttwo.test", "unrelated.test"]]);
    const first = await src.poll({ now: NOW, recipes });
    expect(first.hits).toEqual([]);
    expect(first.skipped).toContain("pierwszy przebieg");
    const second = await src.poll({ now: NOW, recipes });
    expect(second.hits.map((h) => h.url)).toEqual(["https://smartone.test/"]);
    expect(second.hits[0].confirmations).toEqual(["ten sam rejestrator (Registrar Jeden Ltd)", "ta sama para serwerów nazw (ns1.test, ns2.test)"]);
  });

  it("domena bez odpowiedzi RDAP nie przechodzi, a lista, której nie pobrano, jest pominięta z powodem", async () => {
    const src = make([["a.test"], ["a.test", "smartnone.test"]]);
    await src.poll({ now: NOW, recipes });
    expect((await src.poll({ now: NOW, recipes })).hits).toEqual([]);
    const broken = createCertlistWatchSource({ fetchList: async () => ({ error: "brak sieci: hole.cert.pl" }), snapshot: { load: async () => null, save: async () => {} }, facts: async () => null });
    expect((await broken.poll({ now: NOW, recipes })).skipped).toBe("brak sieci: hole.cert.pl");
  });
});

describe("źródło bibliotek reklam", () => {
  const ad = (id: string, landing?: string): AdRecord => ({ platform: "meta", adId: id, libraryUrl: `https://lib.test/?id=${id}`, fetchedAt: NOW.toISOString(), creatives: [], ...(landing ? { landingUrl: landing } : {}) });
  const lib = (ok: boolean, records: AdRecord[]): AdLibrarySource => ({
    platform: "meta",
    available: async () => (ok ? { ok } : { ok, reason: "brak klucza", howToGetAccess: "wniosek" }),
    search: async () => records,
    getAd: async () => null,
  });
  const recipes = recipesOf([{ id: "slowo", source: "adlibrary", query: "inwestycja" }]);

  it("reklama to trafienie pod adresem strony docelowej, a bez niego pod adresem biblioteki; rekord idzie z trafieniem", async () => {
    const src = createAdlibWatchSource({ sources: { meta: lib(true, [ad("1", "https://promo.test/"), ad("2")]) } });
    const res = await src.poll({ now: NOW, recipes });
    expect(res.hits.map((h) => h.url)).toEqual(["https://promo.test/", "https://lib.test/?id=2"]);
    expect(res.hits[0].adRecord?.adId).toBe("1");
  });

  it("bez dostępnej biblioteki pomija z powodem", async () => {
    const src = createAdlibWatchSource({ sources: { meta: lib(false, []) } });
    expect((await src.poll({ now: NOW, recipes })).skipped).toBe("meta: brak klucza");
  });
});

describe("źródło CT", () => {
  const campaigns = {
    version: 1,
    generatedAt: "",
    method: { unionFind: "", louvain: { resolution: 1, seed: 1, modularity: null }, minLinkScore: 0 },
    assignments: {},
    campaigns: [{ id: "K01", size: 2, members: [], firstSeen: null, lastSeen: null, topEvidence: [], domains: ["finance12-dolorem51.example", "finance88-quia40.example"], advertisers: [], cohesion: 1, strongComponents: 1, attributes: { personas: [], cyrillic: 0 } }],
  } as unknown as CampaignsFile;
  const set = buildFingerprints(campaigns, { config: { ...DEFAULT_CT_CONFIG } });
  const event = (...domains: string[]): CtStreamEvent => ({ domains, seenUtc: null, issuer: null, notBefore: null, notAfter: null, fingerprint: null, serial: null, logName: null, logUrl: null, certIndex: null, updateType: null });

  it("domena pasująca do odcisku kampanii jest trafieniem z kampanią jako podpowiedzią; inna nie", async () => {
    const src = createCtWatchSource({ set, source: "replay", collect: async () => ({ events: [event("finance23-voluptas94.example"), event("zwykla-strona.test")] }) });
    const res = await src.poll({ now: NOW, recipes: [] });
    expect(res.hits.map((h) => [h.url, h.campaignHint])).toEqual([["https://finance23-voluptas94.example/", "K01"]]);
  });

  it("przepis CT dodaje wzorzec nazw, a brak strumienia to pominięcie z powodem", async () => {
    const recipes = recipesOf([{ id: "wzorzec", source: "ct", query: "^zwykla" }]);
    const src = createCtWatchSource({ set, source: "replay", collect: async () => ({ events: [event("zwykla-strona.test", "www.zwykla-strona.test")] }) });
    expect((await src.poll({ now: NOW, recipes })).hits.map((h) => [h.url, h.recipe])).toEqual([["https://zwykla-strona.test/", "wzorzec"]]);
    const none = createCtWatchSource({ set, source: "certstream", collect: async () => ({ events: [], skipped: "żaden strumień CT nie odpowiada" }) });
    expect((await none.poll({ now: NOW, recipes })).skipped).toBe("żaden strumień CT nie odpowiada");
  });
});

describe("format przepisów", () => {
  it("lista CERT bez filtra confirm jest błędem, tak samo zły regex i powtórzony identyfikator", () => {
    expect(() => parseRecipes([{ id: "x", source: "certlist", query: "a" }])).toThrow(/confirm/);
    expect(() => parseRecipes([{ id: "x", source: "ct", query: "(" }])).toThrow(/regex/);
    expect(() => parseRecipes([{ id: "x", source: "ct", query: "a" }, { id: "x", source: "ct", query: "b" }])).toThrow(/powtórzony/);
  });
});
