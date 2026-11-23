/**
 * Passive re-check of a pack after the report: which domains and ads are still reachable, whether
 * they are on the CERT list now, whether the ad-library record shows the ad as removed. Each finding
 * is a chain-of-custody entry with the time, next to what the pack recorded at the time of the
 * report (status code, SHA-256 of the content, library state): proof that the content was available
 * when it was reported, against "the ad is no longer there". It promises no removal. The probes
 * (DNS, local CERT list, ad library) are passed in, so the logic runs without a network.
 */
import type { CertStatus } from "./certList";
import type { CustodyEntry } from "./custody";

/** The part of evidence.json that the re-check reads. */
export interface RecheckRecord {
  observations: {
    domains: Array<{ domain_fqdn: string; pages: Array<{ status: number | null; fetched_utc: string | null; body_sha256_raw: string | null }> }>;
    ads: Array<{ item_id: string; repository_record: Array<{ id: string; taken_down: boolean | null; fetched_utc: string | null }> | null }>;
  };
}

export interface RecheckProbes {
  /** Addresses of the domain now; `error` set when it does not resolve (e.g. ENOTFOUND). */
  dns(domain: string): Promise<{ addresses: string[]; error: string | null }>;
  /** Status on the local copy of the CERT list; null when there is no copy. */
  certStatus: ((domain: string) => Pick<CertStatus, "status" | "insertDate" | "copyUtc">) | null;
  /** Library record state now; null when the tool is not available (the entry then says it was skipped). */
  adLibrary: ((id: string) => Promise<{ takenDown: boolean | null; error: string | null }>) | null;
}

const ACTOR = "starter (re-check)";
/** "yes" / "no" / "unknown" for a value the library may not give. */
const yesNo = (v: boolean | null): string => (v === null ? "unknown" : v ? "yes" : "no");

/** Chain-of-custody entries of one re-check, in the order domains, ad-library records, summary. */
export async function recheckEntries(record: RecheckRecord, probes: RecheckProbes, now: () => Date = () => new Date()): Promise<CustodyEntry[]> {
  const utc = now().toISOString();
  /** Chain entry stamped with the time of this re-check. */
  const entry = (action: string): CustodyEntry => ({ utc, actor: ACTOR, action });
  const out: CustodyEntry[] = [];
  for (const d of record.observations.domains) {
    const dns = await probes.dns(d.domain_fqdn);
    const page = d.pages[0];
    const cert = probes.certStatus?.(d.domain_fqdn);
    out.push(
      entry(
        `domain ${d.domain_fqdn}: ${dns.error ? `does not resolve (${dns.error}), offline or blocked` : `resolves: ${dns.addresses.join(", ")}`}; ` +
          `${cert ? (cert.status === "active" ? `on the CERT Warning List since ${cert.insertDate ?? "?"} (copy of ${cert.copyUtc ?? "?"})` : `status on the CERT list: ${cert.status}`) : "CERT list: no local copy, skipped"}; ` +
          `at the time of the report: ${page ? `HTTP ${page.status ?? "?"}, fetched ${page.fetched_utc ?? "?"}, content sha256 ${page.body_sha256_raw ?? "?"}` : "no page fetch in the pack"}`,
      ),
    );
  }
  for (const ad of record.observations.ads) {
    for (const r of ad.repository_record ?? []) {
      if (!probes.adLibrary) {
        out.push(entry(`ad library, record ${r.id} (ad ${ad.item_id}): skipped, no ad library tool`));
        continue;
      }
      const current = await probes.adLibrary(r.id);
      out.push(
        entry(
          current.error
            ? `ad library, record ${r.id} (ad ${ad.item_id}): could not check (${current.error})`
            : `ad library, record ${r.id} (ad ${ad.item_id}): taken down: ${yesNo(current.takenDown)}; at the time of the report: ${yesNo(r.taken_down)} (fetched ${r.fetched_utc ?? "?"})`,
        ),
      );
    }
  }
  out.push(entry("passive re-check (DNS, local CERT list, ad library); it does not settle whether the content was removed or whether the platform reacted"));
  return out;
}
