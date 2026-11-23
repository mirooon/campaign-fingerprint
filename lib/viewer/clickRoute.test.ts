import { describe, expect, it } from "vitest";
import type { EnrichedDataset } from "@/lib/pipeline/types";
import { clickRoute, routeSourceOf, type RouteSource } from "./clickRoute";

function source(over: Partial<RouteSource> = {}): RouteSource {
  return {
    firstSeen: "2026-09-10T00:00:00.000Z",
    landingUrl: "https://reklama.example/start",
    page: {
      requestedUrl: "https://sledzenie.example/k/1",
      finalUrl: "https://przyneta.example/oferta",
      status: 200,
      errorCode: null,
      redirectChain: [
        { url: "https://sledzenie.example/k/1", status: 302, kind: "http" },
        { url: "https://posrednik.example/r", status: 301, kind: "http" },
      ],
    },
    cloaking: null,
    domainCreated: (host) => ({ "sledzenie.example": "2026-09-08T00:00:00.000Z", "przyneta.example": "2026-09-09T12:00:00.000Z" })[host] ?? null,
    finalKind: null,
    ...over,
  };
}

describe("clickRoute", () => {
  it("a chain of three hops gives the ad and three links with role, status and domain age", () => {
    const route = clickRoute(source());
    expect(route.map((l) => l.role)).toEqual(["ad", "tracking", "redirect", "lure"]);
    const [, tracking, redirect, lure] = route;
    expect(tracking.statusLabel).toBe("redirected (HTTP 302)");
    expect(tracking.domainNote).toBe("domain registered 2 days before the ad was first shown");
    expect(tracking.fresh).toBe(true);
    expect(redirect.statusLabel).toBe("redirected (HTTP 301)");
    expect(redirect.domainNote).toBeNull();
    expect(lure.statusLabel).toBe("responds (HTTP 200)");
    expect(lure.domainNote).toBe("domain registered on the day the ad was first shown");
  });
  it("a URL without redirects is one lure link after the ad", () => {
    const route = clickRoute(source({ page: { requestedUrl: "https://przyneta.example/oferta", finalUrl: "https://przyneta.example/oferta", status: 200, errorCode: null, redirectChain: [] } }));
    expect(route.map((l) => l.role)).toEqual(["ad", "lure"]);
  });
  it("a page with a form or a shop gets its own final role", () => {
    expect(clickRoute(source({ finalKind: "form" })).at(-1)?.role).toBe("form");
    expect(clickRoute(source({ finalKind: "shop" })).at(-1)?.role).toBe("shop");
  });
  it("status of the final link: no response, blocked, HTTP error", () => {
    const end = (status: number | null, errorCode: string | null) => clickRoute(source({ page: { requestedUrl: "https://x.example/", finalUrl: "https://x.example/", status, errorCode, redirectChain: [] } })).at(-1)!;
    expect(end(null, "timeout").status).toBe("no_response");
    expect(end(null, "timeout").statusLabel).toContain("no response");
    expect(end(null, "blocked").status).toBe("blocked");
    expect(end(null, "blocked").statusLabel).toContain("blocked");
    expect(end(404, null).statusLabel).toBe("responds with HTTP error 404");
  });
  it("cloaking and bot protection are warnings on the final link", () => {
    expect(clickRoute(source({ cloaking: { suspected: true, state: "checked" } })).at(-1)?.warning).toContain("cloaking");
    expect(clickRoute(source({ cloaking: { suspected: false, state: "bot_challenge" } })).at(-1)?.warning).toContain("Bot protection");
    expect(clickRoute(source()).at(-1)?.warning).toBeNull();
  });
  it("without a fetched page the URL from the ad stays, “not checked”", () => {
    const route = clickRoute(source({ page: null }));
    expect(route.map((l) => l.role)).toEqual(["ad", "lure"]);
    expect(route[1].status).toBe("not_checked");
    expect(route[1].url).toBe("https://reklama.example/start");
  });
  it("a domain age after the ad is not a fresh registration before the ad", () => {
    const route = clickRoute(source({ domainCreated: () => "2026-10-01T00:00:00.000Z" }));
    expect(route[1].fresh).toBe(false);
    expect(route[1].domainNote).toContain("after the ad was first shown");
  });
});

describe("routeSourceOf", () => {
  const ds = {
    items: [{ id: "m1", firstSeen: "2026-09-10T00:00:00.000Z" }],
    perItem: { m1: { itemId: "m1", landing: { url: "https://reklama.example/start" }, pageKey: "https://reklama.example/start" } },
    pages: {
      "https://reklama.example/start": {
        fetch: { requestedUrl: "https://reklama.example/start", finalUrl: "https://reklama.example/start", status: 200, errorCode: null, redirectChain: [] },
        extract: { cms: ["shopify"] },
        kit: { endpoints: [] },
        cloaking: { suspected: false, state: "checked" },
      },
    },
    domains: { "reklama.example": { rdap: { created: "2026-09-01T00:00:00.000Z" } } },
  } as unknown as Pick<EnrichedDataset, "items" | "perItem" | "pages" | "domains">;
  it("builds the route data from the enriched data of a sample", () => {
    const src = routeSourceOf(ds, "m1")!;
    expect(src.firstSeen).toBe("2026-09-10T00:00:00.000Z");
    expect(src.finalKind).toBe("shop");
    expect(src.domainCreated("reklama.example")).toBe("2026-09-01T00:00:00.000Z");
    expect(clickRoute(src).at(-1)?.domainNote).toBe("domain registered 9 days before the ad was first shown");
  });
  it("an unknown sample is null", () => {
    expect(routeSourceOf(ds, "brak")).toBeNull();
  });
});
