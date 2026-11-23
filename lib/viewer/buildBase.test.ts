import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { baseSummary, buildBaseRefusal, replaceQuestion, restoreBase, setAsideBase } from "./buildBase";

describe("build a new base (B-284)", () => {
  it("refuses the sample base", () => {
    expect(buildBaseRefusal(true)).toContain("read-only");
    expect(buildBaseRefusal(false)).toBeNull();
  });

  it("summarises the current base for the confirmation", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bb-"));
    expect(baseSummary(dir).exists).toBe(false);
    writeFileSync(path.join(dir, "campaigns.json"), JSON.stringify({ campaigns: [{ size: 2 }, { size: 1 }], assignments: { a: "K01", b: "K01", c: "K02" } }));
    const s = baseSummary(dir);
    expect(s).toEqual({ exists: true, campaigns: 1, materials: 3 });
    expect(replaceQuestion(s)).toContain("replace the current one (1 campaign, 3 samples)");
  });

  it("sets the previous base aside and restores it after a failed build", () => {
    const data = mkdtempSync(path.join(tmpdir(), "bb-data-"));
    writeFileSync(path.join(data, "campaigns.json"), "old");
    mkdirSync(path.join(data, ".cache"));
    const backup = setAsideBase(data, "20260101T000000");
    expect(readdirSync(data).sort()).toEqual([".cache", ".poprzednia-baza-20260101T000000"]);
    expect(readFileSync(path.join(backup!, "campaigns.json"), "utf8")).toBe("old");
    writeFileSync(path.join(data, "input.json"), "half-built");
    restoreBase(data, backup);
    expect(readdirSync(data).sort()).toEqual([".cache", "campaigns.json"]);
    expect(readFileSync(path.join(data, "campaigns.json"), "utf8")).toBe("old");
  });
});
