import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashCaseFiles } from "./caseFiles";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "case-files-"));
  writeFileSync(path.join(dir, "a.har"), "{}");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("hashCaseFiles", () => {
  it("gives the SHA-256, size and modification time of a file, with its role", () => {
    const [rec] = hashCaseFiles([{ role: "har", file: path.join(dir, "a.har") }]);
    expect(rec).toMatchObject({ role: "har", path: path.join(dir, "a.har"), sha256: createHash("sha256").update("{}").digest("hex"), size: 2, error: null });
    expect(rec.modifiedUtc).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("reports an unreadable file with the reason instead of dropping it", () => {
    const [rec] = hashCaseFiles([{ role: "video", file: path.join(dir, "brak.mp4") }]);
    expect(rec).toMatchObject({ role: "video", sha256: null, size: 0 });
    expect(rec.error).toMatch(/ENOENT|brak/i);
  });
});
