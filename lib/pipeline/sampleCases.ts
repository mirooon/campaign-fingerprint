/**
 * Synthetic case folders built from the bundled sample (`data/sample`): the format an analyst hands
 * over (saved page with its address in the "saved from url" comment, plus a screenshot of the ad).
 * Used by `scripts/demo-batch.ts`, `bun run demo` and the tests, so that a container without any
 * real material still has something to build a base from and to analyse. Reads and writes files.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeUrl } from "../osint/urls";
import { loadMapping, loadRecords, normalizeRecords } from "./ingest";
import type { Item } from "./types";

interface FixtureEntry {
  status: number;
  headers?: Record<string, string>;
  bodyFile?: string;
  body?: string;
}

export interface SampleCaseSpec {
  /** Name of the case folder to create. */
  name: string;
  /** Sample ad (`ad_id` from `ads.csv`) whose page and screenshot the case is made of. */
  itemId: string;
}

/** The sample's ads by id. */
export function sampleAds(sampleDir: string): Map<string, Item> {
  const { items } = normalizeRecords(loadRecords(path.join(sampleDir, "ads.csv")), loadMapping(path.join(sampleDir, "mapping.json")));
  return new Map(items.map((it) => [it.id, it]));
}

/**
 * Body of the page a link finally leads to in the recorded fixtures (address normalised as the fixtures key it, redirects followed, at most 5 hops),
 * with its final address; null when the link has no recorded page.
 */
function recordedPage(fixturesDir: string, url: string): { url: string; html: string } | null {
  const http = JSON.parse(readFileSync(path.join(fixturesDir, "http.json"), "utf8")) as Record<string, FixtureEntry>;
  let current = normalizeUrl(url)?.url ?? url;
  for (let hop = 0; hop < 5; hop++) {
    const entry = http[current];
    if (!entry) return null;
    const location = entry.headers?.location;
    if (location) {
      current = normalizeUrl(new URL(location, current).toString())?.url ?? location;
      continue;
    }
    const html = entry.bodyFile ? readFileSync(path.join(fixturesDir, entry.bodyFile), "utf8") : (entry.body ?? "");
    return { url: current, html };
  }
  return null;
}

/** Saved-page text: the browser's "saved from url" comment (what the importer reads the address from) in front of the HTML. */
export function savedPage(url: string, html: string): string {
  return `<!-- saved from url=(${String(url.length).padStart(4, "0")})${url} -->\n${html}`;
}

/**
 * Writes one case folder per spec under `outDir`: `strona.html` (the recorded page of the ad's link, when it
 * has one) and `zrzut.<ext>` (the ad's picture). Returns the folders created.
 */
export function writeSampleCases(sampleDir: string, outDir: string, specs: SampleCaseSpec[]): string[] {
  const ads = sampleAds(sampleDir);
  const fixtures = path.join(sampleDir, "fixtures");
  return specs.map(({ name, itemId }) => {
    const ad = ads.get(itemId);
    if (!ad) throw new Error(`the sample has no ad ${itemId}`);
    const dir = path.join(outDir, name);
    mkdirSync(dir, { recursive: true });
    const page = ad.landingUrl ? recordedPage(fixtures, ad.landingUrl) : null;
    if (page) writeFileSync(path.join(dir, "strona.html"), savedPage(page.url, page.html));
    if (ad.imagePath && existsSync(path.join(sampleDir, ad.imagePath))) copyFileSync(path.join(sampleDir, ad.imagePath), path.join(dir, `zrzut${path.extname(ad.imagePath)}`));
    return dir;
  });
}

/** Copies the pictures of the given sample ads into `outDir` as loose files (`<name>.<ext>`), for `--each-file` batches. */
export function writeSampleFiles(sampleDir: string, outDir: string, specs: SampleCaseSpec[]): string[] {
  const ads = sampleAds(sampleDir);
  mkdirSync(outDir, { recursive: true });
  return specs.map(({ name, itemId }) => {
    const ad = ads.get(itemId);
    if (!ad?.imagePath) throw new Error(`the sample has no image for ad ${itemId}`);
    const file = path.join(outDir, `${name}${path.extname(ad.imagePath)}`);
    copyFileSync(path.join(sampleDir, ad.imagePath), file);
    return file;
  });
}
