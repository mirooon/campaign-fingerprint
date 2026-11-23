/**
 * Passive lookups (RDAP, DNS) of the domains of a material that got no answer, in one format for every
 * place that shows them: the record's error line ("RDAP did not answer for <domain>: <reason>"), the
 * failed-lookup entry ("rdap:<domena>", "dns:<domena>", as the import's `failedLookups`) and the outcome
 * of the `lookups` step of the analysis. No Node imports: the viewer reads it as well.
 */

export type LookupKind = "rdap" | "dns";

/** Passive lookups of the registrable domains one record leads to (`ItemEnrichment.lookups`). */
export interface RecordLookups {
  /** Registrable domains of the record's addresses (landing page, redirects, ad text, address bar, contact e-mails) that were looked up. */
  domains: string[];
  /** Lookups that got no answer: "rdap:<domain>" or "dns:<domain>" (also when only a host of that domain failed), sorted. */
  failed: string[];
}

/** Outcome of the `lookups` step for one case (the progress event of `analyzeMaterial`). */
export interface LookupsOutcome {
  status: "done" | "skipped" | "error";
  detail: string;
}

const LABEL: Record<LookupKind, string> = { rdap: "RDAP", dns: "DNS" };

/** Error line of a record for a lookup that got no answer, e.g. "RDAP did not answer for example.test: no network connection". */
export function lookupErrorLine(kind: LookupKind, name: string, reason: string): string {
  return `${LABEL[kind]} did not answer for ${name}${reason ? `: ${reason}` : ""}`;
}

/**
 * Kind, name (host or domain, lower case) and reason of an error line written by `lookupErrorLine`; null for any other error.
 * The Polish wording of bases built before the English output ("nie odpowiedział dla") is still read.
 */
export function parseLookupErrorLine(line: string): { kind: LookupKind; name: string; reason: string } | null {
  const m = /^(RDAP|DNS) (?:did not answer for|nie odpowiedział dla) ([^\s:]+)(?::\s*(.*))?$/.exec(line);
  return m ? { kind: m[1] === "RDAP" ? "rdap" : "dns", name: m[2].toLowerCase(), reason: (m[3] ?? "").trim() } : null;
}

/** Whether `name` (a host or a domain) is `domain` or one of its subdomains. */
export function belongsToDomain(name: string, domain: string): boolean {
  const n = name.toLowerCase();
  const d = domain.toLowerCase();
  return n === d || n.endsWith(`.${d}`);
}

/** Reason of a lookup that threw: no answer in time, no network, an HTTP status, else the message itself. */
export function lookupReason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const name = e instanceof Error ? e.name : "";
  const err = e as { code?: unknown; cause?: { code?: unknown } } | null;
  // fetch puts the system error (ENOTFOUND, a connect timeout) in `cause`
  const text = `${msg} ${String(err?.code ?? "")} ${String(err?.cause?.code ?? "")}`;
  const http = /\bHTTP (\d{3})\b/.exec(msg);
  if (http) return `HTTP ${http[1]} response`;
  if (name === "TimeoutError" || name === "AbortError" || /timed? ?out/i.test(text)) return "no answer within the time limit";
  if (/fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH/i.test(text)) return "no network connection";
  return msg;
}

/** Reason from the error codes of a DNS answer (`DnsRecords.errors`), e.g. "A, AAAA: no answer within the time limit"; "" when there is none. */
export function dnsErrorReason(errors: Partial<Record<string, string>> | null | undefined): string {
  const byCode = new Map<string, string[]>();
  for (const [type, code] of Object.entries(errors ?? {})) {
    if (!code) continue;
    const text = code === "timeout" ? "no answer within the time limit" : code;
    byCode.set(text, [...(byCode.get(text) ?? []), type]);
  }
  return [...byCode].map(([text, types]) => `${types.join(", ")}: ${text}`).join("; ");
}

/**
 * Reason of the skipped `lookups` step in a run without live lookups. Offline is the container default
 * (ANALYZE_OFFLINE=1) or a run that did not ask for them, never a failure, and the reason says which.
 */
export function lookupsOffReason(env: Record<string, string | undefined>): string {
  return env.ANALYZE_OFFLINE === "1"
    ? "offline mode (ANALYZE_OFFLINE=1, the container default): no DNS or RDAP queries, only the pages in the sample"
    : "offline mode: no DNS or RDAP queries (neither --live nor “Fetch public domain data (DNS, domain registry)” was turned on), only the pages in the sample";
}

/** "of 1 domain", "of 5 domains". */
function ofDomains(n: number): string {
  return `of ${n} ${n === 1 ? "domain" : "domains"}`;
}

/** Up to three names, then how many more. */
function someNames(names: string[]): string {
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
}

/**
 * Outcome of the `lookups` step for the records of one case. `offReason` set: "skipped" with it (no live
 * lookups in this run). No domain to look up: "skipped" with that reason. Otherwise "done", with how
 * many domains RDAP and DNS answered for ("RDAP did not answer for 2 of 5 domains: …"), and "error" only
 * when neither RDAP nor DNS answered for any of them (no network).
 */
export function lookupsOutcome(records: Array<RecordLookups | undefined>, offReason: string | null): LookupsOutcome {
  if (offReason) return { status: "skipped", detail: offReason };
  const domains = [...new Set(records.flatMap((r) => r?.domains ?? []))].sort();
  if (!domains.length) return { status: "skipped", detail: "no domain to look up: the sample points to no page URL" };
  const failed = new Set(records.flatMap((r) => r?.failed ?? []));
  const failedOf = (kind: LookupKind) => domains.filter((d) => failed.has(`${kind}:${d}`));
  const rdap = failedOf("rdap");
  const dns = failedOf("dns");
  const n = domains.length;
  if (!rdap.length && !dns.length) return { status: "done", detail: `RDAP and DNS answered for ${n} ${ofDomains(n)}` };
  const part = (kind: LookupKind, list: string[]) => (list.length ? `${LABEL[kind]} did not answer for ${list.length} ${ofDomains(n)}: ${someNames(list)}` : null);
  const detail = [part("rdap", rdap), part("dns", dns)].filter((p): p is string => !!p).join("; ");
  return { status: rdap.length === n && dns.length === n ? "error" : "done", detail };
}
