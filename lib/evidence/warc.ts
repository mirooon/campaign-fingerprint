/**
 * HAR → WARC (ISO 28500) for the evidence pack: the traffic the analyst's browser recorded becomes a
 * `.warc.gz` that archive tools open (warcio, pywb, Wayback tools). Written directly: a warcinfo
 * record, then a request and a response record per HAR entry, each in its own gzip member, with
 * `WARC-Target-URI`, `WARC-Date` and the SHA-1 digest (base32) of the payload as WARC writers
 * write it. The input must be the redacted HAR (lib/osint/redact.ts), never the original: a WARC
 * keeps all headers it is given. Pure: bytes in, bytes out.
 */
import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";

interface HarHeader {
  name?: string;
  value?: string;
}
interface HarEntry {
  startedDateTime?: string;
  request?: { method?: string; url?: string; httpVersion?: string; headers?: HarHeader[]; postData?: { text?: string } };
  response?: { status?: number; statusText?: string; httpVersion?: string; headers?: HarHeader[]; content?: { text?: string; encoding?: string } };
}

export interface WarcResult {
  data: Buffer;
  /** Number of records, warcinfo included. */
  records: number;
  /** Target addresses of the entries, in HAR order. */
  targets: string[];
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Base32 (RFC 4648) of a SHA-1 digest, the form of `WARC-Payload-Digest`. */
function base32(buf: Buffer): string {
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}

/** Digest as written in WARC headers: `sha1:` and base32. */
const digest = (data: Buffer): string => `sha1:${base32(createHash("sha1").update(data).digest())}`;
/** WARC date: UTC to the second with `Z`; the fallback when the HAR gives none or an unreadable one. */
const warcDate = (iso: string | undefined, fallback: Date): string => {
  const t = iso ? Date.parse(iso) : NaN;
  return (Number.isNaN(t) ? fallback : new Date(t)).toISOString().replace(/\.\d+Z$/, "Z");
};

/** One record as bytes: header lines, a blank line, the block and the closing blank lines; compressed as its own gzip member. */
function record(headers: Record<string, string>, block: Buffer): Buffer {
  const head = Object.entries({ ...headers, "Content-Length": String(block.length) }).map(([k, v]) => `${k}: ${v}`);
  return gzipSync(Buffer.concat([Buffer.from(`WARC/1.0\r\n${head.join("\r\n")}\r\n\r\n`), block, Buffer.from("\r\n\r\n")]));
}

/** HTTP header lines joined with CRLF; entries without a name are skipped. */
const headerLines = (hs: HarHeader[] | undefined): string => (hs ?? []).filter((h) => h.name).map((h) => `${h.name}: ${h.value ?? ""}`).join("\r\n");

/** Body bytes of a HAR response: base64 decoded, otherwise the text as UTF-8; empty when the HAR holds no body. */
function bodyOf(e: HarEntry): Buffer {
  const c = e.response?.content;
  if (!c?.text) return Buffer.alloc(0);
  return c.encoding === "base64" ? Buffer.from(c.text, "base64") : Buffer.from(c.text, "utf8");
}

/** WARC of a (redacted) HAR text; throws when the text is not a HAR. */
export function harToWarc(harText: string, opts: { now: Date; tool: string }): WarcResult {
  const har = JSON.parse(harText) as { log?: { entries?: HarEntry[] } };
  if (!Array.isArray(har.log?.entries)) throw new Error("to nie jest HAR (brak log.entries)");
  const id = () => `<urn:uuid:${randomUUID()}>`;
  const created = warcDate(undefined, opts.now);
  const parts: Buffer[] = [record({ "WARC-Type": "warcinfo", "WARC-Date": created, "WARC-Record-ID": id(), "Content-Type": "application/warc-fields" }, Buffer.from(`software: ${opts.tool}\r\nformat: WARC File Format 1.0\r\ndescription: zapis ruchu przeglądarki (HAR) zredagowany z danych analityka\r\n`))];
  const targets: string[] = [];
  for (const e of har.log.entries) {
    const url = e.request?.url;
    if (!url || !e.response) continue;
    targets.push(url);
    const date = warcDate(e.startedDateTime, opts.now);
    const req = e.request!;
    const reqBody = Buffer.from(req.postData?.text ?? "", "utf8");
    const reqBlock = Buffer.concat([Buffer.from(`${req.method ?? "GET"} ${url} ${req.httpVersion ?? "HTTP/1.1"}\r\n${headerLines(req.headers)}\r\n\r\n`), reqBody]);
    const reqId = id();
    parts.push(record({ "WARC-Type": "request", "WARC-Target-URI": url, "WARC-Date": date, "WARC-Record-ID": reqId, "Content-Type": "application/http; msgtype=request", "WARC-Block-Digest": digest(reqBlock) }, reqBlock));
    const body = bodyOf(e);
    const res = e.response;
    const resBlock = Buffer.concat([Buffer.from(`${res.httpVersion ?? "HTTP/1.1"} ${res.status ?? 0} ${res.statusText ?? ""}\r\n${headerLines(res.headers)}\r\n\r\n`), body]);
    parts.push(record({ "WARC-Type": "response", "WARC-Target-URI": url, "WARC-Date": date, "WARC-Record-ID": id(), "WARC-Concurrent-To": reqId, "Content-Type": "application/http; msgtype=response", "WARC-Block-Digest": digest(resBlock), "WARC-Payload-Digest": digest(body) }, resBlock));
  }
  return { data: Buffer.concat(parts), records: parts.length, targets };
}
