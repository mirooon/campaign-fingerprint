/**
 * Perceptual image hashing with sharp:
 *   - dHash (difference hash, 9x8 grayscale, 64 bits) - robust to scaling,
 *     brightness and re-compression; the main near-duplicate signal
 *   - aHash (average hash, 8x8 grayscale, 64 bits)
 *   - Hamming distance between hex hashes
 *   - favicon hashes: Shodan-compatible mmh3 (http.favicon.hash), sha256 and
 *     dHash/aHash (ICO files are decoded through their embedded PNG entry)
 *
 * Hashes are 16 lower-case hex characters, row-major, most significant bit first.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";

export interface ImageHashes {
  dhash: string;
  ahash: string;
  width: number;
  height: number;
  format: string | null;
  /** SHA-256 of the file bytes: the same creative file, not just a similar picture (absent in old caches). */
  sha256?: string;
}

export type FaviconFormat = "ico" | "png" | "svg" | "jpeg" | "gif" | "webp" | "unknown";

export interface FaviconHashes {
  /** Shodan-compatible favicon hash (signed int32 MurmurHash3 of base64 with newlines). */
  mmh3: number;
  sha256: string;
  dhash: string | null;
  ahash: string | null;
  format: FaviconFormat;
}

/** Guard against decompression bombs (pixels, not bytes). */
const LIMIT_INPUT_PIXELS = 50_000_000;

function pipeline(input: Buffer) {
  return sharp(input, { failOn: "none", limitInputPixels: LIMIT_INPUT_PIXELS }).autoOrient();
}

function bitsToHex(bits: number[]): string {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    hex += nibble.toString(16);
  }
  return hex;
}

async function grayscalePixels(input: Buffer, width: number, height: number): Promise<number[]> {
  const { data, info } = await pipeline(input)
    .flatten({ background: "#ffffff" })
    .grayscale()
    .resize(width, height, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const out: number[] = [];
  for (let i = 0; i < width * height; i++) out.push(data[i * channels]);
  return out;
}

/** Difference hash: bit = pixel[x] < pixel[x + 1] on a 9x8 grayscale thumbnail. */
export async function dHash(input: Buffer): Promise<string> {
  const px = await grayscalePixels(input, 9, 8);
  const bits: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits.push(px[y * 9 + x] < px[y * 9 + x + 1] ? 1 : 0);
    }
  }
  return bitsToHex(bits);
}

/** Average hash: bit = pixel > mean on an 8x8 grayscale thumbnail. */
export async function aHash(input: Buffer): Promise<string> {
  const px = await grayscalePixels(input, 8, 8);
  const mean = px.reduce((s, v) => s + v, 0) / px.length;
  return bitsToHex(px.map((v) => (v > mean ? 1 : 0)));
}

export async function hashImage(input: Buffer): Promise<ImageHashes> {
  const meta = await sharp(input, { failOn: "none", limitInputPixels: LIMIT_INPUT_PIXELS }).metadata();
  const [dhash, ahash] = await Promise.all([dHash(input), aHash(input)]);
  return {
    dhash,
    ahash,
    width: meta.autoOrient?.width ?? meta.width ?? 0,
    height: meta.autoOrient?.height ?? meta.height ?? 0,
    format: meta.format ?? null,
    sha256: createHash("sha256").update(input).digest("hex"),
  };
}

/** Grayscale thumbnail (size x size, row-major, 0-255) for a pixel comparison of two pictures. */
export async function grayThumbnail(input: Buffer, size = 64): Promise<number[]> {
  return grayscalePixels(input, size, size);
}

/**
 * Share of pixels whose gray level differs by more than `level` between two thumbnails of the same
 * size. Re-compression and a brightness change move every pixel a little (share ~0); a sticker, a
 * crop or a changed headline moves a patch of pixels a lot (share of the patch area).
 */
export function differingPixelShare(a: number[], b: number[], level = 40): number {
  if (a.length !== b.length || !a.length) throw new Error(`Thumbnail size mismatch: ${a.length} vs ${b.length}`);
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > level) n++;
  return n / a.length;
}

