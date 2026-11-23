/**
 * Analyst's decisions (B-282) through the API: a decision is saved next to the base, and a campaign marked
 * "odrzucone" gets no evidence pack (409 with a message) while an undecided one is not blocked by the decision.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const post = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body) });

function base(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "decyzje-api-"));
  dirs.push(d);
  return d;
}

describe("/api/decisions i /api/evidence", () => {
  it("zapisuje decyzję w katalogu bazy i odczytuje ją", async () => {
    vi.stubEnv("VIEWER_DATA_DIR", base());
    const { POST, GET } = await import("../app/api/decisions/route");
    const res = await POST(post("/api/decisions", { campaign: "K01", status: "rejected" }));
    expect(res.status).toBe(200);
    const got = (await (await GET()).json()) as { decisions: Record<string, { status: string }> };
    expect(got.decisions.K01.status).toBe("rejected");
    const cleared = (await (await POST(post("/api/decisions", { campaign: "K01", status: null }))).json()) as { decisions: object };
    expect(cleared.decisions).toEqual({});
  });
  it("zły status albo identyfikator to 400", async () => {
    vi.stubEnv("VIEWER_DATA_DIR", base());
    const { POST } = await import("../app/api/decisions/route");
    expect((await POST(post("/api/decisions", { campaign: "K01", status: "zatwierdzone" }))).status).toBe(400);
    expect((await POST(post("/api/decisions", { campaign: "../x", status: "reported" }))).status).toBe(400);
  });
  it("kampania „odrzucone” nie ma eksportu paczki: 409 z komunikatem, a „zgłoszone” przechodzi dalej do budowy", async () => {
    vi.stubEnv("VIEWER_DATA_DIR", base());
    const decisions = await import("../app/api/decisions/route");
    await decisions.POST(post("/api/decisions", { campaign: "K01", status: "rejected" }));
    await decisions.POST(post("/api/decisions", { campaign: "K02", status: "reported" }));
    const { POST } = await import("../app/api/evidence/route");
    const blocked = await POST(post("/api/evidence", { campaign: "K01" }));
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: string }).error).toContain("rejected");
    const passed = await POST(post("/api/evidence", { campaign: "K02" }));
    expect(((await passed.json()) as { error: string }).error).toContain("No base of known campaigns");
  });
});
