/**
 * Backtests of the CT watcher (B-241). (1) How much earlier a certificate appears in the CT logs than its domain on the
 * CERT Warning List (lead time). (2) How many later listed domains the fingerprints of campaigns known up to a day D
 * would have flagged, at a given budget of alerts, using only certificates seen after D (no leak from the future).
 * Pure: certificates and list entries come in as data; `scripts/backtest-ct.ts` reads the files and asks crt.sh.
 */
import type { Campaign, CampaignsFile } from "../graph/model";
import type { EnrichedDataset } from "../pipeline/types";
import { registrableDomain } from "../osint/urls";
import { matchDomain, registrableOfName, type FingerprintSet } from "./fingerprint";

export const BACKTEST_CONFIG = {
  /** A CA backdates `not_before` by about this many hours before issuing; without the log entry time it is added back. */
  notBeforeBackdateHours: 1,
  /** crt.sh often refuses or drops a query: attempts per query and the pause between them. */
  queryAttempts: 3,
  retryDelayMs: 5_000,
  /** Budgets of alerts (the number of domains a human would check) the recall is reported for. */
  alertBudgets: [10, 50, 100],
} as const;

const HOUR_MS = 3_600_000;

/**
 * ISO time at which a certificate became public: the log entry time (SCT) when known, else `not_before` plus the
 * usual backdating. Null when neither is known.
 */
export function appearanceTime(c: { entryTimestamp?: string | null; notBefore?: string | null }): string | null {
  const entry = c.entryTimestamp ? Date.parse(c.entryTimestamp) : NaN;
  if (Number.isFinite(entry)) return new Date(entry).toISOString();
  const nb = c.notBefore ? Date.parse(c.notBefore) : NaN;
  return Number.isFinite(nb) ? new Date(nb + BACKTEST_CONFIG.notBeforeBackdateHours * HOUR_MS).toISOString() : null;
}

/** Hours from the certificate appearing to the list entry; positive when CT came first. */
export function leadHours(listedUtc: string, appearedUtc: string): number {
  return (Date.parse(listedUtc) - Date.parse(appearedUtc)) / HOUR_MS;
}

/** Median of the numbers; null for none. */
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Value at quantile `q` (0..1) of the sorted numbers, no interpolation; null for none. */
const quantile = (xs: number[], q: number): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

export interface LeadSummary {
  /** Listed domains examined. */
  n: number;
  /** Of them, with a certificate found. */
  withCt: number;
  medianHours: number | null;
  p25Hours: number | null;
  p75Hours: number | null;
  /** Share (of those with a certificate) where CT was at least 24 h ahead. */
  shareAtLeast24h: number | null;
}

/** Summary of lead times; a domain without a certificate counts in `n` but not in the statistics. */
export function summarizeLeads(rows: Array<{ domain: string; listedUtc: string; appearedUtc: string | null }>): LeadSummary {
  const leads = rows.filter((r) => r.appearedUtc).map((r) => leadHours(r.listedUtc, r.appearedUtc!));
  return {
    n: rows.length,
    withCt: leads.length,
    medianHours: median(leads),
    p25Hours: quantile(leads, 0.25),
    p75Hours: quantile(leads, 0.75),
    shareAtLeast24h: leads.length ? leads.filter((h) => h >= 24).length / leads.length : null,
  };
}

/**
 * Runs `fn`, and again after `delayMs` when it throws, at most `attempts` times; the last error is rethrown. The sleep
 * is injectable so a test does not wait.
 */
export async function withRetry<T>(fn: () => Promise<T>, o: { attempts: number; delayMs: number; sleep?: (ms: number) => Promise<void> }): Promise<T> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= o.attempts) throw e;
      await sleep(o.delayMs);
    }
  }
}

/**
 * The campaigns as they were known on day D: only members whose first sighting is on or before D, and only the domains
 * of those members. A campaign with no such member is dropped. This is what keeps the backtest free of the future.
 */
export function campaignsKnownBefore(campaigns: CampaignsFile, ds: EnrichedDataset, dayUtc: string): CampaignsFile {
  const day = Date.parse(dayUtc);
  const seen = new Set(ds.items.filter((i) => i.firstSeen && Date.parse(i.firstSeen) <= day).map((i) => i.id));
  const known: Campaign[] = [];
  for (const c of campaigns.campaigns) {
    const members = c.members.filter((m) => seen.has(m));
    if (!members.length) continue;
    const domains = [...new Set(members.map((m) => ds.perItem[m]?.landing?.url).map((u) => (u ? registrableDomain(u) : null)).filter((d): d is string => !!d))];
    known.push({ ...c, members, size: members.length, domains: c.domains.filter((d) => domains.includes(d)) });
  }
  return { ...campaigns, campaigns: known, assignments: Object.fromEntries(Object.entries(campaigns.assignments).filter(([id]) => seen.has(id))) };
}

export interface Sighting {
  domain: string;
  /** When a certificate for the domain first appeared in the logs. */
  seenUtc: string;
}

