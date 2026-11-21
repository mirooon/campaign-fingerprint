/**
 * IP address helpers: strict parsing, CIDR matching and classification of
 * non-public ranges (used by the SSRF guard and by the infra deny-lists).
 *
 * Pure functions, no network access.
 */

export type IpVersion = 4 | 6;

export interface ParsedIp {
  version: IpVersion;
  value: bigint;
}

/** Strict dotted-quad IPv4 parser. Rejects leading zeros (octal ambiguity). */
export function parseIPv4(input: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(input.trim());
  if (!m) return null;
  let value = 0;
  for (let i = 1; i <= 4; i++) {
    const part = m[i];
    if (part.length > 1 && part.startsWith("0")) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function ipv4ToString(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

/** IPv6 parser (handles `::`, embedded IPv4 tail, brackets and zone ids). */
export function parseIPv6(input: string): bigint | null {
  let s = input.trim();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(":")) return null;
  if (!/^[0-9a-fA-F:.]+$/.test(s)) return null;

  // Embedded IPv4 tail, e.g. ::ffff:192.0.2.1
  let tailGroups: number[] = [];
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (v4 === null) return null;
    tailGroups = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    s = s.slice(0, lastColon + 1) + "0:0"; // placeholder groups, replaced below
  }

  const doubleColon = s.indexOf("::");
  if (doubleColon !== s.lastIndexOf("::")) return null;

  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    const out: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  let groups: number[];
  if (doubleColon >= 0) {
    const head = parseGroups(s.slice(0, doubleColon));
    const rest = parseGroups(s.slice(doubleColon + 2));
    if (!head || !rest) return null;
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array<number>(missing).fill(0), ...rest];
  } else {
    const all = parseGroups(s);
    if (!all || all.length !== 8) return null;
    groups = all;
  }
  if (groups.length !== 8) return null;
  if (tailGroups.length === 2) {
    groups[6] = tailGroups[0];
    groups[7] = tailGroups[1];
  }
  let value = BigInt(0);
  for (const g of groups) value = (value << BigInt(16)) | BigInt(g);
  return value;
}

export function parseIp(input: string): ParsedIp | null {
  const v4 = parseIPv4(input);
  if (v4 !== null) return { version: 4, value: BigInt(v4) };
  const v6 = parseIPv6(input);
  if (v6 !== null) return { version: 6, value: v6 };
  return null;
}

export function ipVersion(input: string): IpVersion | null {
  return parseIp(input)?.version ?? null;
}

export function isIpAddress(input: string): boolean {
  return parseIp(input) !== null;
}

/** Full, lower-case, zero-padded IPv6 notation (8 groups). */
export function expandIPv6(input: string): string | null {
  const v = parseIPv6(input);
  if (v === null) return null;
  const hex = v.toString(16).padStart(32, "0");
  return hex.match(/.{4}/g)!.join(":");
}

/** Canonical textual form used as a graph key (IPv4 dotted, IPv6 expanded). */
export function canonicalIp(input: string): string | null {
  const p = parseIp(input);
  if (!p) return null;
  return p.version === 4 ? ipv4ToString(Number(p.value)) : expandIPv6(input);
}

export interface ParsedCidr {
  version: IpVersion;
  base: bigint;
  prefix: number;
}

export function parseCidr(cidr: string): ParsedCidr | null {
  const [addr, prefixStr] = cidr.trim().split("/");
  const ip = parseIp(addr);
  if (!ip) return null;
  const max = ip.version === 4 ? 32 : 128;
  const prefix = prefixStr === undefined ? max : Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null;
  const shift = BigInt(max - prefix);
  const base = (ip.value >> shift) << shift;
  return { version: ip.version, base, prefix };
}

function inParsedCidr(ip: ParsedIp, cidr: ParsedCidr): boolean {
  if (ip.version !== cidr.version) return false;
  const max = ip.version === 4 ? 32 : 128;
  const shift = BigInt(max - cidr.prefix);
  return (ip.value >> shift) << shift === cidr.base;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const p = parseIp(ip);
  const c = parseCidr(cidr);
  return !!p && !!c && inParsedCidr(p, c);
}

/** Pre-compiled CIDR list for fast repeated lookups. */
export class CidrList<T = string> {
  private entries: Array<{ cidr: ParsedCidr; data: T; raw: string }> = [];

  constructor(items: Array<{ cidr: string; data: T }> = []) {
    for (const item of items) this.add(item.cidr, item.data);
  }

  add(cidr: string, data: T): void {
    const parsed = parseCidr(cidr);
    if (!parsed) throw new Error(`Invalid CIDR: ${cidr}`);
    this.entries.push({ cidr: parsed, data, raw: cidr });
  }

