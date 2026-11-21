/**
 * Request limits of the analysis routes: with ANALYZE_RATE_LIMIT set, the request over the limit gets 429
 * (the limit counts before the body is read); an upload declared over MATERIAL_MAX_MB gets 413.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  delete (globalThis as { __analyzeLimiter?: unknown }).__analyzeLimiter;
});

const post = (url: string, body: BodyInit, headers: Record<string, string> = {}) => new Request(`http://localhost${url}`, { method: "POST", body, headers });

describe("/api/analyze", () => {
  it("answers 429 with Retry-After after ANALYZE_RATE_LIMIT requests of one client", async () => {
    vi.stubEnv("ANALYZE_RATE_LIMIT", "2");
    const { POST } = await import("../app/api/analyze/route");
    const send = () => POST(post("/api/analyze", "{}", { "x-forwarded-for": "198.51.100.7" }));
    expect((await send()).status).toBe(400);
    expect((await send()).status).toBe(400);
    const third = await send();
    expect(third.status).toBe(429);
    expect(Number(third.headers.get("retry-after"))).toBeGreaterThan(0);
    const other = await POST(post("/api/analyze", "{}", { "x-forwarded-for": "203.0.113.9" }));
    expect(other.status).toBe(400);
  });

  it("is not limited when ANALYZE_RATE_LIMIT is not set", async () => {
    const { POST } = await import("../app/api/analyze/route");
    for (let i = 0; i < 5; i++) expect((await POST(post("/api/analyze", "{}"))).status).toBe(400);
  });
});

describe("/api/analyze-material", () => {
  it("answers 429 over the limit and 413 for a declared body over MATERIAL_MAX_MB", async () => {
    vi.stubEnv("ANALYZE_RATE_LIMIT", "1");
    vi.stubEnv("MATERIAL_MAX_MB", "1");
    const { POST } = await import("../app/api/analyze-material/route");
    const big = await POST(post("/api/analyze-material", "x", { "content-length": String(5 * 1024 * 1024), "content-type": "multipart/form-data; boundary=x" }));
    expect(big.status).toBe(413);
    const again = await POST(post("/api/analyze-material", "x"));
    expect(again.status).toBe(429);
  });
});
