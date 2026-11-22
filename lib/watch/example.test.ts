/**
 * The synthetic example recipes (data/examples/watch-przepisy.example.json) against recorded answers of every source:
 * each recipe yields a hit, and the registration filter drops a domain of another registrar.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AdLibrarySource, AdRecord } from "../adlib/types";
import { DEFAULT_CT_CONFIG } from "../ct/config";
import { buildFingerprints } from "../ct/fingerprint";
import type { CtStreamEvent } from "../ct/stream";
import type { CampaignsFile } from "../graph/model";
import type { UrlscanScan } from "../osint/archive/urlscan";
import { loadRecipes } from "./recipes";
import type { WatchHit, WatchSource } from "./schedule";
import { createAdlibWatchSource, createCertlistWatchSource, createCtWatchSource, createUrlscanWatchSource } from "./sources";

const NOW = new Date("2026-11-22T10:00:00Z");
const recipes = loadRecipes(path.join(process.cwd(), "data", "examples", "watch-przepisy.example.json"));
const TENANT = "00000000-0000-4000-8000-000000000001";

const scan = (id: string, url: string, tenant: string): UrlscanScan => ({
  id,
  url,
  sourceUrl: `https://urlscan.test/result/${id}/`,
  capturedAt: "2026-11-21T10:00:00.000Z",
  meta: {},
  requests: [{ url: `https://cdn.test/_cdn/landing-cdn/${tenant}/main.js` }],
});

const ctEvent = (...domains: string[]): CtStreamEvent => ({ domains, seenUtc: null, issuer: null, notBefore: null, notAfter: null, fingerprint: null, serial: null, logName: null, logUrl: null, certIndex: null, updateType: null });
const ad = (id: string): AdRecord => ({ platform: "meta", adId: id, libraryUrl: `https://lib.test/?id=${id}`, fetchedAt: NOW.toISOString(), landingUrl: `https://reklama-${id}.test/`, creatives: [] });

describe("przykładowe przepisy na nagranych odpowiedziach", () => {
  const registered = (registrar: string, nameservers: string[]) => ({ registrar, created: "2026-11-21T18:20:00Z", nameservers });
  const facts: Record<string, ReturnType<typeof registered>> = {
    "smartone.test": registered("Registrar Przykladowy Sp. z o.o.", ["ns1.dns-przyklad.test", "ns2.dns-przyklad.test"]),
    "smarttwo.test": registered("Inny Rejestrator", ["ns.cudzy.test"]),
  };
  let snapshot: Set<string> | null = null;
  const lists = [["stara.test"], ["stara.test", "smartone.test", "smarttwo.test"]];
  let listNo = 0;

  const meta: AdLibrarySource = { platform: "meta", available: async () => ({ ok: true }), search: async () => [ad("1")], getAd: async () => null };
  const campaigns = { campaigns: [{ id: "K01", size: 2, members: [], domains: ["finance12-dolorem51.example", "finance88-quia40.example"], advertisers: [], attributes: { personas: [] } }], assignments: {} } as unknown as CampaignsFile;
  const sources: WatchSource[] = [
    createUrlscanWatchSource({
      searcher: {
        available: async () => ({ ok: true }),
        searchScans: async (query) => (query.includes("sdk/main.js") ? [scan("1", "https://strona-a.test/", TENANT), scan("2", "https://strona-b.test/", "ffffffff-0000-4000-8000-000000000002")] : [scan("3", "https://strona-c.test/", "x")]),
      },
    }),
    createCertlistWatchSource({
      fetchList: async () => ({ domains: lists[listNo++] }),
      snapshot: { load: async () => snapshot, save: async (d) => void (snapshot = d) },
      facts: async (d) => facts[d] ?? null,
    }),
    createAdlibWatchSource({ sources: { meta } }),
    createCtWatchSource({ set: buildFingerprints(campaigns, { config: { ...DEFAULT_CT_CONFIG } }), source: "replay", collect: async () => ({ events: [ctEvent("zwrot12-abc34.example")] }) }),
  ];

  it("każdy przepis daje trafienie, a filtr RDAP/NS odrzuca domenę innego rejestratora", async () => {
    const hits: WatchHit[] = [];
    await sources[1].poll({ now: NOW, recipes: recipes.filter((r) => r.source === "certlist") }); // pierwszy przebieg: stan listy
    for (const source of sources) hits.push(...(await source.poll({ now: NOW, recipes: recipes.filter((r) => r.source === source.name) })).hits);
    const byRecipe = new Set(hits.map((h) => h.recipe));
    for (const r of recipes) expect(byRecipe.has(r.id), `przepis ${r.id}`).toBe(true);
    const cert = hits.filter((h) => h.source === "certlist").map((h) => h.url);
    expect(cert).toEqual(["https://smartone.test/"]);
    // lista alarmowa najemców: skan z innym najemcą nie jest trafieniem tego przepisu
    expect(hits.filter((h) => h.recipe === "najemca-platformy").map((h) => h.url)).toEqual(["https://strona-a.test/"]);
  });
});
