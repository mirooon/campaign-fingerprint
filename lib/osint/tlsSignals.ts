/**
 * Attributes of the TLS certificate a page was served with, read from the `securityDetails` of a HAR entry:
 * the issuer, whether its names cover the host, whether it had expired when the page was saved.
 *
 * A free domain-validated certificate (Let's Encrypt) proves nothing about the shop and is only context: the
 * padlock means an encrypted connection, not an honest seller. A certificate for another host or an expired
 * one is a flag that explains why the browser showed a warning. None of them links anything.
 * Pure functions.
 */

/** Certificate details of a HAR entry (Chrome writes `_securityDetails`; validity as epoch seconds or ISO text). */
export interface TlsDetails {
  issuer: string | null;
  validFrom: string | number | null;
  validTo: string | number | null;
  sanList: string[];
  subjectName: string | null;
}

export interface TlsSignals {
  issuer: string | null;
  /** None of the certificate's names covers the host. */
  certMismatch: boolean;
  /** The certificate's end date is before the date the page was saved. */
  certExpired: boolean;
}

/** Time of a validity value: epoch seconds, or ISO text; null when it is neither. */
function timeOf(v: string | number | null): number | null {
  if (v === null) return null;
  const t = typeof v === "number" ? v * 1000 : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** A certificate name covers the host when equal, or when it is `*.` plus the host's name minus one label. */
function covers(name: string, host: string): boolean {
  const n = name.toLowerCase();
  if (n === host) return true;
  if (!n.startsWith("*.")) return false;
  const rest = host.split(".").slice(1).join(".");
  return rest === n.slice(2);
}

/**
 * Flags of a certificate against the host it was served for and the time the page was saved (ISO; null when
 * unknown, then no expiry verdict). Missing names or dates give no verdict.
 */
export function tlsSignals(tls: TlsDetails, host: string, savedAt: string | null | undefined): TlsSignals {
  const names = [...tls.sanList, ...(tls.subjectName ? [tls.subjectName] : [])];
  const end = timeOf(tls.validTo);
  const saved = savedAt ? Date.parse(savedAt) : NaN;
  return {
    issuer: tls.issuer,
    certMismatch: names.length > 0 && !names.some((n) => covers(n, host.toLowerCase())),
    certExpired: end !== null && Number.isFinite(saved) && end < saved,
  };
}
