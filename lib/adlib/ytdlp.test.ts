import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolRunner } from "../media/tools";
import { fetchAdCreative, parseYtDlpAd } from "./ytdlp";
import { ADLIB_FIXTURES } from "./testkit";

const recorded = readFileSync(path.join(ADLIB_FIXTURES, "ytdlp_meta_ad.json"), "utf8");

describe("creative of a library ad through yt-dlp", () => {
  it("reads the ad text, page, files and start time from the recorded yt-dlp JSON", () => {
    expect(parseYtDlpAd(recorded)).toEqual({
      text: "Zarabiaj z platforma AI, zobacz jak. Zapisz się dziś.",
      title: "Platforma AI dla każdego",
      imageUrl: "https://cdn.example/meta/101-thumb.jpg",
      videoUrl: "https://cdn.example/meta/101.mp4",
      uploader: "Inwestycje Przykladowe",
      uploaderId: "900000000001",
      startedAt: "2026-11-02T08:00:00.000Z",
    });
  });

  it("asks yt-dlp for the metadata only, for the library address of the ID (no download)", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const run: ToolRunner = async (cmd, args) => (calls.push({ cmd, args }), { code: 0, stdout: recorded, stderr: "", timedOut: false });
    const out = await fetchAdCreative("1000000000000101", { run, ytDlp: "/x/yt-dlp" });
    expect(out.error).toBeNull();
    expect(out.creative?.uploader).toBe("Inwestycje Przykladowe");
    expect(calls[0].cmd).toBe("/x/yt-dlp");
    expect(calls[0].args).toEqual(expect.arrayContaining(["--skip-download", "--dump-json", "--ignore-no-formats-error"]));
    expect(calls[0].args.at(-1)).toContain("id=1000000000000101");
  });

  it("says why there is no creative when yt-dlp is missing, fails or answers with something else", async () => {
    expect((await fetchAdCreative("1000000000000101", { ytDlp: null })).error).toContain("yt-dlp");
    const failing: ToolRunner = async () => ({ code: 1, stdout: "", stderr: "ERROR: Unsupported URL\nERROR: blocked", timedOut: false });
    expect((await fetchAdCreative("1000000000000101", { run: failing, ytDlp: "/x/yt-dlp" })).error).toContain("blocked");
    const junk: ToolRunner = async () => ({ code: 0, stdout: "not json", stderr: "", timedOut: false });
    expect((await fetchAdCreative("1000000000000101", { run: junk, ytDlp: "/x/yt-dlp" })).error).toContain("invalid yt-dlp answer");
  });
});
