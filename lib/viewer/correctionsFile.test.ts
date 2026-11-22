import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { emptyCorrections } from "../graph/corrections";
import { applyCorrectionAction, correctionsFilePath, loadCorrectionsFile, saveCorrectionAction } from "./correctionsFile";

const now = new Date("2026-01-02T03:04:05Z");

describe("corrections file (B-281)", () => {
  it("keeps a pair in one list only and does not duplicate it", () => {
    let f = applyCorrectionAction(emptyCorrections(), { action: "must", a: "x", b: "y" }, now);
    f = applyCorrectionAction(f, { action: "must", a: "y", b: "x" }, now);
    expect(f.mustLink).toHaveLength(1);
    f = applyCorrectionAction(f, { action: "cannot", a: "x", b: "y" }, now);
    expect(f.mustLink).toHaveLength(0);
    expect(f.cannotLink).toEqual([{ a: "x", b: "y", at: now.toISOString() }]);
    f = applyCorrectionAction(f, { action: "remove", a: "y", b: "x" }, now);
    expect(f.cannotLink).toHaveLength(0);
  });

  it("disables and re-enables a trace", () => {
    let f = applyCorrectionAction(emptyCorrections(), { action: "disable-pivot", pivot: "domain:x.example" }, now);
    f = applyCorrectionAction(f, { action: "disable-pivot", pivot: "domain:x.example" }, now);
    expect(f.disabledPivots).toHaveLength(1);
    expect(applyCorrectionAction(f, { action: "remove", pivot: "domain:x.example" }, now).disabledPivots).toHaveLength(0);
  });

  it("writes the file and refuses to overwrite a broken one", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "corrf-"));
    const file = path.join(dir, "corrections.json");
    expect(saveCorrectionAction(file, { action: "cannot", a: "p", b: "q" }, now).ok).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).cannotLink).toHaveLength(1);
    writeFileSync(file, "{broken");
    expect(loadCorrectionsFile(file).ok).toBe(false);
    expect(saveCorrectionAction(file, { action: "must", a: "p", b: "q" }, now).ok).toBe(false);
    expect(readFileSync(file, "utf8")).toBe("{broken");
  });

  it("keeps the sample's corrections out of the repository", () => {
    expect(correctionsFilePath({ dataDir: "/base", sampleBase: false, workRoot: "/work" })).toBe(path.join("/base", "corrections.json"));
    expect(correctionsFilePath({ dataDir: "/repo/data", sampleBase: true, workRoot: "/work" })).toBe(path.join("/work", "corrections-probka.json"));
  });
});
