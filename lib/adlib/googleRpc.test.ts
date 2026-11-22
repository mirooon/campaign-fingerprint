import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSearchCreativesBody, createGoogleRpcSource, parseSearchCreatives, parseSuggestions, type RpcFetch } from "./googleRpc";
import { ADLIB_FIXTURES } from "./testkit";

const read = (f: string) => readFileSync(path.join(ADLIB_FIXTURES, f), "utf8");
const NOW = "2026-11-21T10:00:00.000Z";

describe("Google ATC public RPC (unofficial, off by default)", () => {
  it("builds the form body with the domain and the region code of the country", () => {
    const body = new URLSearchParams(buildSearchCreativesBody({ domain: "oferta-przyklad.example", region: "PL", pageSize: 40 }));
    const req = JSON.parse(body.get("f.req")!);
    expect(req["2"]).toBe(40);
    expect(req["3"]["12"]).toEqual({ "1": "oferta-przyklad.example", "2": true });
    expect(req["3"]["8"]).toEqual([2616]);
  });

  it("leaves the region out when none is given", () => {
    const req = JSON.parse(new URLSearchParams(buildSearchCreativesBody({ domain: "a.example", pageSize: 10 })).get("f.req")!);
    expect(req["3"]["8"]).toBeUndefined();
  });

  it("turns the recorded answer into records with the landing domain of the query", () => {
    const recs = parseSearchCreatives(read("google_rpc_search_creatives.json"), { domain: "oferta-przyklad.example", fetchedAt: NOW });
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({
      platform: "google",
      adId: "CR0000000000000000301",
      libraryUrl: "https://adstransparency.google.com/advertiser/AR0000000000000000001/creative/CR0000000000000000301",
      advertiser: { id: "AR0000000000000000001", name: "Fikcyjna Firma Sp. z o.o." },
      firstSeen: "2025-11-01T00:00:00.000Z",
      lastSeen: "2025-11-15T00:00:00.000Z",
      landingUrl: "https://oferta-przyklad.example/",
    });
    expect(recs[1].lastSeen).toBeUndefined();
  });

  it("reads advertiser suggestions", () => {
    expect(parseSuggestions(read("google_rpc_search_suggestions.json"))).toEqual([
      { name: "Fikcyjna Firma Sp. z o.o.", advertiserId: "AR0000000000000000001", country: "PL" },
      { name: "Fikcyjna Firma Ltd", advertiserId: "AR0000000000000000009", country: "CY" },
    ]);
  });

  it("reports an answer of an unknown shape instead of returning nothing", () => {
    expect(() => parseSearchCreatives("<html>blocked</html>", { domain: "a.example", fetchedAt: NOW })).toThrow(/niepoprawna odpowiedź/);
  });

  it("is switched off by default, with the reason and how to switch it on", async () => {
    const a = await createGoogleRpcSource({ env: {} }).available();
    expect(a.ok).toBe(false);
    expect(a.reason).toContain("nieoficjalne");
    expect(a.howToGetAccess).toContain("ADLIB_GOOGLE_RPC=1");
    expect((await createGoogleRpcSource({ env: { ADLIB_GOOGLE_RPC: "1" } }).available()).ok).toBe(true);
  });

  it("searches by domain through the injected fetch, without logging in", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchFn: RpcFetch = async (url, init) => (calls.push({ url, body: init.body }), read("google_rpc_search_creatives.json"));
    const src = createGoogleRpcSource({ env: { ADLIB_GOOGLE_RPC: "1" }, fetchFn, now: () => NOW });
    const recs = await src.search({ keyword: "oferta-przyklad.example", country: "PL", limit: 5 });
    expect(recs).toHaveLength(2);
    expect(calls[0].url).toBe("https://adstransparency.google.com/anji/_/rpc/SearchService/SearchCreatives?authuser=");
    expect(new URLSearchParams(calls[0].body).get("f.req")).toContain("oferta-przyklad.example");
  });

  it("refuses a search that is not a domain", async () => {
    const src = createGoogleRpcSource({ env: { ADLIB_GOOGLE_RPC: "1" }, fetchFn: async () => "{}" });
    await expect(src.search({ keyword: "inwestycja" })).rejects.toThrow(/domen/);
  });
});
