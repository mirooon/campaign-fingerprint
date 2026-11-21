import { describe, expect, it } from "vitest";
import { parseCertstreamMessage, replayCertstream, runCtStream, type WebSocketFactory, type WebSocketLike } from "./stream";

const certMsg = (domains: string[]) =>
  JSON.stringify({
    message_type: "certificate_update",
    data: {
      update_type: "PrecertLogEntry",
      cert_index: 7,
      seen: 1763452800.5,
      source: { name: "Demo Log", url: "https://ct.example/log/" },
      leaf_cert: { all_domains: domains, not_before: 1763452740, not_after: 1771228800, serial_number: "0A1B", sha256: "AA:BB", issuer: { O: "Demo CA", CN: "R1" } },
    },
  });

describe("CertStream message parsing", () => {
  it("reads certificate_update (full/lite) and dns_entries (domains-only)", () => {
    const e = parseCertstreamMessage(certMsg(["WWW.Example.TEST", "example.test", "example.test"]))!;
    expect(e.domains).toEqual(["www.example.test", "example.test"]);
    expect(e).toMatchObject({ issuer: "Demo CA", serial: "0A1B", fingerprint: "AA:BB", logName: "Demo Log", certIndex: 7, updateType: "PrecertLogEntry" });
    expect(e.seenUtc).toBe("2025-11-18T08:00:00.500Z");
    expect(e.notBefore).toBe("2025-11-18T07:59:00.000Z");
    expect(parseCertstreamMessage(JSON.stringify({ message_type: "dns_entries", data: ["a.example", 5, ""] }))?.domains).toEqual(["a.example"]);
  });

  it("ignores heartbeats, unknown types and malformed input", () => {
    expect(parseCertstreamMessage(JSON.stringify({ message_type: "heartbeat", timestamp: 1 }))).toBeNull();
    expect(parseCertstreamMessage(JSON.stringify({ message_type: "certificate_update", data: {} }))).toBeNull();
    expect(parseCertstreamMessage("not json")).toBeNull();
    expect(parseCertstreamMessage("[1,2]")).toBeNull();
  });

  it("replays saved messages line by line", () => {
    const seen: string[][] = [];
    const r = replayCertstream([certMsg(["a.example"]), "", "garbage", JSON.stringify({ message_type: "dns_entries", data: ["b.example"] })], (e) => seen.push(e.domains));
    expect(r).toEqual({ messages: 3, events: 2 });
    expect(seen).toEqual([["a.example"], ["b.example"]]);
  });
});

/** A scripted fake WebSocket: each URL gets a behaviour. */
class FakeSocket implements WebSocketLike {
  onopen: WebSocketLike["onopen"] = null;
  onmessage: WebSocketLike["onmessage"] = null;
  onerror: WebSocketLike["onerror"] = null;
  onclose: WebSocketLike["onclose"] = null;
  closed = false;
  pings = 0;
  constructor(script: (ws: FakeSocket) => void) {
    setTimeout(() => script(this), 0);
  }
  close() {
    this.closed = true;
  }
  ping() {
    this.pings++;
  }
  emit(data: string) {
    if (!this.closed) this.onmessage?.({ data });
  }
}

function fakes(scripts: Record<string, (ws: FakeSocket) => void>, made: FakeSocket[] = []): WebSocketFactory {
  return (url) => {
    const s = new FakeSocket(scripts[url] ?? ((ws) => ws.onerror?.({})));
    made.push(s);
    return s;
  };
}

const fast = { connectTimeoutMs: 100, firstMessageTimeoutMs: 100, idleTimeoutMs: 1_000, pingIntervalMs: 20, sleep: async () => {} };

describe("CT stream client", () => {
  it("reports 'unavailable' (no exception) when no stream can be reached", async () => {
    const res = await runCtStream({ ...fast, urls: ["ws://down-1", "ws://down-2"], onEvent: () => {}, factory: fakes({}) });
    expect(res.status).toBe("unavailable");
    expect(res.attempts.map((a) => a.url)).toEqual(["ws://down-1", "ws://down-2"]);
    expect(res.messages).toBe(0);
  });

  it("treats an open but silent stream as unavailable (e.g. a dead public endpoint)", async () => {
    const res = await runCtStream({ ...fast, urls: ["ws://silent"], onEvent: () => {}, factory: fakes({ "ws://silent": (ws) => ws.onopen?.({}) }) });
    expect(res.status).toBe("unavailable");
    expect(res.attempts[0].outcome).toMatch(/brak danych/);
  });

  it("falls back to the next URL, delivers events and stops after the duration", async () => {
    const made: FakeSocket[] = [];
    const events: string[][] = [];
    const res = await runCtStream({
      ...fast,
      urls: ["ws://local", "ws://public"],
      durationMs: 150,
      onEvent: (e) => events.push(e.domains),
      factory: fakes(
        {
          "ws://public": (ws) => {
            ws.onopen?.({});
            ws.emit(certMsg(["a.example"]));
            ws.emit(JSON.stringify({ message_type: "heartbeat" }));
            ws.emit(JSON.stringify({ message_type: "dns_entries", data: ["b.example"] }));
          },
        },
        made,
      ),
    });
    expect(res.status).toBe("stopped");
    expect(res.url).toBe("ws://public");
    expect(res.messages).toBe(3);
    expect(events).toEqual([["a.example"], ["b.example"]]);
    expect(made.every((s) => s.closed)).toBe(true);
    expect(made[1].pings).toBeGreaterThan(0); // certstream-server-go needs client pings
  });

  it("reconnects after a working stream ends and gives up when it stays down", async () => {
    let round = 0;
    const res = await runCtStream({
      ...fast,
      urls: ["ws://flaky"],
      onEvent: () => {},
      factory: () =>
        new FakeSocket((ws) => {
          if (round++ === 0) {
            ws.onopen?.({});
            ws.emit(certMsg(["a.example"]));
            ws.onclose?.({ code: 1006 });
          } else ws.onerror?.({});
        }),
    });
    expect(res.status).toBe("unavailable");
    expect(res.messages).toBe(1);
    expect(res.attempts.map((a) => a.outcome)).toEqual(["zamknięte (1006)", "błąd połączenia"]);
  });

  it("stops cleanly on abort", async () => {
    const ac = new AbortController();
    const p = runCtStream({ ...fast, urls: ["ws://ok"], signal: ac.signal, onEvent: () => ac.abort(), factory: fakes({ "ws://ok": (ws) => (ws.onopen?.({}), ws.emit(certMsg(["a.example"]))) }) });
    expect((await p).status).toBe("aborted");
  });
});
