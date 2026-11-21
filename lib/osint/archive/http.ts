/**
 * HTTP edge of the archive adapters: one GET with a time limit, body decompression and the error
 * that says why a lookup could not be answered. The adapters take the GET as a parameter, so their
 * tests run on recorded answers without the network.
 */
import zlib from "node:zlib";

export interface ArchiveHttpResponse {
  status: number;
  /** Header names in lower case. */
  headers: Record<string, string>;
  /** Body bytes as received (may still be gzip or zstd: see `decodeBody`). */
  body: Buffer;
}

export type ArchiveHttp = (url: string, opts: { headers?: Record<string, string>; timeoutMs: number }) => Promise<ArchiveHttpResponse>;

/** A lookup that the service could not answer (limit, timeout, network): the reason is shown in the step report. */
export class ArchiveLookupError extends Error {
  constructor(
    readonly source: "urlscan" | "wayback",
    readonly reason: string,
    /** Seconds after which asking again makes sense (from `Retry-After`), when the service said so. */
    readonly retryAfterS?: number,
  ) {
    super(`${source}: ${reason}`);
    this.name = "ArchiveLookupError";
  }
}

/** zstd of node:zlib (Node 22.15+, Bun); the installed @types/node does not declare it yet. */
const zstdDecompressSync = (zlib as unknown as { zstdDecompressSync?: (buf: Buffer, opts: { maxOutputLength: number }) => Buffer }).zstdDecompressSync;

const GZIP_MAGIC = [0x1f, 0x8b];
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

function startsWith(buf: Buffer, magic: number[]): boolean {
  return buf.length >= magic.length && magic.every((b, i) => buf[i] === b);
}

/**
 * Body of a capture without the transfer compression. Archive copies (`id_` variant) are sometimes
 * still gzip or zstd although the headers do not say so, so the format is read from the first bytes;
 * any other body is returned unchanged. A body that grows past `maxBytes` after decompression (a zip
 * bomb, a huge page) throws RangeError instead of filling memory.
 */
export function decodeBody(buf: Buffer, maxBytes: number): Buffer {
  const limit = { maxOutputLength: maxBytes };
  try {
    if (startsWith(buf, GZIP_MAGIC)) return zlib.gunzipSync(buf, limit);
    if (startsWith(buf, ZSTD_MAGIC)) {
      if (!zstdDecompressSync) throw new Error("kopia skompresowana zstd, a ta wersja Node nie ma dekompresji zstd (potrzebny Node 22.15+)");
      return zstdDecompressSync(buf, limit);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") throw new RangeError(`treść po dekompresji większa niż ${maxBytes} B`);
    throw e;
  }
  if (buf.length > maxBytes) throw new RangeError(`treść większa niż ${maxBytes} B`);
  return buf;
}

/** Production GET: follows redirects and stops after `timeoutMs`. The body is as received (fetch undoes a declared Content-Encoding); callers pass it through `decodeBody`. */
export const fetchHttp: ArchiveHttp = async (url, opts) => {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(opts.timeoutMs), headers: opts.headers });
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
  return { status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) };
};
