/**
 * AI-generated still image of a person instead of a video (B-302), from FILE METADATA only: no detector
 * model, no guessing from pixels. Reads the bytes for markers that generators and editors leave: C2PA
 * content credentials (JUMBF "c2pa" with a generator claim), the IPTC digital source type
 * "trainedAlgorithmicMedia", and generator names in XMP/EXIF/PNG text chunks (Midjourney, DALL-E,
 * Stable Diffusion, Firefly, ...). A photo without such markers yields null ("no conclusion"), never "real".
 */

export interface AiImageMeta {
  /** Which kind of marker was found. */
  marker: "iptc-source-type" | "c2pa" | "generator-name";
  /** The matched generator or marker text (lower-case), for the reviewer. */
  detail: string;
}

/** Generator names that appear in the metadata of AI images (matched case-insensitively in text chunks). */
const GENERATORS = ["midjourney", "dall-e", "dall·e", "stable diffusion", "stablediffusion", "adobe firefly", "firefly", "imagen", "flux.1", "leonardo.ai", "ideogram", "gpt-image", "openai", "automatic1111", "comfyui", "sdxl", "nano banana"];

/**
 * Looks for AI-generation markers in the bytes of an image file (only the first 256 KB are scanned:
 * metadata sits in the header). Returns the strongest marker or null when there is none.
 */
export function detectAiImageMeta(bytes: Uint8Array): AiImageMeta | null {
  if (!bytes.length) return null;
  const head = Buffer.from(bytes.subarray(0, 262144)).toString("latin1").toLowerCase();
  if (head.includes("trainedalgorithmicmedia") || head.includes("compositewithtrainedalgorithmicmedia")) {
    return { marker: "iptc-source-type", detail: "trainedalgorithmicmedia" };
  }
  const gen = GENERATORS.find((g) => head.includes(g));
  if (head.includes("c2pa") && (head.includes("jumb") || head.includes("jumd"))) {
    return { marker: "c2pa", detail: gen ? `c2pa: ${gen}` : "c2pa" };
  }
  if (gen) return { marker: "generator-name", detail: gen };
  return null;
}
