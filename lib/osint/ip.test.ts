import { describe, expect, it } from "vitest";
import {
  CidrList,
  canonicalIp,
  classifyIp,
  expandIPv6,
  ipInCidr,
  isPublicIp,
  parseIPv4,
  parseIPv6,
  reverseIPv4,
  reverseIPv6Nibbles,
} from "./ip";

describe("parseIPv4", () => {
  it("parses dotted quads", () => {
    expect(parseIPv4("203.0.113.5")).toBe(0xcb007105);
    expect(parseIPv4("0.0.0.0")).toBe(0);
    expect(parseIPv4("255.255.255.255")).toBe(0xffffffff);
  });
  it("rejects malformed and octal-looking input", () => {
    expect(parseIPv4("256.1.1.1")).toBeNull();
    expect(parseIPv4("1.2.3")).toBeNull();
    expect(parseIPv4("01.2.3.4")).toBeNull();
    expect(parseIPv4("1.2.3.4.5")).toBeNull();
    expect(parseIPv4("a.b.c.d")).toBeNull();
  });
});

describe("parseIPv6", () => {
  it("handles compression, brackets, zones and embedded IPv4", () => {
    expect(parseIPv6("::1")).toBe(BigInt(1));
    expect(parseIPv6("[2001:db8::1]")).toBe(parseIPv6("2001:0db8:0000:0000:0000:0000:0000:0001"));
    expect(parseIPv6("fe80::1%en0")).toBe(parseIPv6("fe80::1"));
    expect(expandIPv6("::ffff:192.0.2.1")).toBe("0000:0000:0000:0000:0000:ffff:c000:0201");
  });
  it("rejects invalid forms", () => {
    expect(parseIPv6("1::2::3")).toBeNull();
    expect(parseIPv6("12345::1")).toBeNull();
    expect(parseIPv6("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(parseIPv6("hello")).toBeNull();
  });
});

describe("CIDR matching", () => {
  it("matches v4 and v6 ranges", () => {
    expect(ipInCidr("104.21.32.1", "104.16.0.0/13")).toBe(true);
    expect(ipInCidr("104.24.0.1", "104.16.0.0/13")).toBe(false);
    expect(ipInCidr("2606:4700:3030::6815:1001", "2606:4700::/32")).toBe(true);
    expect(ipInCidr("2606:4701::1", "2606:4700::/32")).toBe(false);
    expect(ipInCidr("1.2.3.4", "2606:4700::/32")).toBe(false);
  });
  it("CidrList returns the most specific match", () => {
    const list = new CidrList<string>([
      { cidr: "10.0.0.0/8", data: "wide" },
      { cidr: "10.1.0.0/16", data: "narrow" },
    ]);
    expect(list.match("10.1.2.3")?.data).toBe("narrow");
    expect(list.match("10.2.2.3")?.data).toBe("wide");
    expect(list.match("11.0.0.1")).toBeNull();
  });
});

describe("classifyIp (SSRF guard ranges)", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["10.1.2.3", "private"],
    ["172.16.5.4", "private"],
    ["192.168.1.1", "private"],
    ["169.254.169.254", "link-local"],
    ["100.64.0.1", "cgnat-shared"],
    ["0.0.0.0", "this-network"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "reserved"],
    ["::1", "loopback"],
    ["fe80::1", "link-local"],
    ["fd00::1", "unique-local"],
    ["::ffff:127.0.0.1", "embedded-loopback"],
    ["64:ff9b::a00:1", "embedded-private"],
    ["2002:7f00:1::", "embedded-loopback"],
  ])("%s is not public (%s)", (ip, reason) => {
    expect(classifyIp(ip)).toEqual({ public: false, reason });
  });

  it("accepts public addresses", () => {
    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("104.21.32.1")).toBe(true);
    expect(isPublicIp("2606:4700::6810:84e5")).toBe(true);
    expect(isPublicIp("::ffff:8.8.8.8")).toBe(true);
  });
});

describe("reverse helpers", () => {
  it("reverses IPv4 and IPv6", () => {
    expect(reverseIPv4("203.0.113.5")).toBe("5.113.0.203");
    expect(reverseIPv6Nibbles("2001:db8::1")).toBe(
      "1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2",
    );
    expect(canonicalIp("2001:DB8::1")).toBe("2001:0db8:0000:0000:0000:0000:0000:0001");
  });
});