const POPCOUNT_NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/** Hamming distance between two equal-length hex hashes. Throws on invalid input. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) throw new Error(`Hash length mismatch: ${a.length} vs ${b.length}`);
  if (!/^[0-9a-f]*$/i.test(a) || !/^[0-9a-f]*$/i.test(b)) throw new Error("Hashes must be hex strings");
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    d += POPCOUNT_NIBBLE[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  }
  return d;
}

/** MurmurHash3 x86_32; returns a SIGNED int32 like python's mmh3.hash(). */
export function murmurhash3_32(data: Uint8Array | string, seed = 0): number {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const len = bytes.length;
  const nblocks = len >>> 2;
  let h1 = seed | 0;

  for (let i = 0; i < nblocks; i++) {
    const o = i * 4;
    let k1 = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24);
    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);
    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
  }

  const tail = nblocks * 4;
  const rem = len & 3;
  let k1 = 0;
  if (rem >= 3) k1 ^= bytes[tail + 2] << 16;
  if (rem >= 2) k1 ^= bytes[tail + 1] << 8;
  if (rem >= 1) {
    k1 ^= bytes[tail];
    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);
    h1 ^= k1;
  }

  h1 ^= len;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;
  return h1 | 0;
}

/** python base64.encodebytes(): newline every 76 chars plus a trailing newline. */
function base64WithNewlines(buf: Buffer): string {
  const b64 = buf.toString("base64");
  if (!b64) return "";
  let out = "";
  for (let i = 0; i < b64.length; i += 76) out += `${b64.slice(i, i + 76)}\n`;
  return out;
}

/** Shodan `http.favicon.hash` value for raw favicon bytes. */
export function shodanFaviconHash(buf: Buffer): number {
  return murmurhash3_32(base64WithNewlines(buf));
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(buf: Buffer, offset = 0): boolean {
  return buf.length >= offset + 8 && buf.subarray(offset, offset + 8).equals(PNG_SIGNATURE);
}

function isIco(buf: Buffer): boolean {
  if (buf.length < 6) return false;
  const reserved = buf.readUInt16LE(0);
  const type = buf.readUInt16LE(2);
  const count = buf.readUInt16LE(4);
  return reserved === 0 && (type === 1 || type === 2) && count > 0 && buf.length >= 6 + count * 16;
}

/** Returns the largest PNG image embedded in an ICO/CUR file, or null. */
export function extractPngFromIco(buf: Buffer): Buffer | null {
  if (!isIco(buf)) return null;
  const count = buf.readUInt16LE(4);
  let best: { area: number; size: number; offset: number } | null = null;
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const width = buf[e] || 256;
    const height = buf[e + 1] || 256;
    const size = buf.readUInt32LE(e + 8);
    const offset = buf.readUInt32LE(e + 12);
    if (size === 0 || offset + size > buf.length || !isPng(buf, offset)) continue;
    const area = width * height;
    if (!best || area > best.area || (area === best.area && size > best.size)) best = { area, size, offset };
  }
  return best ? Buffer.from(buf.subarray(best.offset, best.offset + best.size)) : null;
}

function sniffFormat(buf: Buffer): FaviconFormat {
  if (isPng(buf)) return "png";
  if (isIco(buf)) return "ico";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString("latin1"))) return "gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") {
    return "webp";
  }
  const head = buf.subarray(0, 1024).toString("utf8").replace(/^﻿/, "").trimStart().toLowerCase();
  if (head.startsWith("<svg") || ((head.startsWith("<?xml") || head.startsWith("<!doctype svg")) && head.includes("<svg"))) {
    return "svg";
  }
  return "unknown";
}

/** Favicon hashes; never throws on undecodable input (perceptual hashes become null). */
export async function hashFavicon(buf: Buffer): Promise<FaviconHashes> {
  const format = sniffFormat(buf);
  const result: FaviconHashes = {
    mmh3: shodanFaviconHash(buf),
    sha256: createHash("sha256").update(buf).digest("hex"),
    dhash: null,
    ahash: null,
    format,
  };
  const decodable = format === "ico" ? extractPngFromIco(buf) : format === "unknown" ? null : buf;
  if (!decodable) return result;
  try {
    const [dhash, ahash] = await Promise.all([dHash(decodable), aHash(decodable)]);
    result.dhash = dhash;
    result.ahash = ahash;
  } catch {
    // undecodable image data: keep byte-level hashes only
  }
  return result;
}
