import { describe, expect, it } from "vitest";
import { liveChoiceValue, liveLookupsOption, OFFLINE_NOTE, parseLiveChoice, serverOffline } from "./liveLookups";

describe("serverOffline", () => {
  it("tylko ANALYZE_OFFLINE=1 wyłącza zapytania serwera", () => {
    expect(serverOffline({ ANALYZE_OFFLINE: "1" })).toBe(true);
    expect(serverOffline({ ANALYZE_OFFLINE: "0" })).toBe(false);
    expect(serverOffline({})).toBe(false);
  });
});

describe("liveLookupsOption", () => {
  it("serwer offline: pole odznaczone i zablokowane z notką, także po wcześniejszym wyborze", () => {
    expect(liveLookupsOption(true, null)).toEqual({ checked: false, disabled: true, note: OFFLINE_NOTE });
    expect(liveLookupsOption(true, true).checked).toBe(false);
    expect(OFFLINE_NOTE).toMatch(/bez internetu/);
  });
  it("serwer z internetem: domyślnie zaznaczone, potem wybór z tej sesji", () => {
    expect(liveLookupsOption(false, null)).toEqual({ checked: true, disabled: false, note: null });
    expect(liveLookupsOption(false, false).checked).toBe(false);
    expect(liveLookupsOption(false, true).checked).toBe(true);
  });
});

describe("wybór w pamięci sesji", () => {
  it("zapis i odczyt są zgodne; obca wartość to brak wyboru", () => {
    expect(parseLiveChoice(liveChoiceValue(true))).toBe(true);
    expect(parseLiveChoice(liveChoiceValue(false))).toBe(false);
    expect(parseLiveChoice(null)).toBeNull();
    expect(parseLiveChoice("tak")).toBeNull();
  });
});
