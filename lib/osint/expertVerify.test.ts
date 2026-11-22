import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { recordedExpertLookup, verifyExperts } from "./expertVerify";

describe("verifyExperts", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "expert-"));
  const file = path.join(dir, "rec.json");
  writeFileSync(file, JSON.stringify({ "Jan Testowy": false, "Ewa Istniejąca": true }));

  /** Disabled by default: the lookup is never called. */
  it("does nothing when disabled", async () => {
    let calls = 0;
    const lookup = async () => (calls++, false);
    expect(await verifyExperts(["Jan Testowy"], { enabled: false, lookup })).toEqual([]);
    expect(calls).toBe(0);
  });
  /** Recorded answers label a name outside the register; unknown names get no label. */
  it("labels from recorded answers", async () => {
    const res = await verifyExperts(["Jan Testowy", "Ewa Istniejąca", "Nikt Nieznany"], { enabled: true, lookup: recordedExpertLookup(file) });
    expect(res).toEqual([{ name: "Jan Testowy", registered: false }, { name: "Ewa Istniejąca", registered: true }]);
  });
  /** No lookup, a missing file or a throwing lookup: no label, no error. */
  it("is silent without answers", async () => {
    expect(await verifyExperts(["Jan Testowy"], { enabled: true, lookup: null })).toEqual([]);
    expect(await verifyExperts(["Jan Testowy"], { enabled: true, lookup: recordedExpertLookup("/nonexistent.json") })).toEqual([]);
    expect(await verifyExperts(["Jan Testowy"], { enabled: true, lookup: async () => { throw new Error("offline"); } })).toEqual([]);
  });
});
