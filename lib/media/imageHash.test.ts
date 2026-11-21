import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  aHash,
  dHash,
  extractPngFromIco,
  hammingDistance,
  hashFavicon,
  hashImage,
  murmurhash3_32,
  shodanFaviconHash,
} from "./imageHash";

/** Builds a PNG from a grayscale pixel function. */
async function grayPng(width: number, height: number, f: (x: number, y: number) => number): Promise<Buffer> {
  const data = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = Math.max(0, Math.min(255, Math.round(f(x, y))));
  }
  return sharp(data, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

const wave = (x: number, y: number) => 120 + 80 * Math.sin(x * 0.09 + Math.sin(y * 0.05) * 2);

/** Ad-creative-like layout: gradient background, dark box, bright disc, stripe banner. */
const poster = (x: number, y: number) => {
  let v = 60 + x * 0.6 + y * 0.3;
  if (x > 20 && x < 90 && y > 20 && y < 120) v = 30 + (y - 20) * 0.5;
  const dx = x - 145;
  const dy = y - 60;
  if (dx * dx + dy * dy < 900) v = 230 - Math.sqrt(dx * dx + dy * dy) * 2;
  if (y > 125 && y < 140 && Math.floor(x / 12) % 2 === 0) v = 240;
  return v;
};

/** A different layout (elements moved and inverted). */
const otherPoster = (x: number, y: number) => {
  let v = 200 - x * 0.5 - y * 0.2;
  if (x > 110 && x < 185 && y > 15 && y < 95) v = 40 + (x - 110) * 0.8;
  const dx = x - 55;
  const dy = y - 100;
  if (dx * dx + dy * dy < 1200) v = 25 + Math.sqrt(dx * dx + dy * dy) * 1.5;
  if (y < 12 && Math.floor(x / 9) % 2 === 1) v = 250;
  return v;
};

function buildIco(entries: Array<{ width: number; height: number; data: Buffer }>): Buffer {
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach((e, i) => {
    const o = 6 + i * 16;
    header[o] = e.width >= 256 ? 0 : e.width;
    header[o + 1] = e.height >= 256 ? 0 : e.height;
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(e.data.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += e.data.length;
  });
  return Buffer.concat([header, ...entries.map((e) => e.data)]);
}

/** Fake BMP (DIB) icon payload: BITMAPINFOHEADER-like bytes, not decodable by sharp. */
const fakeDib = Buffer.concat([Buffer.from([0x28, 0, 0, 0, 0x20, 0, 0, 0, 0x40, 0, 0, 0]), Buffer.alloc(64, 7)]);

describe("dHash / aHash", () => {
  it("gives all ones for an increasing gradient and all zeros for a decreasing one", async () => {
    const inc = await grayPng(90, 80, (x) => (x * 255) / 89);
    const dec = await grayPng(90, 80, (x) => 255 - (x * 255) / 89);
    expect(await dHash(inc)).toBe("ffffffffffffffff");
    expect(await dHash(dec)).toBe("0000000000000000");
  });

  it("aHash of a left-dark/right-bright image", async () => {
    const half = await grayPng(64, 64, (x) => (x < 32 ? 10 : 245));
    expect(await aHash(half)).toBe("0f0f0f0f0f0f0f0f");
  });

  it("is stable under brightness shift, resizing and JPEG re-compression", async () => {
    const original = await grayPng(200, 150, poster);
    const brighter = await grayPng(200, 150, (x, y) => poster(x, y) + 15);
    const smallerJpeg = await sharp(original).resize(160, 120).jpeg({ quality: 80 }).toBuffer();
    const squashedJpeg = await sharp(original).resize(190, 142, { fit: "fill" }).jpeg({ quality: 75 }).toBuffer();

    const h0 = await dHash(original);
    expect(hammingDistance(h0, await dHash(brighter))).toBeLessThanOrEqual(6);
    expect(hammingDistance(h0, await dHash(smallerJpeg))).toBeLessThanOrEqual(6);
    // Non-proportional resize + lossy re-encode: still inside a typical near-duplicate threshold (10).
    expect(hammingDistance(h0, await dHash(squashedJpeg))).toBeLessThanOrEqual(10);
  });

  it("separates structurally different images", async () => {
    const original = await grayPng(200, 150, poster);
    const different = await grayPng(200, 150, otherPoster);
    const mirrored = await sharp(original).flop().png().toBuffer();
    const h0 = await dHash(original);
    expect(hammingDistance(h0, await dHash(different))).toBeGreaterThanOrEqual(20);
    expect(hammingDistance(h0, await dHash(mirrored))).toBeGreaterThanOrEqual(20);
  });

  it("hashImage reports hashes, size and format", async () => {
    const png = await grayPng(120, 80, wave);
    const h = await hashImage(png);
    expect(h.dhash).toMatch(/^[0-9a-f]{16}$/);
    expect(h.ahash).toMatch(/^[0-9a-f]{16}$/);
    expect(h).toMatchObject({ width: 120, height: 80, format: "png" });
  });

  it("flattens transparency onto white", async () => {
    const rgba = Buffer.alloc(32 * 32 * 4, 0); // fully transparent
    const png = await sharp(rgba, { raw: { width: 32, height: 32, channels: 4 } }).png().toBuffer();
    expect(await aHash(png)).toBe("0000000000000000");
  });
});

describe("hammingDistance", () => {
  it("counts differing bits", () => {
    expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0);
    expect(hammingDistance("0000000000000001", "0000000000000000")).toBe(1);
    expect(hammingDistance("8000000000000001", "0000000000000000")).toBe(2);
    expect(hammingDistance("ffffffffffffffff", "0000000000000000")).toBe(64);
    expect(hammingDistance("a5a5a5a5a5a5a5a5", "5A5A5A5A5A5A5A5A")).toBe(64);
  });

  it("rejects invalid input", () => {
    expect(() => hammingDistance("ff", "fff")).toThrow();
    expect(() => hammingDistance("zz", "00")).toThrow();
  });
});

describe("murmurhash3_32 / Shodan favicon hash", () => {
  // Reference values computed with python: mmh3.hash(...) and mmh3.hash(base64.encodebytes(...)).
  it("matches python mmh3 (signed int32)", () => {
    expect(murmurhash3_32("hello")).toBe(613153351);
    expect(murmurhash3_32("")).toBe(0);
    expect(murmurhash3_32("foo")).toBe(-156908512);
    expect(murmurhash3_32("hello", 42)).toBe(-488910111);
    expect(murmurhash3_32("zażółć")).toBe(269327944);
  });

  it("matches Shodan http.favicon.hash (base64 with 76-char lines)", () => {
    const twoRanges = Buffer.from([...Array.from({ length: 256 }, (_, i) => i), ...Array.from({ length: 256 }, (_, i) => i)]);
    expect(shodanFaviconHash(twoRanges)).toBe(-1173581353);
    expect(shodanFaviconHash(Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from("favicon-test")]))).toBe(1723114680);
    expect(shodanFaviconHash(Buffer.alloc(0))).toBe(0);
  });
});

