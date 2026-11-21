import { describe, expect, it } from "vitest";
import { count, fmtDate, fmtNum, fmtRange, MATERIAL } from "./format";

describe("format", () => {
  it("decimal comma", () => {
    expect(fmtNum(0.8234)).toBe("0,82");
    expect(fmtNum(null)).toBe("—");
  });
  it("Polish dates", () => {
    expect(fmtDate("2026-10-09T00:00:00.000Z")).toBe("9 paź 2026");
    expect(fmtDate("2026-10-09T06:24:00.000Z")).toBe("9 paź 2026, 08:24");
    expect(fmtRange("2026-09-05T00:00:00.000Z", "2026-10-20T00:00:00.000Z")).toBe("5 wrz 2026 – 20 paź 2026");
  });
  it("plural forms", () => {
    expect(count(1, MATERIAL)).toBe("1 materiał");
    expect(count(3, MATERIAL)).toBe("3 materiały");
    expect(count(12, MATERIAL)).toBe("12 materiałów");
    expect(count(22, MATERIAL)).toBe("22 materiały");
  });
});
