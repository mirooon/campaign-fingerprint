"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { CampaignsFile, EvidenceGraph, NearMissesFile } from "@/lib/graph/model";
import type { CampaignSummary } from "@/lib/pipeline/summary";
import { baseCounts } from "@/lib/viewer/campaignView";
import { fmtDate, count, MATERIAL, CAMPAIGN, GROUP, SINGLE_MATERIAL } from "@/lib/viewer/format";
import type { SingleRule } from "@/lib/viewer/nearMissView";
import AnalyzeView from "./AnalyzeView";
import CampaignsView from "./CampaignsView";
import ComparePanel from "./ComparePanel";
import { validItemKey } from "./compare";
import CtFeedPanel, { useCtFeed } from "./CtFeedPanel";
import { buildIndex } from "./graphView";
import HowItWorks from "./HowItWorks";
import NearMissesView from "./NearMissesView";
import QualityView from "./QualityView";
import RecognizedView from "./RecognizedView";
import { Empty, Help, StrengthLegend, SyntheticBadge } from "./ui";
import Viewer from "./Viewer";

export interface ShellProps {
  graph: EvidenceGraph;
  campaigns: CampaignsFile;
  /** Pairs kept apart on purpose; null when the run has no `near-misses.json`. */
  nearMisses: NearMissesFile | null;
  /** Rules computed on the server for materials left alone whose pair `near-misses.json` cut (key: the material). */
  singleRules?: Record<string, SingleRule>;
  summaries: Record<string, CampaignSummary>;
  /** The comparison base is the bundled sample: every result screen carries the "synthetic data" label. */
  synthetic: boolean;
  /** The server runs with ANALYZE_OFFLINE=1: the analysis never looks domains up, so the form locks that option off. */
  serverOffline: boolean;
}

type Tab = "analyze" | "campaigns" | "graph" | "compare" | "apart" | "how" | "ct" | "people" | "quality" | "expert";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "analyze", label: "Analyze sample" },
  { id: "campaigns", label: "Campaigns" },
  { id: "graph", label: "Link graph" },
  { id: "compare", label: "Compare" },
  { id: "apart", label: "Deliberately not linked" },
  { id: "how", label: "How it works" },
  { id: "ct", label: "New domains" },
  { id: "people", label: "Recognized people" },
  { id: "quality", label: "Data quality" },
];

/** Tab of the address: `?tab=`, or the one an old link implies (?a=&b= → Compare, ?k= → Campaigns, ?panel=ct → New domains, ?n= / ?p= → graph). */
function tabFromParams(p: URLSearchParams): Tab {
  const t = p.get("tab");
  if (t && [...TABS.map((x) => x.id), "expert"].includes(t)) return t as Tab;
  if (p.get("a") || p.get("b")) return "compare";
  if (p.get("panel") === "ct") return "ct";
  if (p.get("k")) return "campaigns";
  if (p.get("n") || p.get("p")) return "graph";
  return "analyze";
}

/** Tabs of the simple view (B-034); the expert view shows every tab and the expert graph. */
const SIMPLE_TABS: ReadonlySet<Tab> = new Set(["analyze", "campaigns", "compare", "how"]);
type ViewMode = "simple" | "expert";
const VIEW_KEY = "widok";

const viewListeners = new Set<() => void>();

/** Reads the remembered view mode; storage may be unavailable (then the expert view). */
function readViewMode(): ViewMode {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "simple" ? "simple" : "expert";
  } catch {
    return "expert";
  }
}

