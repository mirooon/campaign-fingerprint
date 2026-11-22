import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolRunner } from "../media/tools";
import { createMetaSource, parseMetaSearchOutput } from "./meta";
import { ADLIB_FIXTURES } from "./testkit";

const read = (f: string) => readFileSync(path.join(ADLIB_FIXTURES, f), "utf8");
const NOW = "2026-11-21T10:00:00.000Z";

describe("Meta source", () => {
  it("turns the recorded search output into records: advertiser page, payers, dates, creatives, landing address", () => {
    const recs = parseMetaSearchOutput(read("meta_search_output.json"), NOW);
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({
      platform: "meta",
      adId: "1000000000000501",
      fetchedAt: NOW,
      advertiser: { name: "Inwestycje Przykladowe", id: "900000000001", verified: false },
      payers: ["Testowa Spolka"],
      firstSeen: "2026-11-02T08:00:00.000Z",
      lastSeen: "2026-11-09T08:00:00.000Z",
      regions: ["PL"],
      landingUrl: "https://oferta-przyklad.example/lp?utm_source=fb",
    });
    expect(recs[0].libraryUrl).toContain("id=1000000000000501");
    expect(recs[0].creatives).toEqual([
      { kind: "text", text: "Zarabiaj z platforma AI, zobacz jak" },
      { kind: "image", url: "https://cdn.example/meta/501.jpg" },
    ]);
    expect(recs[1].creatives).toEqual([{ kind: "video", url: "https://cdn.example/meta/502.mp4" }]);
    expect(recs[1].lastSeen).toBeUndefined();
    expect(recs[1].advertiser?.verified).toBeNull();
  });

  it("reports an unreadable output as an error with the reason, not as an empty result", () => {
    expect(() => parseMetaSearchOutput("Traceback ...", NOW)).toThrow(/niepoprawny wynik/);
    expect(() => parseMetaSearchOutput(JSON.stringify({ error: "init: blocked" }), NOW)).toThrow(/init: blocked/);
  });

  it("is unavailable without the collector, with the way to install it", async () => {
    const src = createMetaSource({ env: { PATH: "/nonexistent" } });
    const a = await src.available();
    expect(a.ok).toBe(false);
    expect(a.reason).toContain("meta-ads-collector");
    expect(a.howToGetAccess).toContain("uv tool install meta-ads-collector");
  });

  it("passes keyword, country and limit to the helper and parses its output", async () => {
    const calls: string[][] = [];
    const run: ToolRunner = async (_cmd, args) => {
      calls.push(args);
      return { code: 0, stdout: read("meta_search_output.json"), stderr: "", timedOut: false };
    };
    const src = createMetaSource({ env: { META_ADS_PYTHON: "/x/python" }, run, now: () => NOW });
    const recs = await src.search({ keyword: "inwestycja", country: "PL", limit: 5, from: "2026-11-01" });
    expect(recs).toHaveLength(2);
    expect(calls[0]).toEqual(expect.arrayContaining(["--query", "inwestycja", "--country", "PL", "--limit", "5", "--from", "2026-11-01"]));
  });

  it("looks up one ad by its library ID through the existing adapter and maps the DSA data", async () => {
    const run: ToolRunner = async () => ({ code: 0, stdout: read("meta_get_output.json"), stderr: "", timedOut: false });
    const src = createMetaSource({ env: { META_ADS_PYTHON: "/x/python" }, run, now: () => NOW });
    const rec = await src.getAd("1000000000000101");
    expect(rec).toMatchObject({
      platform: "meta",
      adId: "1000000000000101",
      advertiser: { name: "Inwestycje Przykladowe", id: "900000000001" },
      payers: ["Testowa Spolka"],
      regions: ["Poland"],
    });
    expect(await src.getAd("1000000000000303")).toBeNull();
    expect(await src.getAd("not-an-id")).toBeNull();
  });

  it("adds the creative from yt-dlp to getAd on request, and notes when it is left out", async () => {
    const notes: string[] = [];
    const run: ToolRunner = async (cmd) => ({ code: 0, stdout: cmd === "/x/yt-dlp" ? read("ytdlp_meta_ad.json") : read("meta_get_output.json"), stderr: "", timedOut: false });
    const src = createMetaSource({ env: { META_ADS_PYTHON: "/x/python" }, run, now: () => NOW, creatives: true, ytDlp: "/x/yt-dlp" });
    const rec = await src.getAd("1000000000000101");
    expect(rec?.creatives).toEqual([
      { kind: "text", text: "Zarabiaj z platforma AI, zobacz jak. Zapisz się dziś." },
      { kind: "image", url: "https://cdn.example/meta/101-thumb.jpg" },
      { kind: "video", url: "https://cdn.example/meta/101.mp4" },
    ]);
    expect(rec?.firstSeen).toBe("2026-11-02T08:00:00.000Z");
    const without = createMetaSource({ env: { META_ADS_PYTHON: "/x/python" }, run, now: () => NOW, creatives: true, ytDlp: null, onNote: (m) => notes.push(m) });
    expect((await without.getAd("1000000000000101"))?.creatives).toEqual([]);
    expect(notes[0]).toContain("yt-dlp");
  });
});
