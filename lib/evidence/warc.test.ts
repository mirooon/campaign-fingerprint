import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { harToWarc } from "./warc";

const BODY = "<html><body>Oferta</body></html>";
const har = JSON.stringify({
  log: {
    entries: [
      {
        startedDateTime: "2026-01-15T09:10:01.250Z",
        request: { method: "GET", url: "https://lp.example/oferta?x=1", httpVersion: "HTTP/1.1", headers: [{ name: "Host", value: "lp.example" }] },
        response: { status: 200, statusText: "OK", httpVersion: "HTTP/1.1", headers: [{ name: "Content-Type", value: "text/html" }], content: { mimeType: "text/html", text: BODY } },
      },
      {
        startedDateTime: "2026-01-15T09:10:02.000Z",
        request: { method: "GET", url: "https://lp.example/logo.png", headers: [] },
        response: { status: 200, statusText: "OK", headers: [], content: { mimeType: "image/png", encoding: "base64", text: Buffer.from("PNG-1").toString("base64") } },
      },
    ],
  },
});

/** Records of a WARC file made of one gzip member per record: header lines and the block. */
function readWarc(data: Buffer): Array<{ headers: Record<string, string>; block: Buffer }> {
  const text = gunzipSync(data);
  const out: Array<{ headers: Record<string, string>; block: Buffer }> = [];
  let pos = 0;
  while (pos < text.length) {
    const end = text.indexOf("\r\n\r\n", pos);
    const lines = text.subarray(pos, end).toString("utf8").split("\r\n");
    expect(lines[0]).toBe("WARC/1.0");
    const headers = Object.fromEntries(lines.slice(1).map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
    const len = Number(headers["Content-Length"]);
    const block = text.subarray(end + 4, end + 4 + len);
    expect(text.subarray(end + 4 + len, end + 8 + len).toString()).toBe("\r\n\r\n");
    out.push({ headers, block });
    pos = end + 8 + len;
  }
  return out;
}

describe("harToWarc", () => {
  const res = harToWarc(har, { now: new Date("2026-11-19T12:00:00Z"), tool: "starter-test 0.0.0" });
  const records = readWarc(res.data);

  it("writes a warcinfo record, then a request and a response record per HAR entry, each with date and target", () => {
    expect(records.map((r) => r.headers["WARC-Type"])).toEqual(["warcinfo", "request", "response", "request", "response"]);
    const response = records[2];
    expect(response.headers["WARC-Target-URI"]).toBe("https://lp.example/oferta?x=1");
    expect(response.headers["WARC-Date"]).toBe("2026-01-15T09:10:01Z");
    expect(response.headers["WARC-Record-ID"]).toMatch(/^<urn:uuid:[0-9a-f-]{36}>$/);
    expect(response.headers["Content-Type"]).toBe("application/http; msgtype=response");
    expect(res.records).toBe(5);
    expect(res.targets).toEqual(["https://lp.example/oferta?x=1", "https://lp.example/logo.png"]);
  });

  it("puts the HTTP response in the block and the digest of the payload in the header", () => {
    const block = records[2].block.toString("utf8");
    expect(block.startsWith("HTTP/1.1 200 OK\r\n")).toBe(true);
    expect(block).toContain("Content-Type: text/html");
    expect(block.endsWith(`\r\n\r\n${BODY}`)).toBe(true);
    const sha1 = createHash("sha1").update(BODY).digest();
    expect(records[2].headers["WARC-Payload-Digest"]).toMatch(/^sha1:[A-Z2-7]{32}$/);
    expect(records[2].headers["WARC-Payload-Digest"]).toBe(`sha1:${base32(sha1)}`);
  });

  it("decodes a base64 body to its bytes", () => {
    expect(records[4].block.subarray(-5).toString()).toBe("PNG-1");
  });

  it("is an error for text that is not a HAR, so that nothing half-written is stored", () => {
    expect(() => harToWarc("<html>", { now: new Date(), tool: "t" })).toThrow();
  });
});

/** Base32 (RFC 4648, no padding for 20 bytes) as WARC writers write SHA-1 digests. */
function base32(buf: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}
