import { describe, expect, it } from "vitest";
import { phoneLineInfo, phoneLineFlags } from "./phoneLine";

// Line type of a number from the offline metadata of libphonenumber-js: synthetic numbers of the reserved ranges only.

describe("phoneLineInfo", () => {
  it("reads the line type and the country of the number", () => {
    expect(phoneLineInfo("+48800000000")).toEqual({ phone: "+48800000000", lineType: "toll_free", country: "PL" });
    expect(phoneLineInfo("+48601234567")).toMatchObject({ lineType: "mobile", country: "PL" });
    expect(phoneLineInfo("+48221234567")).toMatchObject({ lineType: "fixed", country: "PL" });
    expect(phoneLineInfo("+48801123456")).toMatchObject({ lineType: "shared_cost" });
    expect(phoneLineInfo("+48700123456")).toMatchObject({ lineType: "premium" });
    expect(phoneLineInfo("+442079460958")).toMatchObject({ lineType: "fixed", country: "GB" });
  });

  it("says unknown for a number the metadata cannot place and null country for garbage", () => {
    expect(phoneLineInfo("+999123")).toEqual({ phone: "+999123", lineType: "unknown", country: null });
    expect(phoneLineInfo("not a number")).toEqual({ phone: "not a number", lineType: "unknown", country: null });
  });
});

describe("phoneLineFlags", () => {
  it("flags a number of another country than the market of the page", () => {
    const lines = [phoneLineInfo("+442079460958")];
    expect(phoneLineFlags(lines, { market: "PL", securityAlert: false }).phoneCountryMismatch).toBe(true);
    expect(phoneLineFlags(lines, { market: "GB", securityAlert: false }).phoneCountryMismatch).toBe(false);
    expect(phoneLineFlags([phoneLineInfo("+48601234567")], { market: "PL", securityAlert: false }).phoneCountryMismatch).toBe(false);
  });

  it("flags a toll-free number on a fake security alert and nowhere else", () => {
    const lines = [phoneLineInfo("+48800000000")];
    expect(phoneLineFlags(lines, { market: "PL", securityAlert: true }).tollFreeOnAlert).toBe(true);
    expect(phoneLineFlags(lines, { market: "PL", securityAlert: false }).tollFreeOnAlert).toBe(false);
    expect(phoneLineFlags([phoneLineInfo("+48601234567")], { market: "PL", securityAlert: true }).tollFreeOnAlert).toBe(false);
  });

  it("does not call an unplaced number a country mismatch", () => {
    expect(phoneLineFlags([phoneLineInfo("+999123")], { market: "PL", securityAlert: false }).phoneCountryMismatch).toBe(false);
  });
});