  /** Returns the most specific matching entry, if any. */
  match(ip: string): { cidr: string; data: T } | null {
    const p = parseIp(ip);
    if (!p) return null;
    let best: { cidr: ParsedCidr; data: T; raw: string } | null = null;
    for (const e of this.entries) {
      if (inParsedCidr(p, e.cidr) && (!best || e.cidr.prefix > best.cidr.prefix)) best = e;
    }
    return best ? { cidr: best.raw, data: best.data } : null;
  }
}

const NON_PUBLIC_V4: Array<[string, string]> = [
  ["0.0.0.0/8", "this-network"],
  ["10.0.0.0/8", "private"],
  ["100.64.0.0/10", "cgnat-shared"],
  ["127.0.0.0/8", "loopback"],
  ["169.254.0.0/16", "link-local"],
  ["172.16.0.0/12", "private"],
  ["192.0.0.0/24", "ietf-protocol"],
  ["192.0.2.0/24", "documentation"],
  ["192.88.99.0/24", "6to4-relay"],
  ["192.168.0.0/16", "private"],
  ["198.18.0.0/15", "benchmarking"],
  ["198.51.100.0/24", "documentation"],
  ["203.0.113.0/24", "documentation"],
  ["224.0.0.0/4", "multicast"],
  ["240.0.0.0/4", "reserved"],
];

const NON_PUBLIC_V6: Array<[string, string]> = [
  ["::/128", "unspecified"],
  ["::1/128", "loopback"],
  ["::/96", "ipv4-compatible"],
  ["100::/64", "discard"],
  ["2001::/32", "teredo"],
  ["2001:10::/28", "orchid"],
  ["2001:20::/28", "orchid"],
  ["2001:db8::/32", "documentation"],
  ["3fff::/20", "documentation"],
  ["fc00::/7", "unique-local"],
  ["fe80::/10", "link-local"],
  ["fec0::/10", "site-local"],
  ["ff00::/8", "multicast"],
];

const nonPublicList = new CidrList<string>([
  ...NON_PUBLIC_V4.map(([cidr, data]) => ({ cidr, data })),
  ...NON_PUBLIC_V6.map(([cidr, data]) => ({ cidr, data })),
]);

const MAPPED_V4 = parseCidr("::ffff:0:0/96")!;
const NAT64 = parseCidr("64:ff9b::/96")!;
const NAT64_LOCAL = parseCidr("64:ff9b:1::/48")!;
const SIX_TO_FOUR = parseCidr("2002::/16")!;

export interface IpClassification {
  public: boolean;
  reason?: string;
}

/**
 * Classifies an IP as public or not. Non-public covers private, loopback,
 * link-local (incl. cloud metadata 169.254.169.254), CGNAT, documentation,
 * multicast and reserved ranges, and IPv6 forms that embed such IPv4
 * addresses (IPv4-mapped, NAT64, 6to4).
 */
export function classifyIp(input: string): IpClassification {
  const p = parseIp(input);
  if (!p) return { public: false, reason: "invalid" };
  if (p.version === 6) {
    if (inParsedCidr(p, MAPPED_V4) || inParsedCidr(p, NAT64)) {
      const embedded = ipv4ToString(Number(p.value & BigInt(0xffffffff)));
      const inner = classifyIp(embedded);
      return inner.public ? { public: true } : { public: false, reason: `embedded-${inner.reason}` };
    }
    if (inParsedCidr(p, NAT64_LOCAL)) return { public: false, reason: "nat64-local" };
    if (inParsedCidr(p, SIX_TO_FOUR)) {
      const embedded = ipv4ToString(Number((p.value >> BigInt(80)) & BigInt(0xffffffff)));
      const inner = classifyIp(embedded);
      if (!inner.public) return { public: false, reason: `embedded-${inner.reason}` };
    }
  }
  const hit = nonPublicList.match(input);
  if (hit) return { public: false, reason: hit.data };
  return { public: true };
}

export function isPublicIp(input: string): boolean {
  return classifyIp(input).public;
}

/** "203.0.113.5" -> "5.113.0.203" (for in-addr style DNS lookups). */
export function reverseIPv4(input: string): string | null {
  const v = parseIPv4(input);
  if (v === null) return null;
  return ipv4ToString(v).split(".").reverse().join(".");
}

/** Reversed nibble form of an IPv6 address (for ip6 style DNS lookups). */
export function reverseIPv6Nibbles(input: string): string | null {
  const v = parseIPv6(input);
  if (v === null) return null;
  return v.toString(16).padStart(32, "0").split("").reverse().join(".");
}
