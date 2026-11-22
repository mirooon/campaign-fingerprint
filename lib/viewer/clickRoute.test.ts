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
  it("łańcuch trzech skoków daje reklamę i trzy ogniwa z rolą, statusem i wiekiem domeny", () => {
    const route = clickRoute(source());
    expect(route.map((l) => l.role)).toEqual(["ad", "tracking", "redirect", "lure"]);
    const [, tracking, redirect, lure] = route;
    expect(tracking.statusLabel).toBe("przekierował (HTTP 302)");
    expect(tracking.domainNote).toBe("domena zarejestrowana 2 dni przed emisją");
    expect(tracking.fresh).toBe(true);
    expect(redirect.statusLabel).toBe("przekierował (HTTP 301)");
    expect(redirect.domainNote).toBeNull();
    expect(lure.statusLabel).toBe("odpowiada (HTTP 200)");
    expect(lure.domainNote).toBe("domena zarejestrowana w dniu emisji");
  });
  it("adres bez przekierowań to jedno ogniwo-przyneta po reklamie", () => {
    const route = clickRoute(source({ page: { requestedUrl: "https://przyneta.example/oferta", finalUrl: "https://przyneta.example/oferta", status: 200, errorCode: null, redirectChain: [] } }));
    expect(route.map((l) => l.role)).toEqual(["ad", "lure"]);
  });
  it("strona z formularzem albo sklepem dostaje własną rolę końcową", () => {
    expect(clickRoute(source({ finalKind: "form" })).at(-1)?.role).toBe("form");
    expect(clickRoute(source({ finalKind: "shop" })).at(-1)?.role).toBe("shop");
  });
  it("status końcowego ogniwa: nie odpowiada, zablokowany, błąd HTTP", () => {
    const end = (status: number | null, errorCode: string | null) => clickRoute(source({ page: { requestedUrl: "https://x.example/", finalUrl: "https://x.example/", status, errorCode, redirectChain: [] } })).at(-1)!;
    expect(end(null, "timeout").status).toBe("no_response");
    expect(end(null, "timeout").statusLabel).toContain("nie odpowiada");
    expect(end(null, "blocked").status).toBe("blocked");
    expect(end(null, "blocked").statusLabel).toContain("zablokowany");
    expect(end(404, null).statusLabel).toBe("odpowiada błędem HTTP 404");
  });
  it("cloaking i ochrona przed botami to ostrzeżenia na ogniwie końcowym", () => {
    expect(clickRoute(source({ cloaking: { suspected: true, state: "checked" } })).at(-1)?.warning).toContain("cloaking");
    expect(clickRoute(source({ cloaking: { suspected: false, state: "bot_challenge" } })).at(-1)?.warning).toContain("Ochrona przed botami");
    expect(clickRoute(source()).at(-1)?.warning).toBeNull();
  });
  it("bez pobranej strony zostaje adres z reklamy i „nie sprawdzono”", () => {
    const route = clickRoute(source({ page: null }));
    expect(route.map((l) => l.role)).toEqual(["ad", "lure"]);
    expect(route[1].status).toBe("not_checked");
    expect(route[1].url).toBe("https://reklama.example/start");
  });
  it("wiek domeny po emisji nie jest świeżą rejestracją przed reklamą", () => {
    const route = clickRoute(source({ domainCreated: () => "2026-10-01T00:00:00.000Z" }));
    expect(route[1].fresh).toBe(false);
    expect(route[1].domainNote).toContain("po emisji");
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
  it("składa dane trasy z danych wzbogaconych materiału", () => {
    const src = routeSourceOf(ds, "m1")!;
    expect(src.firstSeen).toBe("2026-09-10T00:00:00.000Z");
    expect(src.finalKind).toBe("shop");
    expect(src.domainCreated("reklama.example")).toBe("2026-09-01T00:00:00.000Z");
    expect(clickRoute(src).at(-1)?.domainNote).toBe("domena zarejestrowana 9 dni przed emisją");
  });
  it("nieznany materiał to null", () => {
    expect(routeSourceOf(ds, "brak")).toBeNull();
  });
});
