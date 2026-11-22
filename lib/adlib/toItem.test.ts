import { describe, expect, it } from "vitest";
import { adRecordToItem } from "./toItem";
import type { AdRecord } from "./types";

const base = { fetchedAt: "2026-11-21T10:00:00.000Z" };

const META: AdRecord = {
  ...base,
  platform: "meta",
  adId: "1000000000000101",
  libraryUrl: "https://library.example/meta?id=1000000000000101",
  advertiser: { name: "Strona Testowa", id: "555000111" },
  payers: ["Testowa Spolka"],
  firstSeen: "2026-11-01T00:00:00.000Z",
  lastSeen: "2026-11-10T00:00:00.000Z",
  regions: ["PL"],
  creatives: [{ kind: "text", text: "Zarabiaj z platforma AI" }, { kind: "image", url: "https://cdn.example/a.jpg" }],
  landingUrl: "https://oferta.example/lp?utm_source=fb",
};

const GOOGLE: AdRecord = {
  ...base,
  platform: "google",
  adId: "CR100200300",
  libraryUrl: "https://atc.example/advertiser/AR0000000000000000001/creative/CR100200300",
  advertiser: { name: "Fikcyjna Firma", id: "AR0000000000000000001", legalName: "Fikcyjna Firma Sp. z o.o.", location: "PL", verified: true },
  payers: ["Fundator Testowy"],
  firstSeen: "2026-10-20T00:00:00.000Z",
  creatives: [{ kind: "video", url: "https://cdn.example/v.mp4" }],
};

describe("adRecordToItem", () => {
  it("carries text, creative, landing address, advertiser and dates of a Meta record", () => {
    const it = adRecordToItem(META);
    expect(it).toMatchObject({
      id: "meta_1000000000000101",
      platform: "meta",
      advertiser: "Strona Testowa",
      text: "Zarabiaj z platforma AI",
      imageUrl: "https://cdn.example/a.jpg",
      landingUrl: "https://oferta.example/lp?utm_source=fb",
      firstSeen: "2026-11-01T00:00:00.000Z",
      lastSeen: "2026-11-10T00:00:00.000Z",
    });
    expect(it.extra).toMatchObject({ ad_platform: "meta", ad_id: "1000000000000101", ad_library_id: "1000000000000101", ad_payers: "Testowa Spolka", ad_regions: "PL" });
  });

  it("carries the advertiser id and its attributes of a Google record, without a landing address", () => {
    const it = adRecordToItem(GOOGLE);
    expect(it.landingUrl).toBeNull();
    expect(it.extra).toMatchObject({
      ad_platform: "google",
      advertiser_id: "AR0000000000000000001",
      advertiser_legal_name: "Fikcyjna Firma Sp. z o.o.",
      advertiser_location: "PL",
      advertiser_verified: "true",
      ad_payers: "Fundator Testowy",
    });
    // the Meta-only column marks the library ID that the graph already reads for Meta
    expect(it.extra.ad_library_id).toBeUndefined();
  });

  it("leaves the verification status out when the library does not state it", () => {
    const it = adRecordToItem({ ...GOOGLE, advertiser: { name: "X", id: "AR1", verified: null } });
    expect(it.extra.advertiser_verified).toBeUndefined();
  });

  it("keeps the library's delivery dates apart from first_seen so that the graph can show them as the ad's own", () => {
    const it = adRecordToItem(META);
    expect(it.extra).toMatchObject({ ad_first_shown: "2026-11-01T00:00:00.000Z", ad_last_shown: "2026-11-10T00:00:00.000Z" });
  });
});
