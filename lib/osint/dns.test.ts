import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCache } from "../cache";
import { resolveDns, resolveTxt, type DnsResolverLike } from "./dns";

function dnsError(code: string): Error {
  return Object.assign(new Error(`query failed: ${code}`), { code });
}

interface FakeOptions {
  a?: string[] | Error | "hang";
  aaaa?: string[] | Error;
  cname?: string[] | Error;
  ns?: string[] | Error;
  mx?: Array<{ priority: number; exchange: string }> | Error;
  txt?: string[][] | Error;
}

function fakeResolver(o: FakeOptions, calls: string[] = []): DnsResolverLike {
  const answer = <T>(type: string, v: T | Error | "hang" | undefined, empty: T): Promise<T> => {
    calls.push(type);
    if (v === "hang") return new Promise<T>(() => {});
    if (v instanceof Error) return Promise.reject(v);
    return Promise.resolve(v ?? empty);
  };
  return {
    resolve4: () => answer("A", o.a, [] as string[]),
    resolve6: () => answer("AAAA", o.aaaa, [] as string[]),
    resolveCname: () => answer("CNAME", o.cname, [] as string[]),
    resolveNs: () => answer("NS", o.ns, [] as string[]),
    resolveMx: () => answer("MX", o.mx, [] as Array<{ priority: number; exchange: string }>),
    resolveTxt: () => answer("TXT", o.txt, [] as string[][]),
  };
}

describe("resolveDns", () => {
  it("normalises names and records (lower-case, no trailing dot, sorted, MX by priority, TXT joined)", async () => {
    const resolver = fakeResolver({
      a: ["203.0.113.9", "203.0.113.5", "203.0.113.9"],
      aaaa: ["2001:DB8::1"],
      cname: ["Edge.CDN.Example."],
      ns: ["NS2.Hosting-X.TEST.", "ns1.hosting-x.test"],
      mx: [
        { priority: 20, exchange: "MX2.mail.test." },
        { priority: 10, exchange: "mx1.mail.test" },
      ],
      txt: [["v=spf1 include:_spf.mail.test ", "-all"], ["google-site-verification=abc"]],
    });
    const r = await resolveDns("Promo.Zysk-Krypto.EXAMPLE.", { resolver, cache: false });
    expect(r.name).toBe("promo.zysk-krypto.example");
    expect(r.a).toEqual(["203.0.113.5", "203.0.113.9"]);
    expect(r.aaaa).toEqual(["2001:db8::1"]);
    expect(r.cname).toEqual(["edge.cdn.example"]);
    expect(r.ns).toEqual(["ns1.hosting-x.test", "ns2.hosting-x.test"]);
    expect(r.mx).toEqual(["mx1.mail.test", "mx2.mail.test"]);
    expect(r.txt).toEqual(["google-site-verification=abc", "v=spf1 include:_spf.mail.test -all"]);
    expect(r.errors).toEqual({});
  });

  it("treats NODATA / NXDOMAIN as empty answers and records real failures", async () => {
    const resolver = fakeResolver({
      a: dnsError("ENOTFOUND"),
      aaaa: dnsError("ENODATA"),
      ns: dnsError("ESERVFAIL"),
      mx: dnsError("DNS_ENODATA"),
      txt: dnsError("ECONNREFUSED"),
    });
    const r = await resolveDns("nx.example", { resolver, cache: false });
    expect(r.a).toEqual([]);
    expect(r.aaaa).toEqual([]);
    expect(r.mx).toEqual([]);
    expect(r.errors).toEqual({ NS: "ESERVFAIL", TXT: "ECONNREFUSED" });
  });

  it("applies a per-query timeout guard", async () => {
    const resolver = fakeResolver({ a: "hang", ns: ["ns1.hosting-x.test"] });
    const started = Date.now();
    const r = await resolveDns("slow.example", { resolver, cache: false, timeoutMs: 50, types: ["A", "NS"] });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.errors.A).toBe("timeout");
    expect(r.ns).toEqual(["ns1.hosting-x.test"]);
  });

  it("queries only the requested types", async () => {
    const calls: string[] = [];
    const resolver = fakeResolver({ a: ["203.0.113.5"], ns: ["ns1.hosting-x.test"] }, calls);
    await resolveDns("x.example", { resolver, cache: false, types: ["NS", "A", "A"] });
    expect(calls.sort()).toEqual(["A", "NS"]);
  });

  describe("caching", () => {
    let dir: string | null = null;
    afterEach(async () => {
      if (dir) await rm(dir, { recursive: true, force: true });
      dir = null;
    });

    it("caches successful answers but not all-error results", async () => {
      dir = await mkdtemp(path.join(tmpdir(), "dns-cache-"));
      const cache = createCache({ namespace: "dns", dir, enabled: true });

      const calls: string[] = [];
      const ok = fakeResolver({ a: ["203.0.113.5"] }, calls);
      await resolveDns("cached.example", { resolver: ok, cache, types: ["A"] });
      const again = await resolveDns("cached.example", { resolver: ok, cache, types: ["A"] });
      expect(again.a).toEqual(["203.0.113.5"]);
      expect(calls).toEqual(["A"]);

      const failCalls: string[] = [];
      const failing = fakeResolver({ a: dnsError("ESERVFAIL") }, failCalls);
      await resolveDns("broken.example", { resolver: failing, cache, types: ["A"] });
      await resolveDns("broken.example", { resolver: failing, cache, types: ["A"] });
      expect(failCalls).toEqual(["A", "A"]);
    });
  });
});

describe("resolveTxt", () => {
  it("joins chunks and returns [] for NODATA", async () => {
    expect(
      await resolveTxt("5.113.0.203.origin.asn.cymru.com", {
        resolver: fakeResolver({ txt: [["64500 | 203.0.113.0/24 ", "| ZZ | ripencc | 2010-01-01"]] }),
      }),
    ).toEqual(["64500 | 203.0.113.0/24 | ZZ | ripencc | 2010-01-01"]);
    expect(await resolveTxt("none.example", { resolver: fakeResolver({ txt: dnsError("ENODATA") }) })).toEqual([]);
  });

  it("throws on real failures and timeouts", async () => {
    await expect(resolveTxt("x.example", { resolver: fakeResolver({ txt: dnsError("ESERVFAIL") }) })).rejects.toThrow();
    const hanging: DnsResolverLike = { ...fakeResolver({}), resolveTxt: () => new Promise<string[][]>(() => {}) };
    await expect(resolveTxt("x.example", { resolver: hanging, timeoutMs: 30 })).rejects.toThrow(/timed out/);
  });
});
