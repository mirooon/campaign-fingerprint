/**
 * Certificate Transparency stream client (CertStream protocol over WebSocket).
 *
 * Works with a self-hosted certstream-server-go (docker compose --profile ct up -d certstream;
 * ws://127.0.0.1:8181/) and with any server speaking the same protocol, e.g. the public
 * CertStream. Read-only: the client only receives messages (plus WebSocket pings, which
 * certstream-server-go requires at least every 60 s).
 *
 * Unavailability is a normal outcome, not an exception: when no URL delivers data the
 * function resolves with status "unavailable" and the attempts made.
 */

export interface CtStreamEvent {
  /** Names from the certificate (SAN/CN), lower-case, wildcards kept as "*.x". */
  domains: string[];
  /** When the stream server saw the entry (UTC ISO), if reported. */
  seenUtc: string | null;
  issuer: string | null;
  notBefore: string | null;
  notAfter: string | null;
  fingerprint: string | null;
  serial: string | null;
  /** CT log name and URL. */
  logName: string | null;
  logUrl: string | null;
  certIndex: number | null;
  updateType: string | null;
}

type Json = Record<string, unknown>;
const rec = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const unixToIso = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? new Date(Math.round(v * 1000)).toISOString() : null);

/**
 * Parses one CertStream message: "certificate_update" (full/lite stream) or "dns_entries"
 * (domains-only stream). Heartbeats, unknown types and malformed JSON give null.
 */
export function parseCertstreamMessage(raw: string): CtStreamEvent | null {
  let msg: Json | null;
  try {
    msg = rec(JSON.parse(raw));
  } catch {
    return null;
  }
  if (!msg) return null;
  const type = msg.message_type;
  const empty: CtStreamEvent = {
    domains: [],
    seenUtc: null,
    issuer: null,
    notBefore: null,
    notAfter: null,
    fingerprint: null,
    serial: null,
    logName: null,
    logUrl: null,
    certIndex: null,
    updateType: null,
  };
  const cleanDomains = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.filter((d): d is string => typeof d === "string" && d.length > 0 && d.length < 254).map((d) => d.trim().toLowerCase()))] : [];
  if (type === "dns_entries") {
    const domains = cleanDomains(msg.data);
    return domains.length ? { ...empty, domains } : null;
  }
  if (type !== "certificate_update") return null;
  const data = rec(msg.data);
  const leaf = rec(data?.leaf_cert);
  if (!data || !leaf) return null;
  const domains = cleanDomains(leaf.all_domains);
  if (!domains.length) return null;
  const issuer = rec(leaf.issuer);
  const source = rec(data.source);
  return {
    domains,
    seenUtc: unixToIso(data.seen),
    issuer: str(issuer?.O) ?? str(issuer?.CN) ?? str(issuer?.aggregated),
    notBefore: unixToIso(leaf.not_before),
    notAfter: unixToIso(leaf.not_after),
    fingerprint: str(leaf.sha256) ?? str(leaf.fingerprint),
    serial: str(leaf.serial_number),
    logName: str(source?.name),
    logUrl: str(source?.url),
    certIndex: typeof data.cert_index === "number" ? data.cert_index : null,
    updateType: str(data.update_type),
  };
}

/** The subset of the WebSocket API the client uses (the global WebSocket in Bun/Node, or a fake in tests). */
export interface WebSocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  close(code?: number, reason?: string): void;
  /** Bun's client exposes ping(); certstream-server-go drops clients that send no ping for 60 s. */
  ping?: () => void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

const defaultFactory: WebSocketFactory = (url) => new WebSocket(url) as unknown as WebSocketLike;

export interface CtStreamOptions {
  /** Tried in order; the first one that delivers data is used. */
  urls: string[];
  onEvent: (event: CtStreamEvent) => void;
  log?: (message: string) => void;
  factory?: WebSocketFactory;
  /** Time to open the socket. Default 10 s. */
  connectTimeoutMs?: number;
  /** An open socket that sends nothing for this long counts as unavailable. Default 20 s. */
  firstMessageTimeoutMs?: number;
  /** A working stream silent for this long is reconnected. Default 60 s. */
  idleTimeoutMs?: number;
  /** Interval of WebSocket pings. Default 30 s. */
  pingIntervalMs?: number;
  /** Reconnect after a working stream ends. Default true. */
  reconnect?: boolean;
  /** Maximum reconnects after a working stream ended. Default 20. */
  maxReconnects?: number;
  /** Stop after this many ms (demo, smoke test). */
  durationMs?: number | null;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
}

export interface CtStreamResult {
  status: "stopped" | "unavailable" | "aborted";
  /** URL of the last working stream. */
  url: string | null;
  messages: number;
  events: number;
  attempts: Array<{ url: string; outcome: string }>;
}

type SessionOutcome = { kind: "unavailable" | "ended" | "stopped"; reason: string };

