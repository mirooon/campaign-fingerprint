import { describe, expect, it } from "vitest";
import { adCreatedApprox } from "./metaIdAge";

const A = { id: "120200000000000000", date: "2026-01-01" };
const B = { id: "120200000000002000", date: "2026-01-11" };

describe("adCreatedApprox", () => {
  it("interpolates between two anchors", () => {
    expect(adCreatedApprox("120200000000001000", [A, B])).toBe("2026-01-06");
  });
  it("gives nothing outside the anchors, with one anchor or for another id shape", () => {
    expect(adCreatedApprox("120200000000003000", [A, B])).toBeNull();
    expect(adCreatedApprox("120200000000001000", [A])).toBeNull();
    expect(adCreatedApprox("12345", [A, B])).toBeNull();
  });
});
