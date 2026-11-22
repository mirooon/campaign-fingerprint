import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stampManifest } from "./tsa";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tsa-test-"));
  writeFileSync(path.join(dir, "manifest.sha256"), "abc  evidence.json\n");
  writeFileSync(path.join(dir, "evidence.json"), JSON.stringify({ integrity: { timestamp_token: null, timestamp_note: "x", manifest_sha256: "m" } }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const readIntegrity = () => JSON.parse(readFileSync(path.join(dir, "evidence.json"), "utf8")).integrity;
const now = () => new Date("2026-11-19T12:01:00Z");

describe("stampManifest", () => {
  it("writes the token of a recorded TSA response and records it in evidence.json", async () => {
    const res = await stampManifest(dir, "https://tsa.example/ts", {
      now,
      makeQuery: () => new Uint8Array([1, 2, 3]),
      fetchImpl: async () => new Response(new Uint8Array([9, 9, 9]), { status: 200, headers: { "content-type": "application/timestamp-reply" } }),
    });
    expect(res.ok).toBe(true);
    expect([...readFileSync(path.join(dir, "manifest.tsr"))]).toEqual([9, 9, 9]);
    const i = readIntegrity();
    expect(i.timestamp_token).toMatchObject({ file: "manifest.tsr", tsa: "https://tsa.example/ts", utc: "2026-11-19T12:01:00.000Z" });
    expect(i.timestamp_token.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("without a network leaves the token null and gives the reason", async () => {
    const res = await stampManifest(dir, "https://tsa.example/ts", {
      now,
      makeQuery: () => new Uint8Array([1]),
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(res).toEqual({ ok: false, reason: expect.stringContaining("ECONNREFUSED") });
    const i = readIntegrity();
    expect(i.timestamp_token).toBeNull();
    expect(i.timestamp_note).toMatch(/ECONNREFUSED/);
  });

  it("reports a missing openssl as the reason", async () => {
    const res = await stampManifest(dir, "https://tsa.example/ts", {
      now,
      makeQuery: () => {
        throw new Error("openssl: command not found");
      },
    });
    expect(res.ok).toBe(false);
    expect(readIntegrity().timestamp_note).toMatch(/openssl/);
  });
});
