/**
 * Rows of watch.jsonl as records of the CT feed, so the existing "feed CT" tab shows what the scheduler found
 * without a new component. Pure; the route (`app/api/ct-feed`) reads the files.
 */
import { CANDIDATE_NOTE } from "../ct/watch";
import type { CtFeedRecord } from "../ct/feed";
import type { WatchRow } from "./schedule";

/**
 * The feed record of a row, or null when the row has nothing for a campaign feed: no campaign and no confirmations,
 * a failed analysis, or an address that is not a URL. A row with confirmations is `confirmed`, otherwise a candidate.
 */
export function watchRowToFeedRecord(row: WatchRow): CtFeedRecord | null {
  if (row.verdict === "error" || (!row.campaign && !row.confirmations?.length)) return null;
  let host: string;
  try {
    host = new URL(row.url).hostname;
  } catch {
    return null;
  }
  return {
    v: 1,
    type: "ct_candidate",
    observed_utc: row.ts,
    source: "watch",
    stream: row.url,
    domain: host,
    names: [host],
    cert: { issuer: null, not_before: null, not_after: null, fingerprint: null, serial: null, log: null, log_url: null, cert_index: null, crtsh_id: null, seen_utc: null },
    candidate: {
      campaign_id: row.campaign ?? "",
      campaign_label: "",
      score: row.verdict === "known_campaign" ? 1 : 0.5,
      kind: "watch",
      template: null,
      similar_domains: [],
      tokens: [],
      evidence: [`źródło: ${row.source}${row.recipe ? `, przepis: ${row.recipe}` : ""}`, `werdykt analizy: ${row.verdict}`, ...(row.confirmations ?? [])],
      ...(row.confirmations?.length ? { confirmations: row.confirmations } : {}),
    },
    enrichment: null,
    status: row.confirmations?.length ? "confirmed" : "candidate",
    note: CANDIDATE_NOTE,
  };
}

/** The CT feed and the scheduler's rows in one list, newest first, at most `limit`. */
export function mergeFeeds(ct: CtFeedRecord[], rows: WatchRow[], limit: number): CtFeedRecord[] {
  const fromRows = rows.map(watchRowToFeedRecord).filter((r): r is CtFeedRecord => r !== null);
  return [...ct, ...fromRows].sort((a, b) => b.observed_utc.localeCompare(a.observed_utc)).slice(0, limit);
}
