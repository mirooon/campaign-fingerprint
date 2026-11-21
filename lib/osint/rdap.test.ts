import { describe, expect, it } from "vitest";
import { lookupRdap, parseRdap, RdapHttpError, type FetchLike } from "./rdap";

const SAMPLE = {
  objectClassName: "domain",
  ldhName: "ZYSK-KRYPTO-A.EXAMPLE",
  handle: "D123-EXAMPLE",
  status: ["client transfer prohibited", "Active", "active"],
  events: [
    { eventAction: "registration", eventDate: "2026-09-30T08:15:00Z" },
    { eventAction: "expiration", eventDate: "2027-09-30T08:15:00Z" },
    { eventAction: "last changed", eventDate: "2026-10-02T11:00:00Z" },
    { eventAction: "last update of RDAP database", eventDate: "2026-11-18T00:00:00Z" },
  ],
  nameservers: [
    { objectClassName: "nameserver", ldhName: "NS2.HOSTING-X.TEST." },
    { objectClassName: "nameserver", ldhName: "ns1.hosting-x.test" },
  ],
  entities: [
    {
      objectClassName: "entity",
      handle: "9999",
      roles: ["registrar"],
      publicIds: [{ type: "IANA Registrar ID", identifier: "9999" }],
      vcardArray: [
        "vcard",
        [
          ["version", {}, "text", "4.0"],
          ["fn", {}, "text", "Przykładowy Rejestrator Sp. z o.o."],
        ],
      ],
      entities: [
        {
          objectClassName: "entity",
          roles: ["abuse"],
          vcardArray: [
            "vcard",
            [
              ["version", {}, "text", "4.0"],
              ["fn", {}, "text", "Abuse Team"],
              ["email", {}, "text", "Abuse@Rejestrator.example"],
              ["tel", { type: "voice" }, "uri", "tel:+48.123456789"],
            ],
          ],
        },
      ],
    },
    { objectClassName: "entity", roles: ["registrant"], handle: "REDACTED" },
  ],
  links: [
    {
      value: "https://rdap.registry.example/domain/zysk-krypto-a.example",
      rel: "self",
      href: "https://rdap.registry.example/domain/zysk-krypto-a.example",
      type: "application/rdap+json",
    },
  ],
};

describe("parseRdap", () => {
  it("extracts registrar, dates, status, nameservers, abuse contact and source", () => {
    expect(parseRdap(SAMPLE, "zysk-krypto-a.example")).toEqual({
      domain: "zysk-krypto-a.example",
      registrar: "Przykładowy Rejestrator Sp. z o.o.",
      registrarIanaId: "9999",
      created: "2026-09-30T08:15:00.000Z",
      expires: "2027-09-30T08:15:00.000Z",
      updated: "2026-10-02T11:00:00.000Z",
      status: ["active", "client transfer prohibited"],
      nameservers: ["ns1.hosting-x.test", "ns2.hosting-x.test"],
      abuseEmail: "abuse@rejestrator.example",
      source: "https://rdap.registry.example/domain/zysk-krypto-a.example",
    });
  });

  it("falls back to the registrar handle and tolerates missing fields", () => {
    const info = parseRdap(
      { entities: [{ roles: ["Registrar"], handle: "REG-42", publicIds: [{ type: "IANA Registrar ID", identifier: 42 }] }] },
      "Other.TEST",
    );
    expect(info.domain).toBe("other.test");
    expect(info.registrar).toBe("REG-42");
    expect(info.registrarIanaId).toBe("42");
    expect(info.created).toBeNull();
    expect(info.nameservers).toEqual([]);
  });

  it("never throws on garbage", () => {
    for (const junk of [null, undefined, 42, "x", [], { entities: "nope", events: [null, 1] }]) {
      const info = parseRdap(junk, "x.test");
      expect(info.domain).toBe("x.test");
      expect(info.registrar).toBeNull();
      expect(info.status).toEqual([]);
    }
  });
});

describe("lookupRdap", () => {
  it("queries the rdap.org bootstrap with the punycode domain and parses the answer", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(SAMPLE), { status: 200, headers: { "content-type": "application/rdap+json" } });
    };
    const info = await lookupRdap("zysk-krypto-a.example", { fetchImpl, cache: false });
    expect(info?.registrar).toBe("Przykładowy Rejestrator Sp. z o.o.");
    expect(calls[0].url).toBe("https://rdap.org/domain/zysk-krypto-a.example");
    expect(new Headers(calls[0].init?.headers).get("accept")).toContain("application/rdap+json");

    await lookupRdap("bücher.example", { fetchImpl, cache: false });
    expect(calls[1].url).toBe("https://rdap.org/domain/xn--bcher-kva.example");
  });

  it("returns null on 404 and throws RdapHttpError on other HTTP errors", async () => {
    const notFound: FetchLike = async () => new Response("not found", { status: 404 });
    expect(await lookupRdap("missing.example", { fetchImpl: notFound, cache: false })).toBeNull();

    const broken: FetchLike = async () => new Response("oops", { status: 503 });
    const err = await lookupRdap("x.example", { fetchImpl: broken, cache: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RdapHttpError);
    expect((err as RdapHttpError).status).toBe(503);
  });
});
