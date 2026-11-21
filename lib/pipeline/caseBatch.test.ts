import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { batchCaseDirs } from "./caseBatch";

const root = mkdtempSync(path.join(os.tmpdir(), "case-batch-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("batchCaseDirs", () => {
  const cases = path.join(root, "sprawy");
  mkdirSync(path.join(cases, "sprawa-10"), { recursive: true });
  mkdirSync(path.join(cases, "sprawa-2"), { recursive: true });
  writeFileSync(path.join(cases, "zrzut.png"), "x");
  writeFileSync(path.join(cases, "strona.html"), "<html></html>");
  writeFileSync(path.join(cases, ".DS_Store"), "");

  it("takes sub-folders as cases, in natural order", () => {
    expect(batchCaseDirs(cases, { scratchDir: root }).map((d) => path.basename(d))).toEqual(["sprawa-2", "sprawa-10"]);
  });

  it("makes every loose file a case of its own with --each-file", () => {
    const dirs = batchCaseDirs(cases, { eachFile: true, scratchDir: root });
    expect(dirs.map((d) => path.basename(d))).toEqual(["sprawa-2", "sprawa-10", "strona.html", "zrzut.png"]);
    expect(existsSync(path.join(dirs[3], "zrzut.png"))).toBe(true);
  });
});
