import QRCode from "qrcode";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { decodeQr, readQrAddresses } from "./qr";

/** Synthetic poster: a QR code of `text` centred on a grey canvas. */
async function poster(text: string): Promise<Buffer> {
  const qr = await QRCode.toBuffer(text, { margin: 4, width: 300 });
  return sharp({ create: { width: 600, height: 800, channels: 3, background: "#cccccc" } })
    .composite([{ input: qr, left: 150, top: 250 }])
    .png()
    .toBuffer();
}

describe("QR codes in images (B-222)", () => {
  it("decodes the URL of a QR code in a screenshot", async () => {
    const img = await poster("https://kampania.example.test/x");
    expect(await decodeQr(img)).toBe("https://kampania.example.test/x");
    const hits = await readQrAddresses("poster.png", { bytes: img });
    expect(hits.map((h) => h.host)).toEqual(["kampania.example.test"]);
    expect(hits[0].source).toBe("qr_code");
  });

  it("ignores non-URL payloads", async () => {
    expect(await readQrAddresses("w.png", { bytes: await poster("WIFI:S:net;T:WPA;P:secret;;") })).toEqual([]);
  });

  it("gives nothing for an image without a QR code", async () => {
    const plain = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#336699" } }).png().toBuffer();
    expect(await decodeQr(plain)).toBeNull();
    expect(await readQrAddresses("p.png", { bytes: plain })).toEqual([]);
  });
});
