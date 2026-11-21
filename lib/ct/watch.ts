/**
 * CT watcher: matches certificate names from a CT stream (or a crt.sh backfill, or a replayed
 * file) against campaign fingerprints, enriches matches passively and appends them to the
 * JSONL feed as "candidates" attached to the nearest campaign. Each domain is reported once
 * (domains already in the feed are skipped after a restart).
 */
import pLimit from "p-limit";
import type { CtResult } from "../osint/ct";
import type { EnrichmentSources } from "../pipeline/sources";
import { enrichCandidate } from "./enrich";
import { appendFeed, feedDomains, type CandidateEnrichment, type CtFeedRecord } from "./feed";
import { matchDomain, registrableOfName, type CtMatch, type FingerprintSet } from "./fingerprint";
import type { CtStreamEvent } from "./stream";

export const CANDIDATE_NOTE = "kandydat do weryfikacji przez człowieka: dopasowanie nazwy domeny do odcisku kampanii, nie dowód";

export interface CtWatcherOptions {
  set: FingerprintSet;
  /** null: dry run (nothing written). */
  feedFile: string | null;
  source: CtFeedRecord["source"];
  stream?: string | null;
  /** Passive enrichment of matches; null/undefined disables it. */
  enrich?: { sources: EnrichmentSources; fetchPage?: boolean; maxPerMinute?: number; concurrency?: number } | null;
  now?: () => Date;
  log?: (message: string) => void;
  onCandidate?: (record: CtFeedRecord) => void;
  /** Memory cap for the set of already checked domains. Default 500 000. */
  maxChecked?: number;
}

export interface CtWatcherStats {
  events: number;
  names: number;
  domains: number;
  candidates: number;
  enriched: number;
  enrichSkipped: number;
}

export class CtWatcher {
  readonly stats: CtWatcherStats = { events: 0, names: 0, domains: 0, candidates: 0, enriched: 0, enrichSkipped: 0 };
  private readonly checked = new Set<string>();
  private readonly reported: Set<string>;
  private readonly pending = new Set<Promise<void>>();
  private readonly enrichTimes: number[] = [];
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(private readonly opts: CtWatcherOptions) {
    this.reported = opts.feedFile ? feedDomains(opts.feedFile) : new Set();
    this.limit = pLimit(opts.enrich?.concurrency ?? 2);
  }

  /** Processes one CT entry; matching is synchronous, enrichment and writing run in the background. */
  handle(event: CtStreamEvent, meta: { crtshId?: string | null } = {}): void {
    this.stats.events++;
    const byDomain = new Map<string, string[]>();
    for (const name of event.domains) {
      this.stats.names++;
      const d = registrableOfName(name);
      if (!d) continue;
      const list = byDomain.get(d) ?? [];
      if (!list.includes(name)) list.push(name);
      byDomain.set(d, list);
    }
    for (const [domain, names] of byDomain) {
      if (this.checked.has(domain)) continue;
      if (this.checked.size >= (this.opts.maxChecked ?? 500_000)) this.checked.clear();
      this.checked.add(domain);
      this.stats.domains++;
      if (this.reported.has(domain)) continue;
      const m = matchDomain(domain, this.opts.set);
      if (!m) continue;
      this.reported.add(domain);
      this.stats.candidates++;
      const p: Promise<void> = this.emit(m, names, event, meta).finally(() => this.pending.delete(p));
      this.pending.add(p);
    }
  }

