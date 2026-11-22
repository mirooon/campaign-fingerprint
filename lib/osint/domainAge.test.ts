/**
 * Age of a domain and of its first certificate on the day a material was first seen (B-191): a description,
 * not a risk score. Synthetic dates only.
 */
import { describe, expect, it } from "vitest";
import { domainAgeAt } from "./domainAge";

describe("domain and certificate age at first sight", () => {
  it("counts whole days from registration and from the earliest certificate to the material's date", () => {
    expect(domainAgeAt("2026-09-07T10:00:00Z", ["2026-09-12T08:00:00", "2026-09-09T00:00:00"], "2026-09-10T12:00:00Z")).toEqual({ domainAgeDays: 3, certAgeDays: 1, firstCertificate: "2026-09-09T00:00:00" });
  });

  it("gives nulls without dates and keeps a negative age when the registration is later than the material (re-registered domain)", () => {
    expect(domainAgeAt(null, [], "2026-09-10T00:00:00Z")).toEqual({ domainAgeDays: null, certAgeDays: null, firstCertificate: null });
    expect(domainAgeAt("2026-09-20T00:00:00Z", [], "2026-09-10T00:00:00Z").domainAgeDays).toBe(-10);
    expect(domainAgeAt("2026-09-01T00:00:00Z", [], null).domainAgeDays).toBeNull();
  });
});
