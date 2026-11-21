import { describe, expect, it } from "vitest";
import {
  cymruAsNameQuery,
  cymruOriginQuery,
  lookupAsn,
  parseCymruAsName,
  parseCymruOrigin,
  pickCymruOrigin,
} from "./asn";

describe("Team Cymru query builders", () => {
  it("builds origin queries for IPv4 and IPv6", () => {
    expect(cymruOriginQuery("203.0.113.5")).toBe("5.113.0.203.origin.asn.cymru.com");
    expect(cymruOriginQuery("2001:db8::1")).toBe(
      "1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.origin6.asn.cymru.com",
    );
    expect(cymruOriginQuery("not-an-ip")).toBeNull();
    expect(cymruAsNameQuery(13335)).toBe("AS13335.asn.cymru.com");
  });
});

describe("Team Cymru parsers", () => {
  it("parses origin answers incl. multiple ASNs and quoted strings", () => {
    expect(parseCymruOrigin("13335 | 104.16.0.0/13 | US | arin | 2014-03-28")).toEqual({
      asns: [13335],
      prefix: "104.16.0.0/13",
      country: "US",
      registry: "arin",
      allocated: "2014-03-28",
    });
    expect(parseCymruOrigin("64496 64497 | 203.0.113.0/24 | zz | RIPENCC | 2010-01-01")?.asns).toEqual([64496, 64497]);
    expect(parseCymruOrigin('"64500 | 198.51.100.0/24 | PL | ripencc | 2015-05-05"')?.prefix).toBe("198.51.100.0/24");
    expect(parseCymruOrigin("garbage")).toBeNull();
    expect(parseCymruOrigin("")).toBeNull();
  });

  it("picks the most specific prefix among several answers", () => {
    const picked = pickCymruOrigin([
      "64496 | 203.0.0.0/16 | ZZ | arin | 2001-01-01",
      "64500 | 203.0.113.0/24 | ZZ | arin | 2010-01-01",
      "nonsense",
    ]);
    expect(picked?.asns).toEqual([64500]);
    expect(picked?.prefix).toBe("203.0.113.0/24");
    expect(pickCymruOrigin([])).toBeNull();
  });

  it("parses AS name answers", () => {
    expect(parseCymruAsName("13335 | US | arin | 2010-07-14 | CLOUDFLARENET - Cloudflare, Inc., US")).toEqual({
      asn: 13335,
      country: "US",
      registry: "arin",
      allocated: "2010-07-14",
      asName: "CLOUDFLARENET - Cloudflare, Inc., US",
    });
    expect(parseCymruAsName("x | y")).toBeNull();
  });
});

describe("lookupAsn", () => {
  const answers: Record<string, string[]> = {
    "1.1.16.104.origin.asn.cymru.com": ["13335 | 104.16.0.0/13 | US | arin | 2014-03-28"],
    "AS13335.asn.cymru.com": ["13335 | US | arin | 2010-07-14 | CLOUDFLARENET - Cloudflare, Inc., US"],
    "10.113.0.203.origin.asn.cymru.com": ["64500 | 203.0.113.0/24 | ZZ | ripencc | 2010-01-01"],
  };
  const txt = async (name: string) => {
    if (name === "AS64500.asn.cymru.com") throw new Error("SERVFAIL");
    return answers[name] ?? [];
  };

  it("combines origin and AS name lookups", async () => {
    expect(await lookupAsn("104.16.1.1", { txt, cache: false })).toEqual({
      ip: "104.16.1.1",
      asn: 13335,
      asns: [13335],
      prefix: "104.16.0.0/13",
      country: "US",
      registry: "arin",
      allocated: "2014-03-28",
      asName: "CLOUDFLARENET - Cloudflare, Inc., US",
    });
  });

  it("keeps the ASN when only the AS-name query fails", async () => {
    const info = await lookupAsn("203.0.113.10", { txt, cache: false });
    expect(info?.asn).toBe(64500);
    expect(info?.asName).toBeNull();
  });

  it("returns null for unannounced or invalid IPs", async () => {
    expect(await lookupAsn("198.51.100.77", { txt, cache: false })).toBeNull();
    expect(await lookupAsn("999.1.1.1", { txt, cache: false })).toBeNull();
  });
});
