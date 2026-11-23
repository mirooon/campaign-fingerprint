/**
 * CT watcher on the synthetic sample: replayed CertStream messages and a fake crt.sh backfill
 * go through the matcher, passive enrichment (fixtures) and the append-only feed.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadCtConfig } from "../lib/ct/config";
import { readFeedTail, type CtFeedRecord } from "../lib/ct/feed";
import { buildFingerprints, type FingerprintSet } from "../lib/ct/fingerprint";
import { replayCertstream, type CtStreamEvent } from "../lib/ct/stream";
import { CtWatcher, runBackfill } from "../lib/ct/watch";
import { Discounter } from "../lib/graph/weights";
import type { CtResult } from "../lib/osint/ct";
import type { FetchPageResult } from "../lib/osint/fetchPage";
import { fixtureSources } from "../lib/pipeline/sources";
import { runSample, SAMPLE } from "./sampleRun";

let tmp: string;
let set: FingerprintSet;
let assignments: Record<string, string>;

beforeAll(async () => {
  tmp = mkdtempSync(path.join(tmpdir(), "ct-watch-"));
  const run = await runSample();
  assignments = run.campaigns.assignments;
  const discounter = new Discounter(run.config);
  set = buildFingerprints(run.campaigns, {
    config: loadCtConfig(path.join(SAMPLE, "ct-lexicon.json")),
    graph: run.graph,
    isExcludedDomain: (d) => discounter.domainDiscount(d) !== null,
  });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const replayLines = () => readFileSync(path.join(SAMPLE, "ct-stream.jsonl"), "utf8").split("\n");
const event = (domains: string[]): CtStreamEvent => ({
  domains,
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
});

describe("CT watcher on the sample", () => {
  it("builds fingerprints without platform domains (shortener, public form service)", () => {
    expect(set.excluded).toEqual(["krotki.test", "web3forms.com"]);
    const c4 = set.campaigns.find((c) => c.campaignId === assignments["c4-01"])!;
    expect(c4.templates.map((t) => t.template)).toContain("zwrot<n>-<lorem><n>.*");
  });

  it("replay: new domains are attached to the nearest campaign; look-alikes, known and repeated domains are not", async () => {
    const feed = path.join(tmp, "replay.jsonl");
    const sources = fixtureSources(path.join(SAMPLE, "fixtures"));
    const fetchPage = vi.spyOn(sources, "fetchPage");
    const w = new CtWatcher({ set, feedFile: feed, source: "replay", stream: "ct-stream.jsonl", enrich: { sources } });
    const r = replayCertstream(replayLines(), (e) => w.handle(e));
    await w.flush();
    expect(r).toEqual({ messages: 17, events: 15 });
    const recs = readFeedTail(feed, 100);
    const got = recs.map((x) => [x.domain, x.candidate.campaign_id, x.candidate.kind]).sort();
    expect(got).toEqual(
      [
        ["fakt-dnia-24.example", assignments["c3-01"], "media"],
        ["kryptozysk-ai24.test", assignments["c1-01"], "brand"],
        ["pomoc77-dolorem12.example", assignments["c4-01"], "lorem_kit"],
        ["zwrot51-dolores33.invalid", assignments["c4-01"], "template_other_tld"],
        ["zwrot64-quia17.example", assignments["c4-01"], "template"],
      ].sort(),
    );
    // passive enrichment only: the page is never fetched without the explicit flag
    expect(fetchPage).not.toHaveBeenCalled();
    expect(recs.every((x) => x.enrichment !== null && x.enrichment.page === null)).toBe(true);
    const z = recs.find((x) => x.domain === "zwrot51-dolores33.invalid")!;
    expect(z.names).toEqual(["www.zwrot51-dolores33.invalid", "zwrot51-dolores33.invalid"]);
    expect(z.cert).toMatchObject({ issuer: "Demo CA (fikcyjny)", log: "Demo CT Log 2026 (fikcyjny)" });
    expect(z.candidate.similar_domains).toEqual(["zwrot24-dolorem51.test", "zwrot37-voluptas12.example", "zwrot88-praesentium40.example"]);
    expect(z.observed_utc).toMatch(/Z$/);
    expect(recs.every((x) => x.status === "candidate" && x.note.includes("not proof"))).toBe(true);

    // a restart reads the feed and does not report the same domains again
    const again = new CtWatcher({ set, feedFile: feed, source: "replay" });
    replayCertstream(replayLines(), (e) => again.handle(e));
    await again.flush();
    expect(again.stats.candidates).toBe(0);
    expect(readFeedTail(feed, 100)).toHaveLength(5);
  });

  it("fetches the page only with the explicit flag (one GET of https://<domain>/)", async () => {
    const sources = fixtureSources(path.join(SAMPLE, "fixtures"));
    const fetchPage = vi.fn(async (url: string) => ({ finalUrl: url, status: 200, body: "<title>Zwrot</title>", bodySha256: "ab", error: null }) as unknown as FetchPageResult);
    const got: CtFeedRecord[] = [];
    const w = new CtWatcher({ set, feedFile: null, source: "replay", enrich: { sources: { ...sources, fetchPage }, fetchPage: true }, onCandidate: (x) => got.push(x) });
    w.handle(event(["zwrot51-dolores33.invalid"]));
    await w.flush();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith("https://zwrot51-dolores33.invalid/");
    expect(got[0].enrichment?.page).toMatchObject({ status: 200, title: "Zwrot", body_sha256: "ab" });
  });

  it("caps enrichment per minute but still records the candidate", async () => {
    const got: CtFeedRecord[] = [];
    const w = new CtWatcher({ set, feedFile: null, source: "replay", enrich: { sources: fixtureSources(path.join(SAMPLE, "fixtures")), maxPerMinute: 1 }, onCandidate: (x) => got.push(x) });
    w.handle(event(["zwrot51-dolores33.invalid", "zwrot64-quia17.example"]));
    await w.flush();
    expect(got).toHaveLength(2);
    expect(got.filter((x) => x.enrichment?.skipped)).toHaveLength(1);
    expect(w.stats.enrichSkipped).toBe(1);
  });

  it("backfill: recent crt.sh certificates go through the same matcher; an unavailable pattern is reported", async () => {
    const feed = path.join(tmp, "backfill.jsonl");
    const cert = (id: string, name: string, logged: string) => ({ id, serial: id, issuer: "Demo CA", issuerName: "O=Demo CA", commonName: name, sanDomains: [name], notBefore: logged, notAfter: null, entryTimestamp: logged });
    const search = async (p: string): Promise<CtResult | null> =>
      p === "zwrot%"
        ? {
            domain: p,
            truncated: false,
            certs: [cert("111", "zwrot99-dolor12.example", "2026-11-18T00:00:01.000Z"), cert("112", "zwrot11-quia22.example", "2026-01-01T00:00:00.000Z"), cert("113", "zwrot-podatku.example", "2026-11-18T00:00:00.000Z")],
          }
        : null;
    const w = new CtWatcher({ set, feedFile: feed, source: "crtsh-backfill", stream: "zwrot%,brak%" });
    const res = await runBackfill({ watcher: w, patterns: ["zwrot%", "brak%"], sinceDays: 7, search, now: () => new Date("2026-11-19T12:00:00Z") });
    expect(res.patterns).toEqual([
      { pattern: "zwrot%", status: "ok", certificates: 3, recent: 2 },
      { pattern: "brak%", status: "unavailable", certificates: 0, recent: 0 },
    ]);
    expect(res.candidates).toBe(1);
    expect(readFeedTail(feed)[0]).toMatchObject({ domain: "zwrot99-dolor12.example", source: "crtsh-backfill", cert: { crtsh_id: "111", log_url: "https://crt.sh/?id=111" } });
  });
});
