/**
 * RFC 3161 time stamp on the manifest of an evidence pack (`--tsa <url>`): the query is made with
 * `openssl ts`, sent to the time-stamping authority, and the reply is stored as `manifest.tsr` next
 * to the manifest. A TSA is a network service, so this runs only when asked for; when openssl or
 * the network is missing the pack keeps `timestamp_token: null` and the reason. The reply is not
 * verified here (that needs the TSA's certificate chain): `openssl ts -verify` does it.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { timestampFields } from "./custody";

export interface StampOptions {
  /** Builds the DER query for the file (default: `openssl ts -query -sha256 -cert`). */
  makeQuery?: (file: string) => Uint8Array;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => Date;
  /** Request timeout in ms. */
  timeoutMs?: number;
}

export type StampResult = { ok: true; file: string } | { ok: false; reason: string };

/** DER time-stamp query for a file, made by openssl. */
function opensslQuery(file: string): Uint8Array {
  return execFileSync("openssl", ["ts", "-query", "-data", file, "-sha256", "-cert", "-no_nonce"], { maxBuffer: 1 << 20 });
}

/** Writes the outcome (token or reason) into `integrity` of evidence.json; the pack itself is otherwise untouched. */
function record(dir: string, fields: ReturnType<typeof timestampFields>): void {
  const file = path.join(dir, "evidence.json");
  const json = JSON.parse(readFileSync(file, "utf8")) as { integrity: Record<string, unknown> };
  Object.assign(json.integrity, fields);
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`, "utf8");
}

/**
 * Time-stamps `manifest.sha256` of the pack in `dir` at the TSA `url`. Success: `manifest.tsr` is
 * written and evidence.json names it; failure (no openssl, no network, an error status): nothing
 * is written but the reason in evidence.json and in the result.
 */
export async function stampManifest(dir: string, url: string, opts: StampOptions = {}): Promise<StampResult> {
  const now = opts.now ?? (() => new Date());
  const fail = (reason: string): StampResult => {
    record(dir, timestampFields(null, reason));
    return { ok: false, reason };
  };
  try {
    const query = (opts.makeQuery ?? opensslQuery)(path.join(dir, "manifest.sha256"));
    const res = await (opts.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/timestamp-query" },
      body: query as BodyInit,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
    if (!res.ok) return fail(`TSA odpowiedziała HTTP ${res.status}`);
    const token = Buffer.from(await res.arrayBuffer());
    writeFileSync(path.join(dir, "manifest.tsr"), token);
    record(dir, timestampFields({ file: "manifest.tsr", tsa: url, sha256: createHash("sha256").update(token).digest("hex"), utc: now().toISOString() }, null));
    return { ok: true, file: "manifest.tsr" };
  } catch (e) {
    return fail(`nie udało się uzyskać znacznika: ${(e as Error).message}`);
  }
}
