"use client";

import { useEffect, useState } from "react";
import type { CtFeedRecord } from "@/lib/ct/feed";
import { MATCH_KIND_LABELS } from "@/lib/ct/labels";

export interface CtFeedState {
  records: CtFeedRecord[];
  feed: string | null;
  updatedAt: string | null;
  error: string | null;
  loading: boolean;
}

/** Polls /api/ct-feed (the CT watcher's JSONL feed); an empty or missing feed is a normal state. */
export function useCtFeed(intervalMs = 15_000): CtFeedState {
  const [state, setState] = useState<CtFeedState>({ records: [], feed: null, updatedAt: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/ct-feed?limit=100", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { records?: CtFeedRecord[]; feed?: string; updatedAt?: string; error?: string };
        if (alive) setState({ records: json.records ?? [], feed: json.feed ?? null, updatedAt: json.updatedAt ?? null, error: json.error ?? null, loading: false });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, loading: false, error: `could not read /api/ct-feed (${(e as Error).message})` }));
      }
    };
    void load();
    const timer = setInterval(() => void load(), intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [intervalMs]);
  return state;
}

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "medium" }) : "—");

function Candidate({ r, known, onSelectCampaign }: { r: CtFeedRecord; known: boolean; onSelectCampaign: (id: string) => void }) {
  const e = r.enrichment;
  const c = r.candidate;
  return (
    <li className="rounded-md border border-slate-200 p-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="break-all font-mono text-[13px] font-semibold text-slate-900">{r.domain}</span>
        <button
          type="button"
          disabled={!known}
          onClick={() => onSelectCampaign(c.campaign_id)}
          className="rounded bg-slate-900 px-1.5 py-0.5 text-[11px] text-white disabled:bg-slate-400"
          title={known ? "Show the campaign in the graph" : "The campaign is not in the current graph"}
        >
          {c.campaign_id}
        </button>
        <span className="text-[11px] text-slate-600">{Math.round(c.score * 100)}%</span>
      </div>
      <p className="mt-1 text-xs text-slate-700">{MATCH_KIND_LABELS[c.kind] ?? c.kind}</p>
      <ul className="mt-1 list-disc pl-4 text-[11px] text-slate-600">
        {c.evidence.map((ev) => (
          <li key={ev}>{ev}</li>
        ))}
      </ul>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
        <dt className="text-slate-400">observed</dt>
        <dd>
          {time(r.observed_utc)} · {r.source === "certstream" ? "CT stream" : r.source === "crtsh-backfill" ? "crt.sh (backfill)" : r.source === "watch" ? "scan schedule" : "replay (demo)"}
        </dd>
        {(r.cert.issuer || r.cert.log) && (
          <>
            <dt className="text-slate-400">certificate</dt>
            <dd className="break-words">
              {[r.cert.issuer, r.cert.log, r.cert.not_before ? `from ${time(r.cert.not_before)}` : null].filter(Boolean).join(" · ")}
            </dd>
          </>
        )}
        {r.names.length > 1 && (
          <>
            <dt className="text-slate-400">names</dt>
            <dd className="break-all font-mono">{r.names.join(", ")}</dd>
          </>
        )}
        {e?.dns && (e.dns.a.length > 0 || e.dns.cname.length > 0 || e.dns.ns.length > 0) && (
          <>
            <dt className="text-slate-400">DNS</dt>
            <dd className="break-all font-mono">{[...e.dns.cname.map((x) => `CNAME ${x}`), ...e.dns.a.map((x) => `A ${x}`), ...e.dns.ns.map((x) => `NS ${x}`)].slice(0, 6).join(" · ")}</dd>
          </>
        )}
        {e?.rdap && (
          <>
            <dt className="text-slate-400">RDAP</dt>
            <dd>{[e.rdap.registrar, e.rdap.created ? `created ${time(e.rdap.created)}` : null].filter(Boolean).join(" · ") || "—"}</dd>
          </>
        )}
        {e?.page && (
          <>
            <dt className="text-slate-400">page</dt>
            <dd className="break-all">{e.page.error ? `error: ${e.page.error}` : `${e.page.status ?? "?"} ${e.page.final_url ?? ""}${e.page.title ? ` — “${e.page.title}”` : ""}`}</dd>
          </>
        )}
        {e?.skipped && (
          <>
            <dt className="text-slate-400">enrichment</dt>
            <dd>skipped ({e.skipped})</dd>
          </>
        )}
      </dl>
    </li>
  );
}

export default function CtFeedPanel({ state, campaignIds, onSelectCampaign }: { state: CtFeedState; campaignIds: Set<string>; onSelectCampaign: (id: string) => void }) {
  const { records, loading, error, updatedAt, feed } = state;
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">New domains matched to campaigns</h2>
        <p className="mt-1 text-xs text-slate-600">
          New TLS certificates from Certificate Transparency compared with campaign fingerprints (domain name templates, brands and media from the lexicon). A domain
          shows up here before the ad goes live. It is a candidate to check, not evidence.
        </p>
        <p className="mt-1 text-[11px] text-slate-400">
          {loading ? "loading…" : `refreshes every 15 s · last ${time(updatedAt)}`}
          {feed ? ` · ${feed}` : ""}
        </p>
      </div>
      {error && <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">{error}</p>}
      {!loading && records.length === 0 && !error && (
        <div className="rounded-md border border-dashed border-slate-300 p-3 text-xs text-slate-600">
          <p>No matches in the feed.</p>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
            <li>
              live: <code className="font-mono">docker compose --profile ct up -d certstream</code>, then <code className="font-mono">bun run ct:watch</code>
            </li>
            <li>
              from crt.sh history: <code className="font-mono">bun run ct:backfill</code>
            </li>
            <li>
              offline demo: <code className="font-mono">bun run ct:watch -- --replay data/sample/ct-stream.jsonl</code>
            </li>
          </ul>
        </div>
      )}
      {records.length > 0 && (
        <ul className="space-y-2">
          {records.map((r) => (
            <Candidate key={`${r.domain}|${r.observed_utc}`} r={r} known={campaignIds.has(r.candidate.campaign_id)} onSelectCampaign={onSelectCampaign} />
          ))}
        </ul>
      )}
    </div>
  );
}
