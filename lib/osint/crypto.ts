/**
 * Conservative cryptocurrency address detection.
 *
 * Every candidate found by a regex is validated with the real checksum
 * (Base58Check, bech32/bech32m, EIP-55), so random strings that merely look
 * like addresses are dropped. Supported: Bitcoin (legacy P2PKH/P2SH and
 * bech32/bech32m SegWit, mainnet only), Ethereum/EVM (0x + 40 hex) and TRON.
 *
 * Pure functions, no network access.
 */
import { createHash } from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3.js";

export type WalletKind = "btc" | "eth" | "tron";

export interface WalletMatch {
  kind: WalletKind;
  /** Canonical form: BTC base58 as-is, bech32 lower-case, ETH lower-case, TRON as-is. */
  address: string;
}

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP = new Map<string, number>([...B58_ALPHABET].map((c, i) => [c, i]));

/** Decodes a Base58 string to bytes; null on invalid characters. */
export function base58Decode(input: string): Uint8Array | null {
  if (!input) return null;
  let num = BigInt(0);
  const base = BigInt(58);
  for (const ch of input) {
    const v = B58_MAP.get(ch);
    if (v === undefined) return null;
    num = num * base + BigInt(v);
  }
  const bytes: number[] = [];
  const byteMask = BigInt(0xff);
  const eight = BigInt(8);
  while (num > BigInt(0)) {
    bytes.push(Number(num & byteMask));
    num >>= eight;
  }
  bytes.reverse();
  let leadingZeros = 0;
  for (const ch of input) {
    if (ch === "1") leadingZeros++;
    else break;
  }
  return Uint8Array.from([...new Array<number>(leadingZeros).fill(0), ...bytes]);
}

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

/** Base58Check decode: returns the payload (version byte included) or null. */
export function base58CheckDecode(input: string): Uint8Array | null {
  const raw = base58Decode(input);
  if (!raw || raw.length < 5) return null;
  const payload = raw.subarray(0, raw.length - 4);
  const checksum = raw.subarray(raw.length - 4);
  const digest = sha256(sha256(payload));
  for (let i = 0; i < 4; i++) {
    if (digest[i] !== checksum[i]) return null;
  }
  return payload;
}

/** Bitcoin mainnet legacy address (P2PKH "1…" or P2SH "3…") with a valid Base58Check checksum. */
export function isValidBtcBase58(addr: string): boolean {
  if (!/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(addr)) return false;
  const payload = base58CheckDecode(addr);
  if (!payload || payload.length !== 21) return false;
  return payload[0] === 0x00 || payload[0] === 0x05;
}

/** TRON address ("T…", 34 chars) with a valid Base58Check checksum and 0x41 prefix. */
export function isValidTronAddress(addr: string): boolean {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) return false;
  const payload = base58CheckDecode(addr);
  return !!payload && payload.length === 21 && payload[0] === 0x41;
}

// ---------------------------------------------------------------------------
// bech32 / bech32m (BIP-173, BIP-350)
// ---------------------------------------------------------------------------

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;
const BECH32_GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function bech32Polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = (((chk & 0x1ffffff) << 5) ^ v) >>> 0;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) chk = (chk ^ BECH32_GENERATORS[i]) >>> 0;
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  const maxAcc = (1 << (from + to - 1)) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) return null;
    acc = ((acc << from) | value) & maxAcc;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) {
    return null;
  }
  return out;
}

interface Bech32Decoded {
  hrp: string;
  data: number[];
  encoding: "bech32" | "bech32m";
}

function bech32Decode(input: string): Bech32Decoded | null {
  if (input.length < 8 || input.length > 90) return null;
  const lower = input.toLowerCase();
  const upper = input.toUpperCase();
  if (input !== lower && input !== upper) return null; // mixed case is invalid
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 33 || c > 126) return null;
  }
  const sep = lower.lastIndexOf("1");
  if (sep < 1 || sep + 7 > lower.length) return null;
  const hrp = lower.slice(0, sep);
  const data: number[] = [];
  for (const ch of lower.slice(sep + 1)) {
    const v = BECH32_CHARSET.indexOf(ch);
    if (v < 0) return null;
    data.push(v);
  }
  const check = bech32Polymod([...bech32HrpExpand(hrp), ...data]);
  const encoding = check === BECH32_CONST ? "bech32" : check === BECH32M_CONST ? "bech32m" : null;
  if (!encoding) return null;
  return { hrp, data: data.slice(0, -6), encoding };
}

