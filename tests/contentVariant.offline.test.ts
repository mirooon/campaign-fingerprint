/**
 * A variant of a known creative without infrastructure (a screenshot with a sticker, a crop) against a
 * synthetic run (recorded pages, no network): it joins the original's campaign as a variant when the
 * creative points to exactly one campaign, and never merges campaigns.
 * Run: campaign K (alfa-oferta.test, one tracker, creative A), campaigns K1 (beta-oferta.test) and
 * K2 (gamma-oferta.test) with the same creative B in two files (PNG and JPEG).
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clusterCampaigns } from "../lib/graph/cluster";
import { DEFAULT_LINK_CONFIG } from "../lib/graph/config";
import { buildEvidenceGraph } from "../lib/graph/link";
import type { CampaignsFile } from "../lib/graph/model";
import { analyzeMaterial, type MaterialItemResult } from "../lib/pipeline/analyzeMaterial";
import { enrichItems } from "../lib/pipeline/enrich";
import { fixtureSources } from "../lib/pipeline/sources";
import type { Item } from "../lib/pipeline/types";
import { SAMPLE } from "./sampleRun";

const IMAGES = path.join(SAMPLE, "images");
const TEXT_K = "Jan Testowy ujawnia sekret: platforma inwestycyjna daje 4000 zł dziennie bez ryzyka. Zarejestruj się dziś i odbierz bonus!";
const TEXT_1 = "Rowery miejskie w promocji, darmowa dostawa przez cały miesiąc i serwis w cenie.";
const TEXT_2 = "Kurs gotowania online z certyfikatem, pierwsza lekcja gratis dla nowych uczestników.";

let root: string;
let campaigns: CampaignsFile;

const page = (title: string, tracker: string, body: string) =>
  `<html><head><title>${title}</title><script async src="https://www.googletagmanager.com/gtag/js?id=${tracker}"></script></head><body><p>${body}</p></body></html>`;

/** Pages of the run and of the material with its own infrastructure (served from fixtures). */
const PAGES: Record<string, string> = {
  "https://alfa-oferta.test/start": page("Alfa start", "G-ALFA111111", TEXT_K),
  "https://alfa-oferta.test/oferta": page("Alfa oferta", "G-ALFA111111", TEXT_K),
  "https://beta-oferta.test/start": page("Beta start", "G-BETA222222", TEXT_1),
  "https://beta-oferta.test/oferta": page("Beta oferta", "G-BETA222222", TEXT_1),
  "https://gamma-oferta.test/start": page("Gamma start", "G-GAMM333333", TEXT_2),
  "https://gamma-oferta.test/oferta": page("Gamma oferta", "G-GAMM333333", TEXT_2),
  "https://delta-oferta.test/start": page("Delta start", "G-DELT444444", "Inna strona z inną infrastrukturą."),
};

function item(id: string, landingUrl: string, text: string, imagePath: string | null): Item {
  return { id, platform: "facebook", advertiser: null, text, imageUrl: null, imagePath, landingUrl, firstSeen: "2026-10-01", lastSeen: null, label: null, persona: null, deepfakeScore: null, videoPath: null, extra: {} };
}

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "content-variant-"));
  const img = path.join(root, "obrazy");
  mkdirSync(img);
  copyFileSync(path.join(IMAGES, "c1_A.png"), path.join(img, "A.png"));
  copyFileSync(path.join(IMAGES, "c1_A_jpeg.jpg"), path.join(img, "A_jpeg.jpg"));
  copyFileSync(path.join(IMAGES, "c4_G.png"), path.join(img, "B.png"));
  copyFileSync(path.join(IMAGES, "c4_G_jpeg.jpg"), path.join(img, "B_jpeg.jpg"));
  copyFileSync(path.join(IMAGES, "c4_G_badge.png"), path.join(img, "B_naklejka.png"));
  copyFileSync(path.join(IMAGES, "c2_E.png"), path.join(img, "inny.png"));
  // variants of A made the way scripts/gen-sample.ts makes them (sticker without text: no fonts needed)
  const png = await sharp(readFileSync(path.join(IMAGES, "c1_A.png"))).flatten({ background: "#ffffff" }).png().toBuffer();
  const sticker = await sharp({ create: { width: 110, height: 36, channels: 3, background: "#e63946" } }).png().toBuffer();
  writeFileSync(path.join(img, "A_naklejka.png"), await sharp(png).composite([{ input: sticker, top: 12, left: 278 }]).png().toBuffer());
  writeFileSync(path.join(img, "A_kadr.jpg"), await sharp(png).extract({ left: 14, top: 10, width: 372, height: 376 }).resize(400, 400, { fit: "fill" }).jpeg({ quality: 82 }).toBuffer());

  const fixtures = path.join(root, "fixtures");
  mkdirSync(fixtures);
  const http = Object.fromEntries(Object.entries(PAGES).map(([url, body]) => [url, { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body }]));
  writeFileSync(path.join(fixtures, "http.json"), JSON.stringify(http));

  const items = [
    item("k-1", "https://alfa-oferta.test/start", TEXT_K, "obrazy/A.png"),
    item("k-2", "https://alfa-oferta.test/oferta", TEXT_K, null),
    item("k1-1", "https://beta-oferta.test/start", TEXT_1, "obrazy/B.png"),
    item("k1-2", "https://beta-oferta.test/oferta", TEXT_1, null),
    item("k2-1", "https://gamma-oferta.test/start", TEXT_2, "obrazy/B_jpeg.jpg"),
    item("k2-2", "https://gamma-oferta.test/oferta", TEXT_2, null),
  ];
  const ds = await enrichItems(items, { sources: fixtureSources(fixtures), baseDir: root, ocr: false });
  const out = clusterCampaigns(buildEvidenceGraph(ds, { config: DEFAULT_LINK_CONFIG }), { config: DEFAULT_LINK_CONFIG });
  campaigns = out.campaigns;
  const data = path.join(root, "run");
  mkdirSync(data);
  writeFileSync(path.join(data, "enriched.json"), JSON.stringify(ds));
  writeFileSync(path.join(data, "campaigns.json"), JSON.stringify(out.campaigns));
  writeFileSync(path.join(data, "graph.json"), JSON.stringify(out.graph));
}, 60_000);

afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Materials of a dataset file (columns as `bun run ingest` maps them), analysed against the run. */
async function analyze(work: string, rows: string[]): Promise<Record<string, MaterialItemResult>> {
  const file = path.join(root, `${work}.csv`);
  writeFileSync(file, ["ad_id,tresc,link,zrzut", ...rows].join("\n"));
  const res = await analyzeMaterial(
    { datasetFile: file },
    { dataDir: path.join(root, "run"), workDir: path.join(root, work), fixtures: path.join(root, "fixtures"), config: DEFAULT_LINK_CONFIG, media: { ocr: false } },
  );
  return Object.fromEntries(res.items.map((i) => [i.id, i]));
}
const K = () => campaigns.assignments["k-1"];

describe("the run", () => {
  it("keeps K whole and K1, K2 (same picture, different infrastructure) apart", () => {
    expect(campaigns.assignments["k-2"]).toBe(K());
    expect(campaigns.assignments["k1-1"]).toBe(campaigns.assignments["k1-2"]);
    expect(campaigns.assignments["k2-1"]).toBe(campaigns.assignments["k2-2"]);
    expect(campaigns.assignments["k1-1"]).not.toBe(campaigns.assignments["k2-1"]);
  });
});

describe("analyzeMaterial: a variant without infrastructure", () => {
  let by: Record<string, MaterialItemResult>;
  beforeAll(async () => {
    by = await analyze("w-warianty", ["naklejka,,,obrazy/A_naklejka.png", "kadr,,,obrazy/A_kadr.jpg", `tekst,${TEXT_K},,obrazy/inny.png`, "kopia,,,obrazy/A_jpeg.jpg"]);
  }, 60_000);

  it("joins the original's campaign as a variant (sticker, crop), with a lower-confidence explanation", () => {
    for (const id of ["naklejka", "kadr"]) {
      const it = by[id];
      expect(it.verdict, id).toBe("known_campaign");
      expect(it.campaign, id).toBe(K());
      expect(it.campaignBasis, id).toBe("content_variant");
      expect(it.duplicateOf, id).toBeUndefined();
      expect(it.verdictText, id).toContain("jako wariant");
      expect(it.verdictText, id).toContain("k-1");
      const variant = it.links.find((l) => l.variant);
      expect(variant?.other, id).toBe("k-1");
      expect(variant?.evidence[0].edgeType ?? variant?.evidence[0].pivotType, id).toMatch(/similar_image|imagehash/);
      expect(variant?.evidence[0].weight, id).toBeGreaterThan(0);
    }
  });

  it("does not join by identical copy when the creative is different", () => {
    expect(by.tekst.verdict).not.toBe("known_campaign");
    expect(by.tekst.campaignBasis).toBeUndefined();
  });

  it("still calls a re-compressed copy of the original a duplicate in the original's campaign", () => {
    expect(by.kopia.verdict).toBe("duplicate");
    expect(by.kopia.duplicateOf?.id).toBe("k-1");
    expect(by.kopia.campaign).toBe(K());
  });
});

describe("analyzeMaterial: a variant that does not join", () => {
  it("does not join when the creative is in two campaigns, and leaves them apart", async () => {
    const by = await analyze("w-dwie", ["wariant-b,,,obrazy/B_naklejka.png"]);
    const it = by["wariant-b"];
    expect(it.verdict).not.toBe("known_campaign");
    expect(it.campaignBasis).toBeUndefined();
    expect(it.similarCampaigns).toEqual(expect.arrayContaining([campaigns.assignments["k1-1"], campaigns.assignments["k2-1"]]));
    // I20: both campaigns it came close to are listed with the rule that kept it out (content alone, they have infrastructure)
    const near = Object.fromEntries((it.nearMisses ?? []).map((n) => [n.campaign, n]));
    for (const k of [campaigns.assignments["k1-1"], campaigns.assignments["k2-1"]]) {
      expect(near[k]?.rule, k).toBe("content-only-with-infra");
      expect(near[k]?.reason, k).toMatch(/treść/);
    }
  }, 60_000);

  it("keeps today's rules for a variant with its own, different infrastructure", async () => {
    const by = await analyze("w-wlasna", ["wlasna,,https://delta-oferta.test/start,obrazy/A_naklejka.png"]);
    expect(by.wlasna.verdict).not.toBe("known_campaign");
    expect(by.wlasna.campaign).not.toBe(K());
    expect(by.wlasna.campaignBasis).toBeUndefined();
  }, 60_000);
});
