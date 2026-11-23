import { describe, expect, it } from "vitest";
import { count, fmtDate, fmtNum, fmtRange, MATERIAL } from "./format";

describe("format", () => {
  it("decimal point", () => {
    expect(fmtNum(0.8234)).toBe("0.82");
    expect(fmtNum(null)).toBe("—");
  });
  it("en-GB dates", () => {
    expect(fmtDate("2026-10-09T00:00:00.000Z")).toBe("9 Oct 2026");
    expect(fmtDate("2026-10-09T06:24:00.000Z")).toBe("9 Oct 2026, 08:24");
    expect(fmtRange("2026-09-05T00:00:00.000Z", "2026-10-20T00:00:00.000Z")).toBe("5 Sep 2026 – 20 Oct 2026");
  });
  it("plural forms", () => {
    expect(count(1, MATERIAL)).toBe("1 sample");
    expect(count(3, MATERIAL)).toBe("3 samples");
    expect(count(0, MATERIAL)).toBe("0 samples");
    expect(count(22, MATERIAL)).toBe("22 samples");
    expect(count(5, ["day", "days", "days"])).toBe("5 days");
  });
});