/** Bitcoin mainnet SegWit address ("bc1…"): bech32 for v0, bech32m for v1+ (BIP-173/350). */
export function isValidBech32Btc(addr: string): boolean {
  const decoded = bech32Decode(addr);
  if (!decoded || decoded.hrp !== "bc" || decoded.data.length < 1) return false;
  const version = decoded.data[0];
  if (version > 16) return false;
  const program = convertBits(decoded.data.slice(1), 5, 8, false);
  if (!program || program.length < 2 || program.length > 40) return false;
  if (version === 0) {
    if (program.length !== 20 && program.length !== 32) return false;
    return decoded.encoding === "bech32";
  }
  return decoded.encoding === "bech32m";
}

// ---------------------------------------------------------------------------
// Ethereum / EVM (EIP-55)
// ---------------------------------------------------------------------------

/** EIP-55 checksum casing of a 40-hex address (with 0x prefix). */
export function toEip55(addr: string): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return null;
  const lower = addr.slice(2).toLowerCase();
  const hash = keccak_256(new TextEncoder().encode(lower));
  let out = "0x";
  for (let i = 0; i < 40; i++) {
    const ch = lower[i];
    const nibble = i % 2 === 0 ? hash[i >> 1] >> 4 : hash[i >> 1] & 0x0f;
    out += /[a-f]/.test(ch) && nibble >= 8 ? ch.toUpperCase() : ch;
  }
  return out;
}

/**
 * 0x + exactly 40 hex chars. All-lower or all-upper hex carries no checksum
 * and is accepted; mixed case must match the EIP-55 checksum exactly.
 */
export function isValidEthAddress(addr: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return false;
  const hex = addr.slice(2);
  if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return true;
  return toEip55(addr) === addr;
}

// ---------------------------------------------------------------------------
// Detection in free text
// ---------------------------------------------------------------------------

const BTC_BASE58_RE = /(?<![A-Za-z0-9])[13][1-9A-HJ-NP-Za-km-z]{25,34}(?![A-Za-z0-9])/g;
const BTC_BECH32_RE = /(?<![A-Za-z0-9])bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,87}(?![A-Za-z0-9])/gi;
// ETH: the lookahead also rejects longer hex runs (e.g. the first 40 chars of a 64-hex tx hash).
const ETH_RE = /(?<![A-Za-z0-9])0x[0-9a-fA-F]{40}(?![A-Za-z0-9])/g;
const TRON_RE = /(?<![A-Za-z0-9])T[1-9A-HJ-NP-Za-km-z]{33}(?![A-Za-z0-9])/g;

/** Rejects degenerate EVM addresses (0x000…0, 0xEeee…, 0xffff…) used as placeholders. */
function isPlaceholderEth(addr: string): boolean {
  return new Set(addr.slice(2).toLowerCase()).size <= 2;
}

/** Finds checksum-valid wallet addresses in text, deduped, in order of first appearance. */
export function findWallets(text: string): WalletMatch[] {
  if (!text) return [];
  const hits: Array<{ index: number; match: WalletMatch }> = [];

  for (const m of text.matchAll(BTC_BASE58_RE)) {
    if (isValidBtcBase58(m[0])) hits.push({ index: m.index ?? 0, match: { kind: "btc", address: m[0] } });
  }
  for (const m of text.matchAll(BTC_BECH32_RE)) {
    if (isValidBech32Btc(m[0])) {
      hits.push({ index: m.index ?? 0, match: { kind: "btc", address: m[0].toLowerCase() } });
    }
  }
  for (const m of text.matchAll(ETH_RE)) {
    if (isValidEthAddress(m[0]) && !isPlaceholderEth(m[0])) {
      hits.push({ index: m.index ?? 0, match: { kind: "eth", address: m[0].toLowerCase() } });
    }
  }
  for (const m of text.matchAll(TRON_RE)) {
    if (isValidTronAddress(m[0])) hits.push({ index: m.index ?? 0, match: { kind: "tron", address: m[0] } });
  }

  hits.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const out: WalletMatch[] = [];
  for (const { match } of hits) {
    const key = `${match.kind}:${match.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(match);
  }
  return out;
}
