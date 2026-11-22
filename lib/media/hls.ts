/**
 * Video of a landing page saved as an HLS stream: a `.m3u8` playlist and MPEG-TS segments (`.ts`),
 * as a page-capture tool or the browser stores the page's video player (e.g. a VSL with a deepfake
 * speaker). MPEG-TS segments of one stream join byte by byte, so the stitched file is read by ffmpeg
 * (frames, audio for ASR and the speaker) like any recording.
 */
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/** MPEG-TS segment names; ".ts" is checked for the sync byte, so TypeScript sources are never taken. */
const SEGMENT_EXT = /\.(ts|m2ts|mts)$/i;
const TS_PACKET = 188;
const SYNC = 0x47;
const MAX_DEPTH = 6;
/** Skip folders that never hold page media (version control, packages). */
const SKIP_DIRS = new Set([".git", "node_modules"]);

/** True when the file starts like MPEG-TS: the sync byte at the start of the first two 188-byte packets. */
export function isMpegTs(file: string): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(file, "r");
    const buf = Buffer.alloc(TS_PACKET + 1);
    const n = readSync(fd, buf, 0, buf.length, 0);
    if (n < 1 || buf[0] !== SYNC) return false;
    return n <= TS_PACKET || buf[TS_PACKET] === SYNC;
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** One saved stream: its segments in playing order (absolute paths) and the folder they lie in. */
export interface StreamSegments {
  dir: string;
  segments: string[];
}

/**
 * Segment name without the suffix a capture tool adds to keep names unique
 * ("output_000_0a1b2c3d.ts" -> "output_000.ts"), lower-cased, to match the playlist's entries.
 */
function playlistName(file: string): string {
  return path.basename(file).replace(/_[0-9a-f]{6,}(\.[^.]+)$/i, "$1").toLowerCase();
}

/** Segments in playlist order when a playlist of the folder names them; the rest in natural name order. */
function orderSegments(dir: string, files: string[]): string[] {
  const natural = [...files].sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }));
  let order: string[] = [];
  try {
    const lists = readdirSync(dir).filter((n) => /\.m3u8$/i.test(n));
    for (const l of lists) {
      order = readFileSync(path.join(dir, l), "utf8")
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter((x) => x && !x.startsWith("#"))
        .map((x) => path.basename(x.split("?")[0]).toLowerCase());
      if (order.length) break;
    }
  } catch {
    // an unreadable playlist: natural order
  }
  if (!order.length) return natural;
  const rank = new Map(order.map((n, i) => [n, i]));
  const at = (f: string) => rank.get(playlistName(f)) ?? Number.MAX_SAFE_INTEGER;
  return natural.map((f, i) => ({ f, i })).sort((a, b) => at(a.f) - at(b.f) || a.i - b.i).map((x) => x.f);
}

/** MPEG-TS segments under a case folder (also in `resources/` and `_files/`), one entry per folder. */
export function findStreamSegments(root: string): StreamSegments[] {
  const byDir = new Map<string, string[]>();
  const visit = (dir: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const p = path.join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name) && depth < MAX_DEPTH) visit(p, depth + 1);
      } else if (SEGMENT_EXT.test(name) && st.size > 0 && isMpegTs(p)) {
        byDir.set(dir, [...(byDir.get(dir) ?? []), p]);
      }
    }
  };
  visit(root, 0);
  return [...byDir].map(([dir, files]) => ({ dir, segments: orderSegments(dir, files) }));
}

/** Writes the segments one after another into `outFile` (folders created); returns its path. */
export function stitchSegments(segments: string[], outFile: string): string {
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, Buffer.concat(segments.map((s) => readFileSync(s))));
  return outFile;
}
