import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findStreamSegments, isMpegTs, stitchSegments } from "./hls";

const seg = (fill: number) => {
  const b = Buffer.alloc(376, fill);
  b[0] = 0x47;
  b[188] = 0x47;
  return b;
};

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "hls-"));
  const media = path.join(dir, "cap", "resources", "media");
  mkdirSync(media, { recursive: true });
  // natural order would put 10 after 2; the playlist says 10 plays first
  writeFileSync(path.join(media, "seg_2_aaaaaaaa.ts"), seg(2));
  writeFileSync(path.join(media, "seg_10_bbbbbbbb.ts"), seg(10));
  writeFileSync(path.join(media, "list_cccccccc.m3u8"), "#EXTM3U\n#EXTINF:10,\nseg_10.ts\n#EXTINF:10,\nseg_2.ts\n");
  const other = path.join(dir, "inne");
  mkdirSync(other);
  writeFileSync(path.join(other, "b_2.ts"), seg(5));
  writeFileSync(path.join(other, "b_10.ts"), seg(6));
  writeFileSync(path.join(other, "kod.ts"), "export const a = 1;\n");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("hls", () => {
  it("tells MPEG-TS from a TypeScript source", () => {
    expect(isMpegTs(path.join(dir, "inne", "b_2.ts"))).toBe(true);
    expect(isMpegTs(path.join(dir, "inne", "kod.ts"))).toBe(false);
  });
  it("finds segments per folder, in playlist order or else natural order", () => {
    const found = findStreamSegments(dir);
    const names = found.map((f) => f.segments.map((s) => path.basename(s)));
    expect(names).toEqual([["seg_10_bbbbbbbb.ts", "seg_2_aaaaaaaa.ts"], ["b_2.ts", "b_10.ts"]]);
  });
  it("stitches segments byte by byte", () => {
    const [first] = findStreamSegments(dir);
    const out = stitchSegments(first.segments, path.join(dir, "out", "v.ts"));
    expect(readFileSync(out)).toEqual(Buffer.concat([seg(10), seg(2)]));
  });
});