export async function runCtStream(opts: CtStreamOptions): Promise<CtStreamResult> {
  const factory = opts.factory ?? defaultFactory;
  const log = opts.log ?? (() => {});
  const connectTimeoutMs = opts.connectTimeoutMs ?? 10_000;
  const firstMessageTimeoutMs = opts.firstMessageTimeoutMs ?? 20_000;
  const idleTimeoutMs = opts.idleTimeoutMs ?? 60_000;
  const pingIntervalMs = opts.pingIntervalMs ?? 30_000;
  const maxReconnects = opts.maxReconnects ?? 20;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = opts.durationMs ? Date.now() + opts.durationMs : null;
  const result: CtStreamResult = { status: "stopped", url: null, messages: 0, events: 0, attempts: [] };
  const stopped = () => opts.signal?.aborted || (deadline !== null && Date.now() >= deadline);

  const session = (url: string): Promise<SessionOutcome> =>
    new Promise((resolve) => {
      let ws: WebSocketLike;
      let gotData = false;
      let lastMessage = Date.now();
      let done = false;
      const timers: Array<ReturnType<typeof setTimeout>> = [];
      const intervals: Array<ReturnType<typeof setInterval>> = [];
      const finish = (o: SessionOutcome) => {
        if (done) return;
        done = true;
        timers.forEach(clearTimeout);
        intervals.forEach(clearInterval);
        opts.signal?.removeEventListener("abort", onAbort);
        try {
          ws?.close();
        } catch {
          /* already closed */
        }
        resolve(o);
      };
      const onAbort = () => finish({ kind: "stopped", reason: "przerwano" });
      try {
        ws = factory(url);
      } catch (e) {
        resolve({ kind: "unavailable", reason: `nie można otworzyć: ${(e as Error).message}` });
        return;
      }
      opts.signal?.addEventListener("abort", onAbort);
      if (deadline !== null) timers.push(setTimeout(() => finish({ kind: "stopped", reason: "upłynął czas działania" }), Math.max(0, deadline - Date.now())));
      timers.push(setTimeout(() => finish({ kind: "unavailable", reason: "przekroczony czas połączenia" }), connectTimeoutMs));
      ws.onopen = () => {
        timers.push(
          setTimeout(() => {
            if (!gotData) finish({ kind: "unavailable", reason: `połączono, ale brak danych przez ${Math.round(firstMessageTimeoutMs / 1000)} s` });
          }, firstMessageTimeoutMs),
        );
        clearTimeout(timers[timers.length - 2]); // connect timeout no longer applies
        if (typeof ws.ping === "function") intervals.push(setInterval(() => ws.ping?.(), pingIntervalMs));
        intervals.push(
          setInterval(() => {
            if (gotData && Date.now() - lastMessage > idleTimeoutMs) finish({ kind: "ended", reason: "strumień ucichł" });
          }, Math.min(idleTimeoutMs, 5_000)),
        );
      };
      ws.onmessage = (ev) => {
        if (done) return;
        result.messages++;
        lastMessage = Date.now();
        if (!gotData) {
          gotData = true;
          result.url = url;
          log(`[ct] połączono ze strumieniem CT: ${url}`);
        }
        const event = parseCertstreamMessage(typeof ev.data === "string" ? ev.data : String(ev.data));
        if (event) {
          result.events++;
          try {
            opts.onEvent(event);
          } catch (e) {
            log(`[ct] błąd obsługi zdarzenia: ${(e as Error).message}`);
          }
        }
      };
      ws.onerror = () => finish(gotData ? { kind: "ended", reason: "błąd połączenia" } : { kind: "unavailable", reason: "błąd połączenia" });
      ws.onclose = (ev) =>
        finish(gotData ? { kind: "ended", reason: `zamknięte (${ev?.code ?? "?"})` } : { kind: "unavailable", reason: `zamknięte przed danymi (${ev?.code ?? "?"})` });
    });

  let reconnects = 0;
  for (;;) {
    let working = false;
    for (const url of opts.urls) {
      if (stopped()) break;
      const o = await session(url);
      result.attempts.push({ url, outcome: o.reason });
      if (o.kind === "stopped") {
        result.status = opts.signal?.aborted ? "aborted" : "stopped";
        return result;
      }
      if (o.kind === "ended") {
        working = true;
        log(`[ct] strumień ${url} zakończył się (${o.reason})`);
        break;
      }
      log(`[ct] ${url}: ${o.reason}`);
    }
    if (stopped()) {
      result.status = opts.signal?.aborted ? "aborted" : "stopped";
      return result;
    }
    if (!working) {
      result.status = "unavailable";
      return result;
    }
    if (opts.reconnect === false || reconnects >= maxReconnects) {
      result.status = "stopped";
      return result;
    }
    reconnects++;
    await sleep(Math.min(1_000 * 2 ** reconnects, 30_000));
  }
}

/** Replays CertStream messages saved one per line (offline demo and tests). */
export function replayCertstream(lines: string[], onEvent: (event: CtStreamEvent) => void): { messages: number; events: number } {
  let messages = 0;
  let events = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    messages++;
    const e = parseCertstreamMessage(line);
    if (e) {
      events++;
      onEvent(e);
    }
  }
  return { messages, events };
}
