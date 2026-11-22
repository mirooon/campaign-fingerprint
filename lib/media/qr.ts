/**
 * QR codes in screenshots and posters (B-222): the printed code of a poster or an ad creative often holds the address
 * of the landing page. Pure JS (`jsqr` over RGBA pixels from `sharp`), no external tool; an image without a code, or
 * an unreadable one, gives nothing. A decoded http(s) URL enters the material's observed addresses like an address
 * read by OCR.
 */
import jsQR from "jsqr";
import sharp from "sharp";
import { PLATFORM_DOMAINS } from "../text/addressBar";
import { normalizeUrl, registrableDomain } from "../osint/urls";
import type { ObservedAddress } from "./addressBar";

/** Longest side (px) the image is scaled down to before decoding; QR codes survive this and the decode stays fast. */
const MAX_SIDE = 1600;

/**
 * Decoded text of the QR code in an image (file path or bytes), or null when there is none or the image is unreadable.
 */
export async function decodeQr(input: Buffer | string): Promise<string | null> {
  try {
    const { data, info } = await sharp(input, { failOn: "none", limitInputPixels: 80_000_000 })
      .autoOrient()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const code = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
    return code?.data?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Addresses encoded in the QR code of one image, shaped like the ones read from an address bar (source `qr_code`).
 * Only http(s) URLs (or bare domains) count; other payloads (Wi-Fi, vCard, plain text) are ignored.
 */
export async function readQrAddresses(file: string, opts: { bytes?: Buffer } = {}): Promise<ObservedAddress[]> {
  const text = await decodeQr(opts.bytes ?? file);
  if (!text || /^(?!https?:\/\/)[a-z][a-z0-9+.-]*:/i.test(text)) return [];
  const norm = normalizeUrl(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  if (!norm?.host || !norm.host.includes(".")) return [];
  const rd = registrableDomain(norm.host);
  return [{ url: norm.url, host: norm.host, line: text, inAppBrowser: null, platform: !!rd && PLATFORM_DOMAINS.has(rd), confidence: "high", file, source: "qr_code" }];
}
