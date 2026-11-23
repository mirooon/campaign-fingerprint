import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRecognized } from "./recognizedFile";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function dataDir(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "rozpoznawani-"));
  dirs.push(d);
  return d;
}

describe("loadRecognized", () => {
  it("reads the face and voice indexes and the list of people from the data folder", () => {
    const d = dataDir();
    mkdirSync(path.join(d, "faces"));
    mkdirSync(path.join(d, "voices"));
    writeFileSync(path.join(d, "faces", "index.json"), JSON.stringify({ model: "m", persons: { "ewa-przykladowa": [[0], [0]] } }));
    writeFileSync(path.join(d, "voices", "index.json"), JSON.stringify({ model: "m", persons: { "ewa-przykladowa": [[0]] } }));
    writeFileSync(path.join(d, "osoby-publiczne.json"), JSON.stringify([{ id: "ewa-przykladowa", name: "Ewa Przykładowa", source: "ostrzeżenie testowe" }]));
    const out = loadRecognized(d);
    expect(out.people).toEqual([{ id: "ewa-przykladowa", name: "Ewa Przykładowa", role: null, category: null, source: "ostrzeżenie testowe", faces: 2, voices: 1 }]);
    expect(out.notes).toEqual([]);
  });
  it("a missing gallery gives an empty list with a reason, not an exception", () => {
    const out = loadRecognized(dataDir());
    expect(out.people).toEqual([]);
    expect(out.notes.join(" ")).toContain("faces/index.json");
    expect(out.notes.join(" ")).toContain("voices/index.json");
  });
  it("a broken file is reported with a reason, and the other index is still read", () => {
    const d = dataDir();
    mkdirSync(path.join(d, "faces"));
    mkdirSync(path.join(d, "voices"));
    writeFileSync(path.join(d, "faces", "index.json"), "{zepsuty");
    writeFileSync(path.join(d, "voices", "index.json"), JSON.stringify({ persons: { "adam-testowy": [[0]] } }));
    const out = loadRecognized(d);
    expect(out.people.map((p) => p.id)).toEqual(["adam-testowy"]);
    expect(out.notes[0]).toContain("faces/index.json");
  });
});
