import { describe, expect, it } from "vitest";
import { DECISION_LABEL, decisionsFilePath, exportBlockReason, setDecision, type DecisionsFile } from "./decisions";

const empty: DecisionsFile = { version: 1, decisions: {} };

describe("setDecision", () => {
  it("saves the decision with its time and does not change the input", () => {
    const out = setDecision(empty, "K01", "reported", new Date("2026-11-22T10:00:00Z"));
    expect(out.decisions.K01).toEqual({ status: "reported", decidedAt: "2026-11-22T10:00:00.000Z" });
    expect(empty.decisions).toEqual({});
  });
  it("a new decision replaces the old one, and null removes it", () => {
    const a = setDecision(empty, "K01", "to_verify", new Date("2026-11-22T10:00:00Z"));
    const b = setDecision(a, "K01", "rejected", new Date("2026-11-22T11:00:00Z"));
    expect(b.decisions.K01.status).toBe("rejected");
    expect(setDecision(b, "K01", null).decisions).toEqual({});
  });
});

describe("exportBlockReason", () => {
  it("a rejected campaign or one to verify has no pack export, with a message", () => {
    const f = setDecision(setDecision(empty, "K01", "rejected"), "K02", "to_verify");
    expect(exportBlockReason(f, "K01")).toBe("Campaign K01 is marked “rejected”: no evidence pack will be made. Change the decision if this is a mistake.");
    expect(exportBlockReason(f, "K02")).toContain("to verify");
  });
  it("to report, reported and no decision do not block the export", () => {
    const f = setDecision(setDecision(empty, "K01", "to_report"), "K02", "reported");
    expect(exportBlockReason(f, "K01")).toBeNull();
    expect(exportBlockReason(f, "K02")).toBeNull();
    expect(exportBlockReason(f, "K09")).toBeNull();
  });
});

describe("DECISION_LABEL", () => {
  it("the four decisions have display names", () => {
    expect(Object.values(DECISION_LABEL)).toEqual(["to report", "reported", "rejected", "to verify"]);
  });
});

describe("decisionsFilePath", () => {
  it("your own base keeps the decisions in its folder, the sample in the work folder outside the repository", () => {
    expect(decisionsFilePath({ dataDir: "/dane/baza", sampleBase: false, workRoot: "/tmp/praca" })).toBe("/dane/baza/decyzje.json");
    expect(decisionsFilePath({ dataDir: "/repo/data", sampleBase: true, workRoot: "/tmp/praca" })).toBe("/tmp/praca/decyzje-probka.json");
  });
});
