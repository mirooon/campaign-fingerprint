import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importCases } from "../pipeline/caseImport";
import { adRecordToCaseDir } from "./caseDir";
import { parseAdRecord } from "./record";
import type { AdRecord } from "./types";

let root: string;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

const REC: AdRecord = {
  platform: "google",
  adId: "CR100200300",
  libraryUrl: "https://atc.example/advertiser/AR0000000000000000001/creative/CR100200300",
  fetchedAt: "2026-11-21T10:00:00.000Z",
  advertiser: { name: "Fikcyjna Firma", id: "AR0000000000000000001", legalName: "Fikcyjna Firma Sp. z o.o.", location: "PL", verified: true },
  payers: ["Fundator Testowy"],
  firstSeen: "2026-10-20T00:00:00.000Z",
  creatives: [{ kind: "text", text: "Zarabiaj z platforma AI" }, { kind: "image", url: "https://cdn.example/a.jpg", localPath: "" }],
  landingUrl: "https://oferta.example/lp",
  raw: { huge: "x".repeat(100) },
};

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "adlib-case-"));
  writeFileSync(path.join(root, "kreacja.png"), PNG);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("adRecordToCaseDir", () => {
  it("writes a folder named after the platform and ID with the record (without the raw response) and local creatives", async () => {
    const rec = { ...REC, creatives: [REC.creatives[0], { kind: "image" as const, localPath: path.join(root, "kreacja.png") }] };
    const dir = await adRecordToCaseDir(rec, path.join(root, "sprawy"));
    expect(path.basename(dir)).toBe("google_CR100200300");
    expect(existsSync(path.join(dir, "reklama_1.png"))).toBe(true);
    const saved = JSON.parse(readFileSync(path.join(dir, "adlib.json"), "utf8"));
    expect(saved.raw).toBeUndefined();
    expect(parseAdRecord(saved).record).toMatchObject({ platform: "google", adId: "CR100200300", advertiser: { id: "AR0000000000000000001", verified: true } });
  });

  it("is read by the case importer: the record's columns reach input.json and the landing address is the target", async () => {
    const cases = path.join(root, "sprawy2");
    await adRecordToCaseDir(REC, cases);
    const out = path.join(root, "out");
    const res = await importCases({ casesDir: cases, outDir: out });
    expect(res.cases).toHaveLength(1);
    const input = JSON.parse(readFileSync(path.join(out, "input.json"), "utf8"));
    expect(input).toHaveLength(1);
    expect(input[0]).toMatchObject({
      id: "google_CR100200300",
      landing_url: "https://oferta.example/lp",
      first_seen: "2026-10-20T00:00:00.000Z",
      text: "Zarabiaj z platforma AI",
      advertiser: "Fikcyjna Firma",
      ad_platform: "google",
      advertiser_id: "AR0000000000000000001",
      advertiser_legal_name: "Fikcyjna Firma Sp. z o.o.",
    });
    const mapping = JSON.parse(readFileSync(path.join(out, "mapping.json"), "utf8"));
    expect(mapping).toMatchObject({ text: "text", advertiser: "advertiser" });
  });
});

describe("parseAdRecord", () => {
  it("rejects a record without a known platform, an ID or a library address", () => {
    expect(parseAdRecord({ platform: "snap", adId: "1", libraryUrl: "u" }).error).toContain("platform");
    expect(parseAdRecord({ platform: "meta", libraryUrl: "u" }).error).toContain("adId");
    expect(parseAdRecord({ platform: "meta", adId: "1" }).error).toContain("libraryUrl");
  });
});

describe("yt-dlp description of a library ad (.info.json)", () => {
  it("gives the advertiser page ID (uploader_id) as the library account of the record, whatever the page is called", async () => {
    const cases = path.join(root, "sprawy-info");
    for (const [name, uploader] of [["a", "Nazwa Pierwsza"], ["b", "Nazwa Druga"]] as const) {
      mkdirSync(path.join(cases, name), { recursive: true });
      writeFileSync(
        path.join(cases, name, "reklama.info.json"),
        JSON.stringify({ webpage_url: `https://www.facebook.com/ads/library/?id=100000000000010${name === "a" ? 1 : 2}`, uploader, uploader_id: "900000000001", epoch: 1793606400 }),
      );
    }
    const out = path.join(root, "out-info");
    await importCases({ casesDir: cases, outDir: out });
    const input = JSON.parse(readFileSync(path.join(out, "input.json"), "utf8"));
    expect(input.map((r: Record<string, string>) => [r.advertiser, r.advertiser_id, r.ad_platform, r.ad_library_id])).toEqual([
      ["Nazwa Pierwsza", "900000000001", "meta", "1000000000000101"],
      ["Nazwa Druga", "900000000001", "meta", "1000000000000102"],
    ]);
  });
});