  /** Waits for background enrichment and feed writes (at most timeoutMs). */
  async flush(timeoutMs = 120_000): Promise<void> {
    if (!this.pending.size) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.allSettled([...this.pending]), new Promise<void>((r) => (timer = setTimeout(r, timeoutMs)))]);
    clearTimeout(timer);
  }

  private async emit(m: CtMatch, names: string[], event: CtStreamEvent, meta: { crtshId?: string | null }): Promise<void> {
    const observed = (this.opts.now?.() ?? new Date()).toISOString();
    let enrichment: CandidateEnrichment | null = null;
    const e = this.opts.enrich;
    if (e) {
      const now = Date.now();
      while (this.enrichTimes.length && now - this.enrichTimes[0] > 60_000) this.enrichTimes.shift();
      if (this.enrichTimes.length >= (e.maxPerMinute ?? 30)) {
        this.stats.enrichSkipped++;
        enrichment = { dns: null, hosts: [], rdap: null, ct: null, page: null, errors: [], skipped: "limit wzbogaceń na minutę" };
      } else {
        this.enrichTimes.push(now);
        try {
          enrichment = await this.limit(() => enrichCandidate(m.domain, names, e.sources, { fetchPage: e.fetchPage }));
          this.stats.enriched++;
        } catch (err) {
          enrichment = { dns: null, hosts: [], rdap: null, ct: null, page: null, errors: [String((err as Error)?.message ?? err)], skipped: null };
        }
      }
    }
    const record: CtFeedRecord = {
      v: 1,
      type: "ct_candidate",
      observed_utc: observed,
      source: this.opts.source,
      stream: this.opts.stream ?? null,
      domain: m.domain,
      names: names.sort(),
      cert: {
        issuer: event.issuer,
        not_before: event.notBefore,
        not_after: event.notAfter,
        fingerprint: event.fingerprint,
        serial: event.serial,
        log: event.logName,
        log_url: event.logUrl,
        cert_index: event.certIndex,
        crtsh_id: meta.crtshId ?? null,
        seen_utc: event.seenUtc,
      },
      candidate: {
        campaign_id: m.campaignId,
        campaign_label: m.campaignLabel,
        score: m.score,
        kind: m.kind,
        template: m.template,
        similar_domains: m.similarDomains,
        tokens: m.tokens,
        evidence: m.evidence,
      },
      enrichment,
      status: "candidate",
      note: CANDIDATE_NOTE,
    };
    if (this.opts.feedFile) appendFeed(this.opts.feedFile, record);
    this.opts.log?.(`[ct] kandydat ${m.domain} -> ${m.campaignId} (${m.kind}, ${m.score.toFixed(2)})`);
    this.opts.onCandidate?.(record);
  }
}

export interface BackfillOptions {
  watcher: CtWatcher;
  patterns: string[];
  /** Only certificates logged (or valid from) within this many days. */
  sinceDays: number;
  /** crt.sh identity search (searchCt with the shared cache). */
  search: (pattern: string) => Promise<CtResult | null>;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface BackfillResult {
  patterns: Array<{ pattern: string; status: "ok" | "unavailable" | "error"; certificates: number; recent: number; error?: string }>;
  candidates: number;
}

/** Backfill: recent certificates for crt.sh patterns go through the same watcher (matching, dedupe, feed). */
export async function runBackfill(opts: BackfillOptions): Promise<BackfillResult> {
  const since = (opts.now?.() ?? new Date()).getTime() - opts.sinceDays * 86_400_000;
  const before = opts.watcher.stats.candidates;
  const out: BackfillResult = { patterns: [], candidates: 0 };
  for (const pattern of opts.patterns) {
    let res: CtResult | null;
    try {
      res = await opts.search(pattern);
    } catch (e) {
      out.patterns.push({ pattern, status: "error", certificates: 0, recent: 0, error: (e as Error).message });
      opts.log?.(`[ct] ${pattern}: ${(e as Error).message}`);
      continue;
    }
    if (!res) {
      out.patterns.push({ pattern, status: "unavailable", certificates: 0, recent: 0 });
      opts.log?.(`[ct] crt.sh nie odpowiedział dla wzorca ${pattern}`);
      continue;
    }
    const recent = res.certs.filter((c) => {
      const t = Date.parse(c.entryTimestamp ?? c.notBefore ?? "");
      return Number.isFinite(t) && t >= since;
    });
    for (const c of recent) {
      opts.watcher.handle(
        {
          domains: c.sanDomains,
          seenUtc: c.entryTimestamp,
          issuer: c.issuer,
          notBefore: c.notBefore,
          notAfter: c.notAfter,
          fingerprint: null,
          serial: c.serial,
          logName: "crt.sh",
          logUrl: `https://crt.sh/?id=${c.id}`,
          certIndex: null,
          updateType: null,
        },
        { crtshId: c.id },
      );
    }
    out.patterns.push({ pattern, status: "ok", certificates: res.certs.length, recent: recent.length });
  }
  await opts.watcher.flush();
  out.candidates = opts.watcher.stats.candidates - before;
  return out;
}
