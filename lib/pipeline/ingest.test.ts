import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { autoMapping, loadRecords, loadRecordsLenient, normalizeDate, normalizeRecords, parseCsv } from "./ingest";

const dir = mkdtempSync(path.join(tmpdir(), "starter-ingest-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("autoMapping", () => {
  it("recognises Polish and English column names", () => {
    expect(autoMapping(["Ad ID", "Treść", "Link", "Data", "Kampania", "page_name", "image_url"])).toEqual({
      id: "Ad ID",
      text: "Treść",
      landingUrl: "Link",
      firstSeen: "Data",
      label: "Kampania",
      advertiser: "page_name",
      imageUrl: "image_url",
    });
  });
});

describe("parseCsv", () => {
  it("detects semicolon-separated exports (Polish Excel) and handles quotes/BOM", () => {
    const rows = parseCsv('﻿id;tresc;link\n1;"Zarabiaj; szybko";https://a.example\n2;"Cytat ""x""";\n');
    expect(rows).toEqual([
      { id: "1", tresc: "Zarabiaj; szybko", link: "https://a.example" },
      { id: "2", tresc: 'Cytat "x"', link: "" },
    ]);
  });
});

describe("normalizeDate", () => {
  it.each([
    ["2026-09-05", "2026-09-05T00:00:00.000Z"],
    ["19.09.2026", "2026-09-19T00:00:00.000Z"],
    ["19.09.2026 14:30", "2026-09-19T14:30:00.000Z"],
    ["2026-09-05 10:00:00Z", "2026-09-05T10:00:00.000Z"],
    ["1790000000", new Date(1790000000 * 1000).toISOString()],
    ["nie wiem", null],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeDate(input)).toBe(expected);
  });
});

describe("normalizeRecords", () => {
  it("applies an explicit mapping, keeps extra columns and moves local image paths", () => {
    const { items, warnings, mapping } = normalizeRecords(
      [
        { nr: "a1", tresc: "Tekst", obraz: "images/x.png", link: "https://x.example", kraj: "PL", label: "C1" },
        { nr: "a1", tresc: "Drugi", obraz: "https://cdn.example/y.jpg", link: "", kraj: "PL", label: "" },
      ],
      { id: "nr", text: "tresc", imageUrl: "obraz", landingUrl: "link" },
    );
    expect(mapping.label).toBe("label");
    expect(items[0]).toMatchObject({ id: "a1", text: "Tekst", imagePath: "images/x.png", imageUrl: null, landingUrl: "https://x.example", label: "C1", extra: { kraj: "PL" } });
    expect(items[1]).toMatchObject({ id: "a1__2", imageUrl: "https://cdn.example/y.jpg", landingUrl: null, label: null });
    expect(warnings.some((w) => w.includes("duplicate id"))).toBe(true);
  });

  it("generates stable ids when missing and warns about empty rows", () => {
    const a = normalizeRecords([{ text: "x" }, {}]);
    const b = normalizeRecords([{ text: "x" }, {}]);
    expect(a.items[0].id).toMatch(/^h[0-9a-f]{12}$/);
    expect(a.items[0].id).toBe(b.items[0].id);
    expect(a.warnings.some((w) => w.includes("no text, URL, image or video"))).toBe(true);
  });

  it("joins several text columns when mapped as an array", () => {
    const { items } = normalizeRecords([{ t1: "Tytuł", t2: "Opis" }], { text: ["t1", "t2"] });
    expect(items[0].text).toBe("Tytuł\nOpis");
  });
});

describe("loadRecords", () => {
  it("reads JSON arrays, wrapped JSON and JSONL", () => {
    const f1 = path.join(dir, "a.json");
    writeFileSync(f1, JSON.stringify([{ id: 1 }]));
    const f2 = path.join(dir, "b.json");
    writeFileSync(f2, JSON.stringify({ data: [{ id: 2 }] }));
    const f3 = path.join(dir, "c.jsonl");
    writeFileSync(f3, '{"id":3}\n\n{"id":4}\n');
    expect(loadRecords(f1)).toEqual([{ id: 1 }]);
    expect(loadRecords(f2)).toEqual([{ id: 2 }]);
    expect(loadRecords(f3)).toEqual([{ id: 3 }, { id: 4 }]);
  });
});

describe("loadRecordsLenient", () => {
  it("leaves out a damaged JSONL line with its line number, the id still readable in it and the reason", () => {
    const f = path.join(dir, "uszkodzony.jsonl");
    writeFileSync(f, '{"id":"w1","text":"a"}\n\n{"ad_id": "w2", "text": "uci\n[1,2]\n{"id":"w4"}\n');
    const { records, bad } = loadRecordsLenient(f);
    expect(records).toEqual([{ id: "w1", text: "a" }, { id: "w4" }]);
    expect(bad).toEqual([
      { row: 3, id: "w2", reason: expect.stringMatching(/^niepoprawny JSON \(.+\)$/) },
      { row: 4, id: null, reason: "wiersz nie jest obiektem JSON" },
    ]);
  });

  it("reads the id of a broken line from the mapped id column first", () => {
    const f = path.join(dir, "mapowany.jsonl");
    writeFileSync(f, '{"nr_zgloszenia": 77, "id": "x", "text": \n');
    expect(loadRecordsLenient(f, { idColumn: "nr_zgloszenia" }).bad[0].id).toBe("77");
  });

  it("leaves out JSON array elements that are not objects, and still throws for a file that is not JSON", () => {
    const f = path.join(dir, "tablica.json");
    writeFileSync(f, JSON.stringify({ items: [{ id: 1 }, null, "x", { id: 2 }] }));
    expect(loadRecordsLenient(f)).toEqual({
      records: [{ id: 1 }, { id: 2 }],
      bad: [
        { row: 2, id: null, reason: "element tablicy nie jest obiektem JSON" },
        { row: 3, id: null, reason: "element tablicy nie jest obiektem JSON" },
      ],
    });
    const broken = path.join(dir, "zly.json");
    writeFileSync(broken, '[{"id": 1},');
    expect(() => loadRecordsLenient(broken)).toThrow();
  });

  it("reads a CSV like loadRecords", () => {
    const f = path.join(dir, "zbior.csv");
    writeFileSync(f, "id,text\n1,a\n2,b\n");
    expect(loadRecordsLenient(f)).toEqual({ records: loadRecords(f), bad: [] });
  });
});
