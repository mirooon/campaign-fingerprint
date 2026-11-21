/**
 * Passive page fetcher: one GET per hop, redirects followed manually (max ~8)
 * with the full chain recorded, never executes JavaScript.
 *
 * Security properties:
 * - http/https only, re-validated on every hop (a redirect to file://, gopher://… is refused)
 * - SSRF guard at connection time: the DNS lookup used by the socket is replaced by a
 *   guarded lookup that rejects private, loopback, link-local, CGNAT, multicast and other
 *   non-public ranges (incl. IPv4-mapped/NAT64/6to4 forms). Because the check runs inside
 *   the socket's own lookup, a DNS-rebinding answer cannot slip in between check and connect.
 *   IP-literal hosts are checked before connecting. Keep-alive agents are disabled so every
 *   connection goes through the guard.
 * - total time budget (default 8 s) and a byte cap applied AFTER decompression (zip-bomb safe)
 */
import { createHash } from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import type { IncomingMessage } from "node:http";
import zlib from "node:zlib";
import { classifyIp, isIpAddress } from "./ip";

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

export type FetchErrorCode =
  | "invalid-url"
  | "blocked"
  | "timeout"
  | "too-many-redirects"
  | "network"
  | "tls";

export interface RedirectHop {
  url: string;
  status: number;
  location: string | null;
  kind: "http" | "meta-refresh";
}

export interface FetchPageResult {
  requestedUrl: string;
  finalUrl: string;
  status: number | null;
  ok: boolean;
  redirectChain: RedirectHop[];
  contentType: string | null;
  headers: Record<string, string>;
  bytes: number;
  truncated: boolean;
  /** Decoded text body for textual content types, otherwise null. */
  body: string | null;
  /** SHA-256 of the raw (decompressed) response body bytes, for evidence integrity. */
  bodySha256: string | null;
  /** User-Agent header sent with every request of the chain. */
  userAgent: string;
  remoteAddress: string | null;
  error: string | null;
  errorCode: FetchErrorCode | null;
  fetchedAt: string;
  durationMs: number;
}

export interface HopRequest {
  url: URL;
  headers: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
}

export interface HopResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  truncated: boolean;
  remoteAddress: string | null;
}

/** Performs exactly one request (no redirect handling). Injectable for tests and fixtures. */
export type HopFn = (req: HopRequest) => Promise<HopResponse>;

export type Resolver = (host: string) => Promise<Array<{ address: string; family: number }>>;

export interface FetchPageOptions {
  /** Total time budget for the whole redirect chain. Default 8000 ms. */
  timeoutMs?: number;
  /** Max decoded body bytes. Default 2 MiB. */
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
  acceptLanguage?: string;
  referer?: string;
  followMetaRefresh?: boolean;
  /** Accept invalid TLS certificates (scam sites often have them). Default from env FETCH_INSECURE_TLS. */
  insecureTls?: boolean;
  hop?: HopFn;
  resolver?: Resolver;
  /** Disables the SSRF guard. Only for tests against a local server. */
  unsafeAllowPrivateNetworks?: boolean;
}

export class FetchBlockedError extends Error {
  code = "EBLOCKED";
  constructor(message: string) {
    super(message);
    this.name = "FetchBlockedError";
  }
}

class FetchTimeoutError extends Error {
  code = "ETIMEDOUT";
  constructor(message: string) {
    super(message);
    this.name = "FetchTimeoutError";
  }
}

const TEXTUAL = /^(text\/|application\/(xhtml\+xml|xml|json|ld\+json|javascript|rss\+xml|atom\+xml))/i;
const KEEP_HEADERS = [
  "content-type",
  "content-length",
  "server",
  "x-powered-by",
  "location",
  "refresh",
  "last-modified",
  "cf-ray",
  "x-served-by",
  "via",
];

