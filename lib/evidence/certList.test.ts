import { describe, expect, it } from "vitest";
import { certStatus, parseCertList, type CertListSnapshot } from "./certList";

const FILE = JSON.stringify([
  { RegisterPositionId: 101, DomainAddress: "aktywna.example", InsertDate: "2026-11-01T08:00:00Z", DeleteDate: null },
  { RegisterPositionId: 102, DomainAddress: "zdjeta.example", InsertDate: "2026-05-01T08:00:00Z", DeleteDate: "2026-10-01T08:00:00Z" },
  { RegisterPositionId: 103, DomainAddress: "Wiele.EXAMPLE.", InsertDate: "2026-01-01T00:00:00Z", DeleteDate: "2026-02-01T00:00:00Z" },
  { RegisterPositionId: 104, DomainAddress: "wiele.example", InsertDate: "2026-09-01T00:00:00Z", DeleteDate: "2027-03-01T00:00:00Z" },
  { Nonsense: true },
]);
const snapshot: CertListSnapshot = { entries: parseCertList(FILE), copyUtc: "2026-11-18T00:00:00.000Z" };
const NOW = new Date("2026-11-19T12:00:00Z");

describe("parseCertList", () => {
  it("reads the v2 JSON fields, normalises the domain and skips rows without an address", () => {
    expect(snapshot.entries).toHaveLength(4);
    expect(snapshot.entries[2]).toMatchObject({ registerPositionId: 103, domain: "wiele.example", insertDate: "2026-01-01T00:00:00.000Z" });
  });

  it("rejects text that is not a list", () => {
    expect(() => parseCertList("{}")).toThrow(/list/i);
  });
});

describe("certStatus", () => {
  it("is active for an entry without a delete date or with one in the future, and prefers it to an older removed one", () => {
    expect(certStatus(snapshot, "aktywna.example", NOW)).toMatchObject({ status: "active", registerPositionId: 101, insertDate: "2026-11-01T08:00:00.000Z", matched: "aktywna.example" });
    expect(certStatus(snapshot, "wiele.example", NOW)).toMatchObject({ status: "active", registerPositionId: 104 });
  });

  it("is removed when the delete date has passed, and absent when there is no entry", () => {
    expect(certStatus(snapshot, "zdjeta.example", NOW)).toMatchObject({ status: "removed", registerPositionId: 102 });
    expect(certStatus(snapshot, "nie-ma.example", NOW)).toMatchObject({ status: "absent", registerPositionId: null });
  });

  it("covers subdomains of a listed domain (the list recommends blocking subdomains)", () => {
    expect(certStatus(snapshot, "login.aktywna.example", NOW)).toMatchObject({ status: "active", matched: "aktywna.example" });
  });

  it("says it did not check when there is no local copy", () => {
    expect(certStatus(null, "aktywna.example", NOW)).toMatchObject({ status: "unchecked" });
  });
});
