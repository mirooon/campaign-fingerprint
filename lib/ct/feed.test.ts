import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { appendFeed, feedDomains, readFeedTail, type CtFeedRecord } from "./feed";

const dir = mkdtempSync(path.join(tmpdir(), "ct-feed-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function record(domain: string, i = 0): CtFeedRecord {
  return {
    v: 1,
    type: "ct_candidate",
    observed_utc: new Date(Date.UTC(2026, 10, 19, 12, 0, i)).toISOString(),
    source: "replay",
    stream: null,
    domain,
    names: [domain],
    cert: { issuer: null, not_before: null, not_after: null, fingerprint: null, serial: null, log: null, log_url: null, cert_index: null, crtsh_id: null, seen_utc: null },
    candidate: { campaign_id: "K1", campaign_label: "", score: 0.9, kind: "template", template: null, similar_domains: [], tokens: [], evidence: [] },
    enrichment: null,
    status: "candidate",
    note: "",
  };
}

describe("CT feed (append-only JSONL)", () => {
  it("creates the directory and appends one JSON object per line, keeping earlier lines", () => {
    const file = path.join(dir, "nested", "ct.jsonl");
    appendFeed(file, record("a.example", 1));
    const first = readFileSync(file, "utf8");
    appendFeed(file, record("b.example", 2));
    const text = readFileSync(file, "utf8");
    expect(text.startsWith(first)).toBe(true);
    expect(text.trim().split("\n").map((l) => JSON.parse(l).domain)).toEqual(["a.example", "b.example"]);
  });

  it("reads the newest records first and skips malformed lines", () => {
    const file = path.join(dir, "tail.jsonl");
    for (let i = 0; i < 5; i++) appendFeed(file, record(`d${i}.example`, i));
    appendFileSync(file, "{broken json\n\n");
    appendFeed(file, record("d5.example", 5));
    expect(readFeedTail(file, 3).map((r) => r.domain)).toEqual(["d5.example", "d4.example", "d3.example"]);
    expect(feedDomains(file).size).toBe(6);
  });

  it("reads only the end of a large file without a partial first line", () => {
    const file = path.join(dir, "big.jsonl");
    for (let i = 0; i < 50; i++) appendFeed(file, record(`big${i}.example`, i));
    const recs = readFeedTail(file, 100, 2_000);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.length).toBeLessThan(50);
    expect(recs[0].domain).toBe("big49.example");
  });

  it("handles a missing or empty feed", () => {
    expect(readFeedTail(path.join(dir, "missing.jsonl"))).toEqual([]);
    const empty = path.join(dir, "empty.jsonl");
    writeFileSync(empty, "");
    expect(readFeedTail(empty)).toEqual([]);
    expect(feedDomains(path.join(dir, "missing.jsonl")).size).toBe(0);
  });
});
