import { describe, expect, it } from "vitest";
import { liveChoiceValue, liveLookupsOption, OFFLINE_NOTE, parseLiveChoice, serverOffline } from "./liveLookups";

describe("serverOffline", () => {
  it("only ANALYZE_OFFLINE=1 turns off the server lookups", () => {
    expect(serverOffline({ ANALYZE_OFFLINE: "1" })).toBe(true);
    expect(serverOffline({ ANALYZE_OFFLINE: "0" })).toBe(false);
    expect(serverOffline({})).toBe(false);
  });
});

describe("liveLookupsOption", () => {
  it("offline server: the box is unchecked and disabled with a note, also after an earlier choice", () => {
    expect(liveLookupsOption(true, null)).toEqual({ checked: false, disabled: true, note: OFFLINE_NOTE });
    expect(liveLookupsOption(true, true).checked).toBe(false);
    expect(OFFLINE_NOTE).toMatch(/offline/);
  });
  it("online server: checked by default, then the choice of this session", () => {
    expect(liveLookupsOption(false, null)).toEqual({ checked: true, disabled: false, note: null });
    expect(liveLookupsOption(false, false).checked).toBe(false);
    expect(liveLookupsOption(false, true).checked).toBe(true);
  });
});

describe("choice in session storage", () => {
  it("writing and reading agree; a foreign value means no choice", () => {
    expect(parseLiveChoice(liveChoiceValue(true))).toBe(true);
    expect(parseLiveChoice(liveChoiceValue(false))).toBe(false);
    expect(parseLiveChoice(null)).toBeNull();
    expect(parseLiveChoice("yes")).toBeNull();
  });
});
