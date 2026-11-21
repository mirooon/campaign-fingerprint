import { describe, expect, it } from "vitest";
import { clientKey, createRateLimiter, limitFromEnv } from "./rateLimit";

describe("createRateLimiter", () => {
  it("lets `limit` requests of one client through per window, then refuses with the time to wait", () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => t });
    expect(rl.check("a").ok).toBe(true);
    expect(rl.check("a").ok).toBe(true);
    t = 10_000;
    expect(rl.check("a")).toEqual({ ok: false, retryAfterS: 50 });
    expect(rl.check("b").ok).toBe(true);
  });

  it("starts a new window after the old one ends", () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(rl.check("a").ok).toBe(true);
    expect(rl.check("a").ok).toBe(false);
    t = 1000;
    expect(rl.check("a").ok).toBe(true);
  });
});

describe("limitFromEnv", () => {
  it("is off by default and on with a positive ANALYZE_RATE_LIMIT", () => {
    expect(limitFromEnv({})).toBeNull();
    expect(limitFromEnv({ ANALYZE_RATE_LIMIT: "0" })).toBeNull();
    expect(limitFromEnv({ ANALYZE_RATE_LIMIT: "abc" })).toBeNull();
    expect(limitFromEnv({ ANALYZE_RATE_LIMIT: "5" })).toEqual({ limit: 5, windowMs: 60_000 });
    expect(limitFromEnv({ ANALYZE_RATE_LIMIT: "5", ANALYZE_RATE_WINDOW_S: "10" })).toEqual({ limit: 5, windowMs: 10_000 });
  });
});

describe("clientKey", () => {
  it("takes the first address of X-Forwarded-For, then X-Real-IP, else a shared key", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }))).toBe("198.51.100.7");
    expect(clientKey(new Headers({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientKey(new Headers())).toBe("local");
  });
});
