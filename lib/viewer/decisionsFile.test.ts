import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDecisions, saveDecision } from "./decisionsFile";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "decyzje-"));
  dirs.push(d);
  return d;
};

describe("decisionsFile", () => {
  it("no file means empty decisions, a write creates the file without temporary files", () => {
    const file = path.join(tmp(), "decyzje.json");
    expect(loadDecisions(file)).toEqual({ ok: true, file: { version: 1, decisions: {} } });
    const saved = saveDecision(file, "K03", "rejected", new Date("2026-11-22T10:00:00Z"));
    expect(saved.ok && saved.file.decisions.K03.status).toBe("rejected");
    expect(JSON.parse(readFileSync(file, "utf8")).decisions.K03.decidedAt).toBe("2026-11-22T10:00:00.000Z");
    expect(readdirSync(path.dirname(file))).toEqual(["decyzje.json"]);
  });
  it("a broken file is not silently overwritten: a message with a reason", () => {
    const file = path.join(tmp(), "decyzje.json");
    writeFileSync(file, "{zepsute");
    const out = loadDecisions(file);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.error).toContain("decyzje.json");
    expect(saveDecision(file, "K01", "reported").ok).toBe(false);
    expect(readFileSync(file, "utf8")).toBe("{zepsute");
  });
});
