import { describe, expect, it } from "vitest";
import { jobFailedLookups } from "./jobs";

describe("jobFailedLookups", () => {
  it("joins the failed lookups of the import and of the analysis, without repeats", () => {
    expect(jobFailedLookups({ failedLookups: ["rdap:b.test", "dns:a.test"] }, { failedLookups: ["rdap:b.test", "ct:c.test"] })).toEqual(["ct:c.test", "dns:a.test", "rdap:b.test"]);
    expect(jobFailedLookups({ failedLookups: ["rdap:b.test"] }, null)).toEqual(["rdap:b.test"]);
    expect(jobFailedLookups({}, null)).toEqual([]);
  });
});
