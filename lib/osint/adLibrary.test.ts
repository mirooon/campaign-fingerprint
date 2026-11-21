import { describe, expect, it } from "vitest";
import type { ToolRunner } from "../media/tools";
import { adLibraryUrl, lookupAdLibrary, parseAdLibraryOutput } from "./adLibrary";

const SAMPLE = JSON.stringify({
  ads: {
    "1000000000000101": {
      payers: ["Testowa Spolka"], beneficiaries: ["Testowa Spolka"], takenDown: true, violations: ["Prohibited Commercial Practices"],
      euReach: 123456, ageMin: 35, ageMax: 64, gender: "All", locations: ["Poland"], pageId: null, pageName: null, pageDeleted: null, pageVerification: null,
    },
    "1000000000000303": { error: "rate limited" },
  },
});

describe("Meta Ad Library adapter", () => {
  it("parses records and errors, with a placeholder for missing IDs", () => {
    const out = parseAdLibraryOutput(SAMPLE, ["1000000000000101", "1000000000000303", "1111111111111"]);
    expect(out["1000000000000101"]).toMatchObject({ payers: ["Testowa Spolka"], takenDown: true, euReach: 123456, ageMin: 35, locations: ["Poland"], error: null });
    expect(out["1000000000000303"].error).toBe("rate limited");
    expect(out["1111111111111"].error).toBe("brak odpowiedzi");
  });

  it("passes only valid IDs to the helper and maps a failed run to errors", async () => {
    const calls: string[][] = [];
    const run: ToolRunner = async (_cmd, args) => {
      calls.push(args);
      return { code: 1, stdout: "", stderr: "Traceback\nMetaAdsError: blocked", timedOut: false };
    };
    const out = await lookupAdLibrary(["1000000000000101", "abc", "12"], { python: "/x/python", run });
    expect(calls[0].slice(-1)).toEqual(["1000000000000101"]);
    expect(out["1000000000000101"].error).toContain("blocked");
    expect(await lookupAdLibrary(["abc"], { python: "/x/python", run })).toEqual({});
  });

  it("builds a library link that also shows removed ads", () => {
    expect(adLibraryUrl("123456789012")).toContain("active_status=all");
  });
});