export interface BacktestAlert {
  domain: string;
  campaignId: string;
  score: number;
  seenUtc: string;
  /** Entry on the CERT list after the alert, null when the domain never got one. */
  listedUtc: string | null;
  leadHours: number | null;
}

export interface BacktestResult {
  alerts: BacktestAlert[];
  /** Domains listed after `since`: what a perfect watcher would have found. */
  positives: number;
  byBudget: Array<{ budget: number; alerts: number; hits: number; recall: number | null; medianLeadHours: number | null }>;
}

/**
 * Matches the certificates seen after `since` (and only those) to the fingerprints in `set`, built from campaigns known
 * up to `since`, and compares the alerts with the domains the list got later. The alerts are ranked by score (ties: the
 * earlier certificate); at each budget the first N alerts count, a hit is an alerted domain listed afterwards, recall is
 * hits over the domains listed after `since`.
 */
export function backtestFingerprints(o: { set: FingerprintSet; sightings: Sighting[]; listed: Map<string, string>; since: string; budgets: number[] }): BacktestResult {
  const since = Date.parse(o.since);
  const bySite = new Map<string, Sighting>();
  for (const s of o.sightings) {
    const d = registrableOfName(s.domain);
    if (!d || Date.parse(s.seenUtc) <= since) continue;
    const prev = bySite.get(d);
    if (!prev || Date.parse(s.seenUtc) < Date.parse(prev.seenUtc)) bySite.set(d, { domain: d, seenUtc: s.seenUtc });
  }
  const alerts: BacktestAlert[] = [];
  for (const s of bySite.values()) {
    const m = matchDomain(s.domain, o.set);
    if (!m) continue;
    const listed = o.listed.get(s.domain) ?? null;
    alerts.push({ domain: s.domain, campaignId: m.campaignId, score: m.score, seenUtc: s.seenUtc, listedUtc: listed && Date.parse(listed) >= Date.parse(s.seenUtc) ? listed : null, leadHours: listed && Date.parse(listed) >= Date.parse(s.seenUtc) ? leadHours(listed, s.seenUtc) : null });
  }
  alerts.sort((a, b) => b.score - a.score || a.seenUtc.localeCompare(b.seenUtc) || a.domain.localeCompare(b.domain));
  const positives = [...o.listed.values()].filter((t) => Date.parse(t) > since).length;
  const byBudget = o.budgets.map((budget) => {
    const top = alerts.slice(0, budget);
    const hits = top.filter((a) => a.listedUtc);
    return { budget, alerts: top.length, hits: hits.length, recall: positives ? hits.length / positives : null, medianLeadHours: median(hits.map((a) => a.leadHours!)) };
  });
  return { alerts, positives, byBudget };
}

/**
 * Entries of the CERT Warning List actions log (one JSON object per line: `DomainAddress`, `ActionTime`, `ActionType`):
 * the `block` actions, earliest listing of each domain kept. A line that is not JSON is left out.
 */
export function parseCertActions(text: string): Array<{ domain: string; listedUtc: string }> {
  const first = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row: { DomainAddress?: unknown; ActionTime?: unknown; ActionType?: unknown };
    try {
      row = JSON.parse(line);
    } catch {
      continue; // a partial or damaged line: the rest of the log is still usable
    }
    if (row.ActionType !== "block" || typeof row.DomainAddress !== "string" || typeof row.ActionTime !== "string") continue;
    const t = Date.parse(row.ActionTime);
    if (!Number.isFinite(t)) continue;
    const domain = row.DomainAddress.toLowerCase().replace(/\.$/, "");
    const iso = new Date(t).toISOString();
    if (!first.has(domain) || iso < first.get(domain)!) first.set(domain, iso);
  }
  return [...first].map(([domain, listedUtc]) => ({ domain, listedUtc })).sort((a, b) => a.listedUtc.localeCompare(b.listedUtc));
}

/**
 * Certificates recorded as JSON lines `{ "names": [...], "entry_timestamp": ..., "not_before": ... }` (a crt.sh result
 * reduced to what the backtest reads): the earliest appearance of each registrable domain. Names that are not
 * domains and certificates without any time are left out.
 */
export function parseSightings(text: string): Sighting[] {
  const earliest = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row: { names?: unknown; entry_timestamp?: unknown; not_before?: unknown };
    try {
      row = JSON.parse(line);
    } catch {
      continue; // a partial or damaged line
    }
    const seen = appearanceTime({ entryTimestamp: typeof row.entry_timestamp === "string" ? row.entry_timestamp : null, notBefore: typeof row.not_before === "string" ? row.not_before : null });
    if (!seen || !Array.isArray(row.names)) continue;
    for (const name of row.names) {
      const d = typeof name === "string" ? registrableOfName(name) : null;
      if (d && (!earliest.has(d) || seen < earliest.get(d)!)) earliest.set(d, seen);
    }
  }
  return [...earliest].map(([domain, seenUtc]) => ({ domain, seenUtc }));
}
