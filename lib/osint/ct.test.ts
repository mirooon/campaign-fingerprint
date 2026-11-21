import { describe, expect, it } from "vitest";
import { CrtShQueryError, dnAttribute, lookupCt, parseCrtSh, searchCt, type FetchLike } from "./ct";

const ROWS = [
  // Final certificate (higher id) and precertificate (lower id) share the serial.
  {
    issuer_ca_id: 295815,
    issuer_name: "C=US, O=Let's Encrypt, CN=R11",
    common_name: "zysk-krypto-a.example",
    name_value: "*.zysk-krypto-a.example\nzysk-krypto-a.example",
    id: 1002,
    entry_timestamp: "2026-10-01T10:11:15.123",
    not_before: "2026-10-01T09:11:12",
    not_after: "2026-12-30T09:11:11",
    serial_number: "04AA11",
  },
  {
    issuer_ca_id: 295815,
    issuer_name: "C=US, O=Let's Encrypt, CN=R11",
    common_name: "zysk-krypto-a.example",
    name_value: "zysk-krypto-a.example\nkrypto-zysk-pl.test\nWWW.Krypto-Zysk-PL.test.",
    id: 1001,
    entry_timestamp: "2026-10-01T10:11:12.345",
    not_before: "2026-10-01T09:11:12",
    not_after: "2026-12-30T09:11:11",
    serial_number: "04aa11",
  },
  {
    issuer_ca_id: 1,
    issuer_name: 'C=US, O="Cloudflare, Inc.", CN=Cloudflare Inc ECC CA-3',
    common_name: "sni.cloudflaressl.example",
    name_value: "sni.cloudflaressl.example\n*.zysk-krypto-a.example\nadmin@zysk-krypto-a.example",
    id: 900,
    entry_timestamp: "2026-11-02T00:00:00",
    not_before: "2026-11-01T00:00:00",
    not_after: "2027-11-01T00:00:00",
    serial_number: "0bcd",
  },
  {
    issuer_ca_id: 2,
    issuer_name: "CN=Some Private CA",
    common_name: null,
    name_value: "old.zysk-krypto-a.example",
    id: 500,
    entry_timestamp: "2025-01-01T00:00:00",
    not_before: "2025-01-01T00:00:00",
    not_after: "2025-04-01T00:00:00",
    serial_number: null,
  },
];

describe("dnAttribute", () => {
  it("reads quoted and unquoted attributes without confusing O with OU", () => {
    expect(dnAttribute("C=US, O=Let's Encrypt, CN=R11", "O")).toBe("Let's Encrypt");
    expect(dnAttribute('C=US, O="Cloudflare, Inc.", CN=x', "O")).toBe("Cloudflare, Inc.");
    expect(dnAttribute("C=PL, OU=Unit, CN=Only CN", "O")).toBeNull();
    expect(dnAttribute("/C=US/O=Example CA/CN=Leaf", "O")).toBe("Example CA");
  });
});

describe("parseCrtSh", () => {
  it("merges precert/leaf pairs, normalises SANs and sorts by notBefore desc", () => {
    const r = parseCrtSh(ROWS, "zysk-krypto-a.example");
    expect(r.truncated).toBe(false);
    expect(r.certs.map((c) => c.id)).toEqual(["900", "1001", "500"]);

    const le = r.certs[1];
    expect(le.serial).toBe("04aa11");
    expect(le.issuer).toBe("Let's Encrypt");
    expect(le.issuerName).toBe("C=US, O=Let's Encrypt, CN=R11");
    expect(le.sanDomains).toEqual(["krypto-zysk-pl.test", "www.krypto-zysk-pl.test", "zysk-krypto-a.example"]);
    expect(le.notBefore).toBe("2026-10-01T09:11:12.000Z");
    expect(le.entryTimestamp).toBe("2026-10-01T10:11:12.345Z");

    const cf = r.certs[0];
    expect(cf.issuer).toBe("Cloudflare, Inc.");
    expect(cf.sanDomains).toEqual(["sni.cloudflaressl.example", "zysk-krypto-a.example"]); // e-mail dropped

    expect(r.certs[2].issuer).toBe("Some Private CA");
    expect(r.certs[2].commonName).toBeNull();
  });

  it("caps the number of certificates", () => {
    const r = parseCrtSh(ROWS, "zysk-krypto-a.example", 2);
    expect(r.certs).toHaveLength(2);
    expect(r.truncated).toBe(true);
  });

  it("returns an empty result for non-array input", () => {
    expect(parseCrtSh({ error: "x" }, "a.test")).toEqual({ domain: "a.test", certs: [], truncated: false });
  });
});

