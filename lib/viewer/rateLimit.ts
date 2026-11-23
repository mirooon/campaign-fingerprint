/**
 * Request limit of the analysis routes (`/api/analyze`, `/api/analyze-material`, `/api/material`).
 * Off by default (a local run has one user); set ANALYZE_RATE_LIMIT (requests per client per window,
 * ANALYZE_RATE_WINDOW_S seconds, default 60) when the app is reachable from outside. Fixed window,
 * kept in memory of one server process.
 */

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

export interface RateLimiter {
  /** Counts a request of `key`: ok, or refused with the seconds until the window ends. */
  check(key: string): { ok: true } | { ok: false; retryAfterS: number };
}

/** Limiter with a fixed window per key; `now` is replaceable for tests. */
export function createRateLimiter(c: RateLimitConfig & { now?: () => number }): RateLimiter {
  const now = c.now ?? Date.now;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    check(key) {
      const t = now();
      let w = windows.get(key);
      if (!w || t - w.start >= c.windowMs) {
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      if (w.count >= c.limit) return { ok: false, retryAfterS: Math.ceil((w.start + c.windowMs - t) / 1000) };
      w.count++;
      return { ok: true };
    },
  };
}

/** Limit from the environment: null (no limit) unless ANALYZE_RATE_LIMIT is a positive number. */
export function limitFromEnv(env: Record<string, string | undefined> = process.env): RateLimitConfig | null {
  const limit = Number(env.ANALYZE_RATE_LIMIT);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const windowS = Number(env.ANALYZE_RATE_WINDOW_S);
  return { limit, windowMs: (Number.isFinite(windowS) && windowS > 0 ? windowS : 60) * 1000 };
}

/**
 * Who sent the request: the first address of X-Forwarded-For, else X-Real-IP, else one shared key.
 * Behind a reverse proxy the proxy must set these headers (and strip the client's own); otherwise
 * a client can pick its own key.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "local";
}

const holder = globalThis as { __analyzeLimiter?: { signature: string; limiter: RateLimiter } };

/** Response 429 (with Retry-After) when the client is over the limit, null when the request may go on or no limit is set. */
export function rateLimitResponse(request: Request): Response | null {
  const config = limitFromEnv();
  if (!config) return null;
  const signature = `${config.limit}/${config.windowMs}`;
  // kept in globalThis so that the counters survive module reloads of the dev server
  if (holder.__analyzeLimiter?.signature !== signature) holder.__analyzeLimiter = { signature, limiter: createRateLimiter(config) };
  const r = holder.__analyzeLimiter.limiter.check(clientKey(request.headers));
  if (r.ok) return null;
  return Response.json({ error: `Too many requests, try again in ${r.retryAfterS} s` }, { status: 429, headers: { "retry-after": String(r.retryAfterS) } });
}