/** Subscribes to changes of the view mode (this tab and other tabs). */
function subscribeViewMode(cb: () => void): () => void {
  viewListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    viewListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** View mode remembered in this browser (a convenience): the expert view on the server and without storage. */
function useViewMode(): [ViewMode, (m: ViewMode) => void] {
  const mode = useSyncExternalStore(subscribeViewMode, readViewMode, () => "expert" as ViewMode);
  /** Remembers the mode and tells the subscribers. */
  const set = (m: ViewMode) => {
    try {
      window.localStorage.setItem(VIEW_KEY, m);
    } catch {
      /* storage unavailable: nothing to remember */
    }
    for (const cb of viewListeners) cb();
  };
  return [mode, set];
}

/** Application frame: header with the base summary, tabs, and the view of the chosen tab; state lives in the address (`?tab=`, `?job=`, `?a=&b=`, `?k=`). */
export default function Shell({ graph, campaigns, nearMisses, singleRules, summaries, synthetic, serverOffline }: ShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const idx = useMemo(() => buildIndex(graph, campaigns), [graph, campaigns]);
  const ctFeed = useCtFeed();
  const tab = tabFromParams(params);
  const [viewMode, setViewMode] = useViewMode();
  const visibleTabs = TABS.filter((t) => viewMode === "expert" || SIMPLE_TABS.has(t.id) || t.id === tab);
  const jobId = params.get("job");
  const a = validItemKey(idx, params.get("a"));
  const b = validItemKey(idx, params.get("b"));

  const go = useCallback(
    (changes: Record<string, string | null>, opts: { keep?: string[] } = {}) => {
      const next = new URLSearchParams();
      for (const k of opts.keep ?? []) {
        const v = params.get(k);
        if (v) next.set(k, v);
      }
      for (const [k, v] of Object.entries(changes)) if (v) next.set(k, v);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const counts = useMemo(() => baseCounts(campaigns.campaigns, campaigns.families ?? []), [campaigns]);
  const itemCount = graph.stats.items;
  const isExpert = tab === "expert" || tab === "graph";

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <h1 className="text-lg font-semibold">Campaign analysis</h1>
          <p className="text-sm text-slate-600">
            Reference base<Help term="baza" />: {count(itemCount, MATERIAL)} · {count(counts.campaigns, CAMPAIGN)} · <span title={`A sample not linked to any campaign gets its own K number, so K numbers go higher than the number of campaigns. Inside similar-campaign group frames: ${counts.singlesInFamilies}; in the collapsed section of the Campaigns tab: ${counts.singles - counts.singlesInFamilies}.`}>{count(counts.singles, SINGLE_MATERIAL)}</span> · {count(counts.families, GROUP)} · {graph.mode === "offline" ? "offline" : "online"} · data from {fmtDate(campaigns.generatedAt)}
          </p>
          {synthetic && <SyntheticBadge />}
          <nav className="ml-auto flex gap-3 text-sm" aria-label="Help and expert mode">
            <button type="button" className="underline" onClick={() => go({ tab: "how" })}>Glossary</button>
            <span className="inline-flex items-center gap-1" role="group" aria-label="View">
              View:
              <button type="button" aria-pressed={viewMode === "simple"} className={`rounded px-1.5 ${viewMode === "simple" ? "bg-slate-900 text-white" : "underline"}`} onClick={() => setViewMode("simple")}>simple</button>
              <span aria-hidden>/</span>
              <button type="button" aria-pressed={viewMode === "expert"} className={`rounded px-1.5 ${viewMode === "expert" ? "bg-slate-900 text-white" : "underline"}`} onClick={() => setViewMode("expert")}>expert</button>
            </span>
            {viewMode === "expert" && <button type="button" className={`underline ${tab === "expert" ? "font-semibold" : ""}`} onClick={() => go({ tab: "expert" })}>Expert mode</button>}
          </nav>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1" role="tablist" aria-label="Views">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => go({ tab: t.id }, { keep: t.id === "analyze" ? ["job"] : [] })}
              className={`rounded-t-md px-3 py-1.5 text-sm ${tab === t.id ? "border-b-2 border-slate-900 font-semibold" : "text-slate-600 hover:text-slate-900"}`}
            >
              {t.label}
              {t.id === "ct" && ctFeed.records.length > 0 && <span className="ml-1 rounded-full bg-slate-800 px-1.5 text-[10px] text-white">{ctFeed.records.length}</span>}
            </button>
          ))}
        </div>
      </header>

      <main className="min-h-0 flex-1">
        {tab === "analyze" && (
          <AnalyzeView
            campaigns={campaigns.campaigns}
            minLinkScore={campaigns.method.minLinkScore}
            rules={campaigns.method.rules ?? []}
            syntheticBase={synthetic}
            serverOffline={serverOffline}
            jobId={jobId}
            onJob={(id) => go(id ? { tab: "analyze", job: id } : { tab: "analyze" })}
            onShowCampaign={(id) => go({ tab: "campaigns", k: id })}
            onCompare={(x, y) => go({ tab: "compare", a: validItemKey(idx, x), b: validItemKey(idx, y) })}
          />
        )}
        {tab === "campaigns" && (
          <CampaignsView campaigns={campaigns} graph={graph} nearMisses={nearMisses} singleRules={singleRules} ctRecords={ctFeed.records} openId={params.get("k")} onOpen={(id) => go({ tab: "campaigns", k: id })} onCompare={(x, y) => go({ tab: "compare", a: x, b: y })} />
        )}
        {tab === "compare" && (
          <div className="mx-auto max-w-3xl space-y-3 p-4">
            <h2 className="text-xl font-semibold">What links these two samples?</h2>
            {!a && !b && <Empty>Choose two samples from the lists below or use “Compare” on a campaign card.</Empty>}
            <StrengthLegend />
            <ComparePanel
              graph={graph}
              idx={idx}
              minLinkScore={campaigns.method.minLinkScore}
              a={a}
              b={b}
              onChange={(x, y) => go({ tab: "compare", a: x, b: y })}
              onSelect={(id) => go({ tab: "expert", n: id })}
            />
          </div>
        )}
        {tab === "apart" && <NearMissesView file={nearMisses} onCompare={(x, y) => go({ tab: "compare", a: validItemKey(idx, x), b: validItemKey(idx, y) })} />}
        {tab === "people" && <RecognizedView />}
        {tab === "quality" && <QualityView />}
        {tab === "how" && <HowItWorks rules={campaigns.method.rules ?? []} method={campaigns.method} />}
        {tab === "ct" && (
          <div className="mx-auto max-w-3xl space-y-3 p-4">
            <h2 className="text-xl font-semibold">Which new domains match known campaigns?</h2>
            <p className="text-sm text-slate-700">Every HTTPS certificate goes into a public log. We catch domains that match the patterns of known campaigns, often before the ad goes live.</p>
            <CtFeedPanel state={ctFeed} campaignIds={new Set(campaigns.campaigns.map((c) => c.id))} onSelectCampaign={(id) => go({ tab: "campaigns", k: id })} />
          </div>
        )}
        {isExpert && (
          <div className="md:[&>div]:h-[calc(100vh-6.5rem)] [&>div]:min-h-0">
            <Viewer key={tab} graph={graph} campaigns={campaigns} summaries={summaries} initialReduced={tab === "graph"} />
          </div>
        )}
      </main>
    </div>
  );
}
