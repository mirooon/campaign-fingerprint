import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCache, hashKey } from "./cache";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "starter-cache-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("file cache", () => {
  it("stores and reads values until the TTL expires", async () => {
    let t = 1_000;
    const cache = createCache({ namespace: "t", dir, enabled: true, now: () => t });
    await cache.set("k", { a: 1 }, 500);
    expect(await cache.get("k")).toEqual({ a: 1 });
    t = 1_499;
    expect(await cache.get("k")).toEqual({ a: 1 });
    t = 1_500;
    expect(await cache.get("k")).toBeUndefined();
  });

  it("wrap computes once, dedupes concurrent calls and respects shouldCache", async () => {
    const cache = createCache({ namespace: "w", dir, enabled: true });
    let calls = 0;
    const fn = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return 42;
    };
    const [a, b] = await Promise.all([cache.wrap("x", fn), cache.wrap("x", fn)]);
    expect([a, b]).toEqual([42, 42]);
    expect(await cache.wrap("x", fn)).toBe(42);
    expect(calls).toBe(1);

    let n = 0;
    const flaky = async () => ++n;
    await cache.wrap("y", flaky, { shouldCache: () => false });
    await cache.wrap("y", flaky, { shouldCache: () => false });
    expect(n).toBe(2);
  });

  it("caches null (negative results) but not undefined", async () => {
    const cache = createCache({ namespace: "n", dir, enabled: true });
    let calls = 0;
    await cache.wrap("missing", async () => {
      calls++;
      return null;
    });
    await cache.wrap("missing", async () => {
      calls++;
      return null;
    });
    expect(calls).toBe(1);
  });

  it("is a no-op when disabled", async () => {
    const cache = createCache({ namespace: "off", dir, enabled: false });
    await cache.set("k", 1);
    expect(await cache.get("k")).toBeUndefined();
  });

  it("hashes keys deterministically", () => {
    expect(hashKey("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
