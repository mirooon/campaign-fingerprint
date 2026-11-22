import { describe, expect, it } from "vitest";
import { detectAiImageMeta } from "./aiImageMeta";

/** Builds fake image bytes: a JPEG-ish header followed by metadata text. */
const img = (meta: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), Buffer.from(meta, "latin1")]);

describe("detectAiImageMeta", () => {
  /** The IPTC digital source type marks generated media. */
  it("finds the IPTC source type", () => {
    expect(detectAiImageMeta(img('<x:xmpmeta Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/>'))?.marker).toBe("iptc-source-type");
  });
  /** A C2PA manifest and a generator name in a text chunk. */
  it("finds C2PA and generator names", () => {
    expect(detectAiImageMeta(img("jumb c2pa claim generator Midjourney"))).toEqual({ marker: "c2pa", detail: "c2pa: midjourney" });
    expect(detectAiImageMeta(img("tEXtparameters Stable Diffusion steps 20"))?.marker).toBe("generator-name");
  });
  /** No markers: no conclusion. */
  it("returns null for a plain photo", () => {
    expect(detectAiImageMeta(img("Exif Canon EOS"))).toBeNull();
    expect(detectAiImageMeta(new Uint8Array())).toBeNull();
  });
});