const defaultResolver: Resolver = (host) =>
  new Promise((resolve, reject) => {
    dns.lookup(host, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });

function assertPublicHost(hostname: string, allowPrivate: boolean): void {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate && isIpAddress(host)) {
    const c = classifyIp(host);
    if (!c.public) throw new FetchBlockedError(`blocked non-public address ${host} (${c.reason})`);
  }
  if (!allowPrivate && /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) {
    throw new FetchBlockedError(`blocked local hostname ${host}`);
  }
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

function guardedLookup(resolver: Resolver, allowPrivate: boolean) {
  return (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
    resolver(hostname)
      .then((addresses) => {
        if (!addresses.length) {
          const e: NodeJS.ErrnoException = new Error(`no addresses for ${hostname}`);
          e.code = "ENOTFOUND";
          throw e;
        }
        if (!allowPrivate) {
          for (const a of addresses) {
            const c = classifyIp(a.address);
            if (!c.public) {
              throw new FetchBlockedError(`blocked ${hostname} -> ${a.address} (${c.reason})`);
            }
          }
        }
        const wanted = options.family === 4 || options.family === 6 ? options.family : 0;
        const filtered = wanted ? addresses.filter((a) => a.family === wanted) : addresses;
        const list = filtered.length ? filtered : addresses;
        if (options.all) callback(null, list);
        else callback(null, list[0].address, list[0].family);
      })
      .catch((err: NodeJS.ErrnoException) => callback(err, ""));
  };
}

function pickHeaders(raw: IncomingMessage["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

/** Live single-request implementation over node:http/https with the SSRF guard. */
export function createLiveHop(opts: { resolver?: Resolver; allowPrivate?: boolean; insecureTls?: boolean } = {}): HopFn {
  const resolver = opts.resolver ?? defaultResolver;
  const allowPrivate = !!opts.allowPrivate;
  const insecureTls = opts.insecureTls ?? process.env.FETCH_INSECURE_TLS === "1";
  return (req) =>
    new Promise<HopResponse>((resolve, reject) => {
      const { url } = req;
      try {
        assertPublicHost(url.hostname, allowPrivate);
      } catch (e) {
        reject(e);
        return;
      }
      const isHttps = url.protocol === "https:";
      const mod = isHttps ? https : http;
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const request = mod.request(
        {
          protocol: url.protocol,
          hostname: url.hostname.replace(/^\[|\]$/g, ""),
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: "GET",
          headers: req.headers,
          agent: false,
          lookup: guardedLookup(resolver, allowPrivate) as unknown as typeof dns.lookup,
          ...(isHttps ? { rejectUnauthorized: !insecureTls, servername: isIpAddress(url.hostname) ? undefined : url.hostname } : {}),
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const headers = pickHeaders(res.headers);
          const remoteAddress = res.socket?.remoteAddress ?? null;
          if (status >= 300 && status < 400 && headers.location) {
            res.resume();
            finish(() => resolve({ status, headers, body: Buffer.alloc(0), truncated: false, remoteAddress }));
            request.destroy();
            return;
          }
          const encoding = (headers["content-encoding"] || "").toLowerCase().trim();
          let stream: NodeJS.ReadableStream = res;
          if (encoding === "gzip" || encoding === "x-gzip") stream = res.pipe(zlib.createGunzip());
          else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
          else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
          const chunks: Buffer[] = [];
          let size = 0;
          let truncated = false;
          stream.on("data", (chunk: Buffer) => {
            if (truncated) return;
            const room = req.maxBytes - size;
            if (chunk.length >= room) {
              chunks.push(chunk.subarray(0, room));
              size += room;
              truncated = true;
              finish(() =>
                resolve({ status, headers, body: Buffer.concat(chunks), truncated: true, remoteAddress }),
              );
              request.destroy();
              return;
            }
            chunks.push(chunk);
            size += chunk.length;
          });
          stream.on("end", () =>
            finish(() => resolve({ status, headers, body: Buffer.concat(chunks), truncated, remoteAddress })),
          );
          stream.on("error", (err: Error) => {
            // Decompression errors after partial data: return what we have.
            if (chunks.length) {
              finish(() => resolve({ status, headers, body: Buffer.concat(chunks), truncated: true, remoteAddress }));
            } else finish(() => reject(err));
          });
        },
      );
      const timer = setTimeout(() => {
        const err = new FetchTimeoutError(`timeout after ${req.timeoutMs} ms`);
        finish(() => reject(err));
        request.destroy(err);
      }, req.timeoutMs);
      request.on("error", (err) => finish(() => reject(err)));
      request.end();
    });
}

function sniffCharset(contentType: string | null, body: Buffer): string {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || "")?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return "utf-8";
  const head = body.subarray(0, 4096).toString("latin1");
  const meta =
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ??
    /<meta[^>]+content\s*=\s*["'][^"']*charset=([\w-]+)/i.exec(head)?.[1];
  return (meta || "utf-8").toLowerCase();
}

export function decodeBody(body: Buffer, contentType: string | null): string {
  const charset = sniffCharset(contentType, body);
  try {
    return new TextDecoder(charset, { fatal: false }).decode(body);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(body);
  }
}

/** Parses `<meta http-equiv="refresh" content="0; url=...">` (static, no JS). */
export function parseMetaRefresh(html: string, baseUrl: string): { delay: number; url: string } | null {
  const tags = html.slice(0, 200_000).match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (!/http-equiv\s*=\s*["']?refresh/i.test(tag)) continue;
    const content = /content\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const value = content?.[1] ?? content?.[2] ?? content?.[3];
    if (!value) continue;
    const m = /^\s*(\d+(?:\.\d+)?)?\s*[;,]?\s*(?:url\s*=\s*)?["']?([^"']*)["']?\s*$/i.exec(value);
    if (!m || !m[2]) continue;
    try {
      const target = new URL(m[2].trim(), baseUrl);
      if (target.protocol === "http:" || target.protocol === "https:") {
        return { delay: Number(m[1] ?? 0), url: target.toString() };
      }
    } catch {
      /* ignore malformed */
    }
  }
  return null;
}

function classifyError(err: unknown): { code: FetchErrorCode; message: string } {
  const e = err as NodeJS.ErrnoException;
  const message = e?.message || String(err);
  if (err instanceof FetchBlockedError || e?.code === "EBLOCKED") return { code: "blocked", message };
  if (err instanceof FetchTimeoutError || e?.code === "ETIMEDOUT") return { code: "timeout", message };
  if (typeof e?.code === "string" && /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(e.code)) {
    return { code: "tls", message };
  }
  return { code: "network", message };
}

interface ResourceResult {
  meta: FetchPageResult;
  raw: Buffer | null;
}

/**
 * Core redirect-following fetch. Returns metadata plus the raw (decompressed) body.
 * Never throws for network-level problems; they are reported in `meta.error`.
 */
export async function fetchResource(inputUrl: string, opts: FetchPageOptions = {}): Promise<ResourceResult> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 8;
  const followMeta = opts.followMetaRefresh ?? true;
  const hop =
    opts.hop ??
    createLiveHop({ resolver: opts.resolver, allowPrivate: opts.unsafeAllowPrivateNetworks, insecureTls: opts.insecureTls });
  const headers: Record<string, string> = {
    "user-agent": opts.userAgent ?? DEFAULT_USER_AGENT,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": opts.acceptLanguage ?? "pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7",
    "accept-encoding": "gzip, deflate, br",
  };
  if (opts.referer) headers.referer = opts.referer;

  const chain: RedirectHop[] = [];
  const meta: FetchPageResult = {
    requestedUrl: inputUrl,
    finalUrl: inputUrl,
    status: null,
    ok: false,
    redirectChain: chain,
    contentType: null,
    headers: {},
    bytes: 0,
    truncated: false,
    body: null,
    bodySha256: null,
    userAgent: headers["user-agent"],
    remoteAddress: null,
    error: null,
    errorCode: null,
    fetchedAt: new Date(started).toISOString(),
    durationMs: 0,
  };
  const fail = (code: FetchErrorCode, message: string): ResourceResult => {
    meta.errorCode = code;
    meta.error = message;
    meta.durationMs = Date.now() - started;
    return { meta, raw: null };
  };

  let current: URL;
  try {
    current = new URL(inputUrl);
  } catch {
    return fail("invalid-url", `invalid URL: ${inputUrl}`);
  }
  const seen = new Set<string>();

  for (let i = 0; ; i++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      return fail(i === 0 ? "invalid-url" : "blocked", `refusing non-http(s) URL: ${current.protocol}`);
    }
    meta.finalUrl = current.toString();
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) return fail("timeout", `timeout after ${timeoutMs} ms`);

    let res: HopResponse;
    try {
      res = await hop({ url: current, headers, timeoutMs: remaining, maxBytes });
    } catch (err) {
      const { code, message } = classifyError(err);
      return fail(code, message);
    }
    meta.status = res.status;
    meta.headers = Object.fromEntries(Object.entries(res.headers).filter(([k]) => KEEP_HEADERS.includes(k)));
    meta.contentType = res.headers["content-type"] ?? null;
    meta.remoteAddress = res.remoteAddress;

    let next: { url: string; status: number; location: string; kind: RedirectHop["kind"] } | null = null;
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      try {
        next = {
          url: new URL(res.headers.location, current).toString(),
          status: res.status,
          location: res.headers.location,
          kind: "http",
        };
      } catch {
        return fail("network", `invalid Location header: ${res.headers.location}`);
      }
    } else if (followMeta && res.status >= 200 && res.status < 300) {
      const ct = meta.contentType || "";
      if (/html/i.test(ct) || ct === "") {
        const refresh = parseMetaRefresh(decodeBody(res.body, meta.contentType), current.toString());
        if (refresh && refresh.delay <= 10 && refresh.url !== current.toString()) {
          next = { url: refresh.url, status: res.status, location: refresh.url, kind: "meta-refresh" };
        }
      }
    }

    if (next) {
      chain.push({ url: current.toString(), status: next.status, location: next.location, kind: next.kind });
      if (chain.length > maxRedirects || seen.has(next.url)) {
        return fail("too-many-redirects", `redirect limit (${maxRedirects}) or loop at ${next.url}`);
      }
      seen.add(current.toString());
      try {
        current = new URL(next.url);
      } catch {
        return fail("network", `invalid redirect target: ${next.url}`);
      }
      continue;
    }

    meta.ok = res.status >= 200 && res.status < 300;
    meta.bytes = res.body.length;
    meta.bodySha256 = createHash("sha256").update(res.body).digest("hex");
    meta.truncated = res.truncated;
    meta.durationMs = Date.now() - started;
    return { meta, raw: res.body };
  }
}

/** Fetches a page and decodes its body as text (for HTML/XML/JSON/text content types). */
export async function fetchPage(url: string, opts: FetchPageOptions = {}): Promise<FetchPageResult> {
  const { meta, raw } = await fetchResource(url, opts);
  if (raw && (meta.contentType === null || TEXTUAL.test(meta.contentType))) {
    meta.body = decodeBody(raw, meta.contentType);
  }
  return meta;
}

/** Fetches binary content (images, favicons) through the same guarded path. */
export async function fetchBinary(
  url: string,
  opts: FetchPageOptions = {},
): Promise<{ meta: FetchPageResult; data: Buffer | null }> {
  const { meta, raw } = await fetchResource(url, { followMetaRefresh: false, maxBytes: 5 * 1024 * 1024, ...opts });
  return { meta, data: meta.ok ? raw : null };
}
