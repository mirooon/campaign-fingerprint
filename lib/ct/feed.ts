/**
 * Append-only JSONL feed of CT candidates (data/ct-watch.jsonl by default): one JSON object
 * per line, never rewritten. The viewer panel and /api/ct-feed read its tail.
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";
import type { CtMatchKind } from "./labels";

export const DEFAULT_FEED_FILE = "data/ct-watch.jsonl";

export interface CandidateEnrichment {
  dns: { a: string[]; aaaa: string[]; cname: string[]; ns: string[]; mx: string[] } | null;
  /** Extra hosts from the certificate (e.g. "lp.x.example") with their CNAME/A answers. */
  hosts: Array<{ host: string; a: string[]; cname: string[] }>;
  rdap: { registrar: string | null; created: string | null; expires: string | null; status: string[]; nameservers: string[] } | null;
  ct: { certificates: number; first_seen: string | null; issuers: string[] } | null;
  /** Only with an explicit flag (--fetch-page): one GET of https://<domain>/. */
  page: { url: string; status: number | null; final_url: string | null; title: string | null; body_sha256: string | null; error: string | null } | null;
  errors: string[];
  /** Why enrichment was skipped ("rate limit", "disabled"), when it was. */
  skipped: string | null;
}

export interface CtFeedRecord {
  v: 1;
  type: "ct_candidate";
  observed_utc: string;
  source: "certstream" | "crtsh-backfill" | "replay";
  /** Stream URL, crt.sh pattern or replay file. */
  stream: string | null;
  domain: string;
  /** Certificate names under this registrable domain. */
  names: string[];
  cert: {
    issuer: string | null;
    not_before: string | null;
    not_after: string | null;
    fingerprint: string | null;
    serial: string | null;
    log: string | null;
    log_url: string | null;
    cert_index: number | null;
    crtsh_id: string | null;
    seen_utc: string | null;
  };
  candidate: {
    campaign_id: string;
    campaign_label: string;
    score: number;
    kind: CtMatchKind;
    template: string | null;
    similar_domains: string[];
    tokens: string[];
    evidence: string[];
  };
  enrichment: CandidateEnrichment | null;
  status: "candidate";
  note: string;
}

export function appendFeed(file: string, record: CtFeedRecord): void {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

function parseLines(text: string): CtFeedRecord[] {
  const out: CtFeedRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as CtFeedRecord;
      if (r && r.type === "ct_candidate" && typeof r.domain === "string") out.push(r);
    } catch {
      /* a partial or corrupted line is skipped */
    }
  }
  return out;
}

/** Newest records first; reads at most `maxBytes` from the end of the file. Missing file: []. */
export function readFeedTail(file: string, limit = 50, maxBytes = 4 * 1024 * 1024): CtFeedRecord[] {
  if (!existsSync(file)) return [];
  const size = statSync(file).size;
  if (size === 0) return [];
  const start = Math.max(0, size - maxBytes);
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString("utf8");
    if (start > 0) text = text.slice(text.indexOf("\n") + 1); // drop the partial first line
    return parseLines(text).reverse().slice(0, Math.max(0, limit));
  } finally {
    closeSync(fd);
  }
}

/** Registrable domains already in the feed (so a restart does not report them again). */
export function feedDomains(file: string): Set<string> {
  if (!existsSync(file)) return new Set();
  return new Set(parseLines(readFileSync(file, "utf8")).map((r) => r.domain));
}
