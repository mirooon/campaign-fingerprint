import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadClickRoute } from "./clickRouteFile";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** Enriched dataset of one synthetic material with a redirect of one hop. */
const enriched = {
  items: [{ id: "m1", firstSeen: "2026-09-10T00:00:00.000Z" }],
  perItem: { m1: { itemId: "m1", landing: { url: "https://a.example/x" }, pageKey: "p" } },
  pages: { p: { fetch: { requestedUrl: "https://a.example/x", finalUrl: "https://b.example/y", status: 200, errorCode: null, redirectChain: [{ url: "https://a.example/x", status: 302, kind: "http" }] }, extract: null, kit: null, cloaking: null } },
  domains: { "a.example": { rdap: { created: "2026-09-08T00:00:00.000Z" } } },
};

function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "trasa-"));
  dirs.push(d);
  return d;
}

describe("loadClickRoute", () => {
  it("czyta enriched.json bazy i zwraca trasę materiału", () => {
    const base = tmp();
    writeFileSync(path.join(base, "enriched.json"), JSON.stringify(enriched));
    const out = loadClickRoute({ dataDir: base, itemId: "m1" });
    expect(out.ok && out.route.map((l) => l.role)).toEqual(["ad", "tracking", "lure"]);
  });
  it("dla zadania czyta dane z folderu pakietu, nie z bazy", () => {
    const base = tmp();
    const work = tmp();
    mkdirSync(path.join(work, "pakiet"));
    writeFileSync(path.join(work, "pakiet", "enriched.json"), JSON.stringify(enriched));
    const out = loadClickRoute({ dataDir: base, jobWorkDir: work, itemId: "m1" });
    expect(out.ok).toBe(true);
  });
  it("brak pliku albo materiału daje komunikat ze statusem, nie wyjątek", () => {
    const base = tmp();
    expect(loadClickRoute({ dataDir: base, itemId: "m1" })).toMatchObject({ ok: false, status: 409 });
    writeFileSync(path.join(base, "enriched.json"), JSON.stringify(enriched));
    expect(loadClickRoute({ dataDir: base, itemId: "nie-ma" })).toMatchObject({ ok: false, status: 404 });
  });
  it("uszkodzony plik to komunikat z powodem", () => {
    const base = tmp();
    writeFileSync(path.join(base, "enriched.json"), "{nie json");
    const out = loadClickRoute({ dataDir: base, itemId: "m1" });
    expect(out).toMatchObject({ ok: false, status: 500 });
    expect(!out.ok && out.error).toContain("trasy kliknięcia");
  });
});
