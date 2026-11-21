import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { readAddressBar, readAddressBarVideo, topStrip } from "./addressBar";
import type { ToolRunner } from "./tools";

const phone = () => sharp({ create: { width: 1170, height: 2532, channels: 3, background: "#ffffff" } }).png().toBuffer();

describe("address bar from screenshots and recordings", () => {
  it("cuts the top strip of a phone screenshot", async () => {
    const meta = await sharp((await topStrip(await phone()))!).metadata();
    expect([meta.width, meta.height]).toEqual([1170, 354]);
  });

  it("reads the landing host from the strip of a screenshot", async () => {
    const run: ToolRunner = async (cmd) => ({ code: cmd === "tesseract" ? 0 : 1, stdout: "10:15\n8 traf-77spin.example.com\nX Instagram", stderr: "", timedOut: false });
    const hits = await readAddressBar("zrzut.png", { run, bytes: await phone() });
    expect(hits).toEqual([expect.objectContaining({ host: "traf-77spin.example.com", inAppBrowser: "Instagram", source: "address_bar", file: "zrzut.png" })]);
  });

  it("skips a square ad video and reads nothing without ffprobe", async () => {
    const square: ToolRunner = async (cmd) => ({ code: 0, stdout: cmd === "ffprobe" ? "500x500\n" : "", stderr: "", timedOut: false });
    expect(await readAddressBarVideo("ad.mp4", { run: square })).toEqual([]);
    const none: ToolRunner = async () => ({ code: null, stdout: "", stderr: "", timedOut: false });
    expect(await readAddressBarVideo("rec.mp4", { run: none })).toEqual([]);
  });
});
