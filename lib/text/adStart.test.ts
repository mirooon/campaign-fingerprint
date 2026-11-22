import { describe, expect, it } from "vitest";
import { adStart, weekdayCounts } from "./adStart";

describe("adStart (weekday and hour an ad started)", () => {
  it("reads the weekday (Monday = 0) of a date and the hour of a time, in UTC", () => {
    expect(adStart("2026-11-02")).toEqual({ weekday: 0, hour: null });
    expect(adStart("2026-11-07T22:30:00Z")).toEqual({ weekday: 5, hour: 22 });
    expect(adStart("2026-11-08 06:05:00+00:00")).toEqual({ weekday: 6, hour: 6 });
  });

  it("returns null for an empty or unreadable value", () => {
    expect(adStart(null)).toBeNull();
    expect(adStart("")).toBeNull();
    expect(adStart("wczoraj")).toBeNull();
  });
});

describe("weekdayCounts", () => {
  it("counts starts per weekday, Monday first", () => {
    expect(weekdayCounts([{ weekday: 0, hour: null }, { weekday: 0, hour: 9 }, { weekday: 6, hour: null }])).toEqual([2, 0, 0, 0, 0, 0, 1]);
  });
});
