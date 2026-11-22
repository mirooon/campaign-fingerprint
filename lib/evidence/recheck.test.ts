import { describe, expect, it } from "vitest";
import { recheckEntries, type RecheckProbes, type RecheckRecord } from "./recheck";

const record: RecheckRecord = {
  observations: {
    domains: [
      { domain_fqdn: "oferta.example", pages: [{ status: 200, fetched_utc: "2026-11-18T09:01:00.000Z", body_sha256_raw: "a".repeat(64) }] },
      { domain_fqdn: "zniknela.example", pages: [] },
    ],
    ads: [{ item_id: "a1", repository_record: [{ id: "1000000000000101", taken_down: false, fetched_utc: "2026-11-18T09:02:00.000Z" }] }, { item_id: "a2", repository_record: null }],
  },
};

const probes = (over: Partial<RecheckProbes> = {}): RecheckProbes => ({
  dns: async (d) => (d === "oferta.example" ? { addresses: ["192.0.2.10"], error: null } : { addresses: [], error: "ENOTFOUND" }),
  certStatus: (d) => (d === "zniknela.example" ? { status: "active", insertDate: "2026-11-19T00:00:00.000Z", copyUtc: "2026-11-20T00:00:00.000Z" } : { status: "absent", insertDate: null, copyUtc: "2026-11-20T00:00:00.000Z" }),
  adLibrary: async () => ({ takenDown: true, error: null }),
  ...over,
});
const now = () => new Date("2026-11-21T10:00:00Z");

describe("recheckEntries", () => {
  it("appends an entry per domain with DNS, CERT status and the state at the time of the report", async () => {
    const entries = await recheckEntries(record, probes(), now);
    const d = entries.find((e) => e.action.includes("oferta.example"))!;
    expect(d.utc).toBe("2026-11-21T10:00:00.000Z");
    expect(d.actor).toBe("starter (ponowne sprawdzenie)");
    expect(d.action).toMatch(/192\.0\.2\.10/);
    expect(d.action).toMatch(/w chwili zgłoszenia: HTTP 200.*2026-11-18T09:01:00.000Z.*a{64}/);
    const gone = entries.find((e) => e.action.includes("zniknela.example"))!;
    expect(gone.action).toMatch(/offline|nie rozwiązuje/);
    expect(gone.action).toMatch(/na Liście Ostrzeżeń CERT od 2026-11-19/);
  });

  it("records the library record state now against the state at the time of the report", async () => {
    const entries = await recheckEntries(record, probes(), now);
    const ad = entries.find((e) => e.action.includes("1000000000000101"))!;
    expect(ad.action).toMatch(/usunięta: tak/);
    expect(ad.action).toMatch(/w chwili zgłoszenia: nie/);
  });

  it("gives the reason when a probe could not run and promises no removal", async () => {
    const entries = await recheckEntries(record, probes({ adLibrary: null }), now);
    expect(entries.find((e) => e.action.includes("biblioteka reklam"))!.action).toMatch(/pominięto/);
    expect(entries.at(-1)!.action).toMatch(/nie przesądza o usunięciu/);
  });
});