describe("favicons", () => {
  it("extracts the embedded PNG from an ICO and hashes it", async () => {
    const png = await grayPng(16, 16, (x, y) => (x * 16 + y * 3) % 256);
    const ico = buildIco([
      { width: 32, height: 32, data: fakeDib },
      { width: 16, height: 16, data: png },
    ]);
    const extracted = extractPngFromIco(ico);
    expect(extracted?.equals(png)).toBe(true);

    const fav = await hashFavicon(ico);
    expect(fav.format).toBe("ico");
    expect(fav.dhash).toBe(await dHash(png));
    expect(fav.ahash).toBe(await aHash(png));
    expect(fav.mmh3).toBe(shodanFaviconHash(ico));
    expect(fav.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps byte-level hashes for BMP-only ICOs and garbage without throwing", async () => {
    const bmpIco = buildIco([{ width: 32, height: 32, data: fakeDib }]);
    expect(extractPngFromIco(bmpIco)).toBeNull();
    const fav = await hashFavicon(bmpIco);
    expect(fav).toMatchObject({ format: "ico", dhash: null, ahash: null });

    const junk = await hashFavicon(Buffer.from("definitely not an image"));
    expect(junk).toMatchObject({ format: "unknown", dhash: null, ahash: null });
    expect(typeof junk.mmh3).toBe("number");

    const brokenPng = await hashFavicon(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]));
    expect(brokenPng).toMatchObject({ format: "png", dhash: null, ahash: null });
    expect(extractPngFromIco(Buffer.from("not an ico"))).toBeNull();
  });

  it("decodes PNG and SVG favicons directly", async () => {
    const png = await grayPng(32, 32, wave);
    expect((await hashFavicon(png)).dhash).toBe(await dHash(png));
    const svg = Buffer.from(
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="16" height="32" fill="#000"/><rect x="16" width="16" height="32" fill="#fff"/></svg>',
    );
    const fav = await hashFavicon(svg);
    expect(fav.format).toBe("svg");
    expect(fav.ahash).toBe("0f0f0f0f0f0f0f0f");
  });
});