function sequenceFetch(responses: Array<() => Response | Promise<Response>>, calls: string[]): FetchLike {
  let i = 0;
  return async (url) => {
    calls.push(url);
    const make = responses[Math.min(i, responses.length - 1)];
    i++;
    return make();
  };
}

describe("lookupCt", () => {
  it("retries on 5xx and returns parsed certificates", async () => {
    const calls: string[] = [];
    const sleeps: number[] = [];
    const fetchImpl = sequenceFetch(
      [() => new Response("busy", { status: 503 }), () => new Response(JSON.stringify(ROWS), { status: 200 })],
      calls,
    );
    const r = await lookupCt("zysk-krypto-a.example", {
      fetchImpl,
      cache: false,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(r?.certs).toHaveLength(3);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe("https://crt.sh/?q=zysk-krypto-a.example&output=json");
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(2000);
  });

  it("honours Retry-After and retries on non-JSON bodies and network errors", async () => {
    const calls: string[] = [];
    const sleeps: number[] = [];
    const fetchImpl = sequenceFetch(
      [
        () => new Response("slow down", { status: 429, headers: { "Retry-After": "7" } }),
        () => new Response("<html>502 Bad Gateway</html>", { status: 200 }),
        () => Promise.reject(new TypeError("fetch failed")),
        () => new Response("[]", { status: 200 }),
      ],
      calls,
    );
    const r = await lookupCt("quiet.example", {
      fetchImpl,
      cache: false,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(r).toEqual({ domain: "quiet.example", certs: [], truncated: false });
    expect(calls).toHaveLength(4);
    expect(sleeps[0]).toBe(7000);
  });

  it("returns null after exhausting retries and does not retry other 4xx", async () => {
    const calls: string[] = [];
    const exhausted = await lookupCt("down.example", {
      fetchImpl: sequenceFetch([() => new Response("bad gateway", { status: 502 })], calls),
      cache: false,
      retries: 2,
      sleep: async () => {},
    });
    expect(exhausted).toBeNull();
    expect(calls).toHaveLength(3);

    const badCalls: string[] = [];
    const bad = await lookupCt("bad.example", {
      fetchImpl: sequenceFetch([() => new Response("bad request", { status: 400 })], badCalls),
      cache: false,
      sleep: async () => {},
    });
    expect(bad).toBeNull();
    expect(badCalls).toHaveLength(1);
  });
});

describe("searchCt (crt.sh identity search for the CT watcher backfill)", () => {
  it("rejects patterns crt.sh cannot run (% in the middle, too short)", async () => {
    await expect(searchCt("finance%.sbs", { cache: false })).rejects.toThrow(/Invalid crt.sh search pattern/);
    await expect(searchCt("ab%", { cache: false })).rejects.toThrow(/at least 3 literal/);
    await expect(searchCt("fin ance%", { cache: false })).rejects.toThrow();
  });

  it("sends the wildcard query (expired certificates excluded) and parses the rows", async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (u) => {
      urls.push(String(u));
      return new Response(JSON.stringify(ROWS.slice(0, 2)), { status: 200 });
    };
    const res = await searchCt("Zysk-Krypto%", { cache: false, fetchImpl });
    expect(urls).toEqual(["https://crt.sh/?q=zysk-krypto%25&output=json&exclude=expired"]);
    expect(res!.certs).toHaveLength(1);
    expect(res!.certs[0].sanDomains).toEqual(["krypto-zysk-pl.test", "www.krypto-zysk-pl.test", "zysk-krypto-a.example"]);
  });

  it("does not retry when crt.sh rejects the pattern", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls++;
      return new Response("<HTML><BODY><BR><BR>Unsupported use of '%'</BODY></HTML>", { status: 200 });
    };
    await expect(searchCt("zysk%", { cache: false, fetchImpl, sleep: async () => {} })).rejects.toBeInstanceOf(CrtShQueryError);
    expect(calls).toBe(1);
  });
});
