import { describe, expect, it } from "vitest";
import { DECISION_LABEL, decisionsFilePath, exportBlockReason, setDecision, type DecisionsFile } from "./decisions";

const empty: DecisionsFile = { version: 1, decisions: {} };

describe("setDecision", () => {
  it("zapisuje decyzję z czasem i nie zmienia wejścia", () => {
    const out = setDecision(empty, "K01", "reported", new Date("2026-11-22T10:00:00Z"));
    expect(out.decisions.K01).toEqual({ status: "reported", decidedAt: "2026-11-22T10:00:00.000Z" });
    expect(empty.decisions).toEqual({});
  });
  it("nowa decyzja zastępuje starą, a null ją usuwa", () => {
    const a = setDecision(empty, "K01", "to_verify", new Date("2026-11-22T10:00:00Z"));
    const b = setDecision(a, "K01", "rejected", new Date("2026-11-22T11:00:00Z"));
    expect(b.decisions.K01.status).toBe("rejected");
    expect(setDecision(b, "K01", null).decisions).toEqual({});
  });
});

describe("exportBlockReason", () => {
  it("kampania odrzucona albo do weryfikacji nie ma eksportu paczki, z komunikatem", () => {
    const f = setDecision(setDecision(empty, "K01", "rejected"), "K02", "to_verify");
    expect(exportBlockReason(f, "K01")).toBe("Kampania K01 jest oznaczona jako „odrzucone”: paczka dowodów nie powstanie. Zmień decyzję, jeśli to pomyłka.");
    expect(exportBlockReason(f, "K02")).toContain("do weryfikacji");
  });
  it("do zgłoszenia, zgłoszone i brak decyzji nie blokują eksportu", () => {
    const f = setDecision(setDecision(empty, "K01", "to_report"), "K02", "reported");
    expect(exportBlockReason(f, "K01")).toBeNull();
    expect(exportBlockReason(f, "K02")).toBeNull();
    expect(exportBlockReason(f, "K09")).toBeNull();
  });
});

describe("DECISION_LABEL", () => {
  it("cztery decyzje mają polskie nazwy", () => {
    expect(Object.values(DECISION_LABEL)).toEqual(["do zgłoszenia", "zgłoszone", "odrzucone", "do weryfikacji"]);
  });
});

describe("decisionsFilePath", () => {
  it("własna baza trzyma decyzje w swoim katalogu, próbka w katalogu roboczym poza repozytorium", () => {
    expect(decisionsFilePath({ dataDir: "/dane/baza", sampleBase: false, workRoot: "/tmp/praca" })).toBe("/dane/baza/decyzje.json");
    expect(decisionsFilePath({ dataDir: "/repo/data", sampleBase: true, workRoot: "/tmp/praca" })).toBe("/tmp/praca/decyzje-probka.json");
  });
});
