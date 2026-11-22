"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { evaluateClustering } from "@/lib/graph/eval";
import { ENTITY_LABELS_PL, ENTITY_TYPES, isSimilarityEdge, type CampaignsFile, type EvidenceGraph } from "@/lib/graph/model";
import type { CampaignSummary } from "@/lib/pipeline/summary";
import AnalyzeForm from "./AnalyzeForm";
import ThresholdPreview from "./ThresholdPreview";
import CampaignList from "./CampaignList";
import ComparePanel from "./ComparePanel";
import { campaignHasPersona, personaOptions, validItemKey } from "./compare";
import CtFeedPanel, { useCtFeed } from "./CtFeedPanel";
import DetailsPanel from "./DetailsPanel";
import GraphCanvas from "./GraphCanvas";
import { reducedGraph } from "@/lib/viewer/reducedGraph";
import { buildIndex, reducedToElements, toElements, visibleNodes } from "./graphView";
import { TYPE_COLORS } from "./palette";
import { ReadHow } from "./Guide";

export interface ViewerProps {
  graph: EvidenceGraph;
  campaigns: CampaignsFile;
  summaries: Record<string, CampaignSummary>;
  /** Start in the reduced graph (campaigns and shared traces, materials folded) instead of the full one. */
  initialReduced?: boolean;
}

type Panel = "details" | "compare" | "analyze" | "ct" | "thresholds";

const PANELS: Array<{ id: Panel; label: string }> = [
  { id: "details", label: "Szczegóły" },
  { id: "compare", label: "Porównaj reklamy" },
  { id: "analyze", label: "Nowa reklama" },
  { id: "ct", label: "Nowe domeny" },
  { id: "thresholds", label: "Progi" },
];

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600 select-none">
      <input type="checkbox" className="accent-slate-900" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export default function Viewer({ graph, campaigns, summaries, initialReduced = false }: ViewerProps) {
  const idx = useMemo(() => buildIndex(graph, campaigns), [graph, campaigns]);
  const personas = useMemo(() => personaOptions(campaigns.campaigns), [campaigns]);
  // Deep links for demos: /?k=K01&n=item:c1-08, /?a=c1-01&b=c1-04 (comparison), /?p=adam-testowy (persona),
  // /?panel=ct (new domains from the CT watcher).
  // The link provides the default; once the user picks something, their choice wins (derived state, no effects).
  const params = useSearchParams();
  const linkK = params.get("k");
  const linkN = params.get("n");
  const linkA = validItemKey(idx, params.get("a"));
  const linkB = validItemKey(idx, params.get("b"));
  const linkP = params.get("p");
  const linkPanel = params.get("panel");
  const [campaignChoice, setCampaignId] = useState<string | null | undefined>(undefined);
  const [selectedChoice, setSelected] = useState<string | null | undefined>(undefined);
  const [pairChoice, setPairChoice] = useState<{ a: string | null; b: string | null } | undefined>(undefined);
  const [panelChoice, setPanel] = useState<Panel | undefined>(undefined);
  const [personaChoice, setPersonaChoice] = useState<string | null | undefined>(undefined);
  const campaignId =
    campaignChoice !== undefined ? campaignChoice : linkK && campaigns.campaigns.some((c) => c.id === linkK) ? linkK : null;
  const selected = selectedChoice !== undefined ? selectedChoice : linkN && idx.nodeById.has(linkN) ? linkN : null;
  const pair = pairChoice ?? { a: linkA, b: linkB };
  const panel: Panel = panelChoice ?? (linkPanel === "ct" ? "ct" : linkA || linkB ? "compare" : "details");
  const ctFeed = useCtFeed();
  const campaignIds = useMemo(() => new Set(campaigns.campaigns.map((c) => c.id)), [campaigns]);
  const personaId = personaChoice !== undefined ? personaChoice : linkP && personas.some((p) => p.id === linkP) ? linkP : null;
  const [colorBy, setColorBy] = useState<"type" | "campaign">("campaign");
  const [sharedOnly, setSharedOnly] = useState(true);
  const [hideSingletons, setHideSingletons] = useState(true);

  const visible = useMemo(
    () => visibleNodes(graph, campaigns, idx, { campaignId, sharedOnly, hideSingletons, personaId }),
    [graph, campaigns, idx, campaignId, sharedOnly, hideSingletons, personaId],
  );
  const [reduced, setReduced] = useState(initialReduced);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [seed, setSeed] = useState<string | null>(null);
  const reducedView = useMemo(() => (reduced ? reducedGraph(graph, campaigns.campaigns, { expanded, seed: seed ?? undefined }) : null), [reduced, graph, campaigns, expanded, seed]);
  const elements = useMemo(
    () => (reducedView ? reducedToElements(reducedView, idx.campaignIndex) : toElements(graph, idx, visible, colorBy)),
    [reducedView, graph, idx, visible, colorBy],
  );
  const similarityShown = useMemo(() => new Set(graph.edges.filter((e) => isSimilarityEdge(e.type)).map((e) => e.type)), [graph]);

  const evaluation = useMemo(() => {
    const truth: Record<string, string> = {};
    for (const n of graph.nodes) if (n.type === "item" && typeof n.data.label === "string" && n.data.label) truth[n.key] = n.data.label;
    return Object.keys(truth).length ? evaluateClustering(campaigns.assignments, truth) : null;
  }, [graph, campaigns]);

  const selectCampaign = (id: string | null) => {
    setCampaignId(id);
    setSelected(null);
  };

  /** Makes sure the given items are drawn: switches to their campaign, or lifts filters that hide them. */
  const reveal = (itemIds: string[]) => {
    if (itemIds.every((id) => visible.has(id))) return;
    const campOf = (id: string) => idx.nodeById.get(id)?.campaignId ?? null;
    const camps = new Set(itemIds.map(campOf));
    const only = camps.size === 1 ? [...camps][0] : null;
    if (only) {
      // A selected campaign shows all its members regardless of the persona/singleton filters.
      setCampaignId(only);
      return;
    }
    setCampaignId(null);
    if (personaId && itemIds.some((id) => !campaigns.campaigns.some((c) => c.id === campOf(id) && campaignHasPersona(c, personaId)))) setPersonaChoice(null);
    if (itemIds.some((id) => (idx.campaignIndex.get(campOf(id) ?? "")?.size ?? 1) < 2)) setHideSingletons(false);
  };

  /** Click in the graph: in the reduced view a campaign or a trace unfolds (second click folds it), a trace or a material is also shown in the details panel. */
  const onGraphClick = (id: string | null) => {
    if (reduced && id && (id.startsWith("campaign:") || reducedView?.nodes.some((n) => n.id === id && n.kind === "trace"))) {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      });
      if (id.startsWith("campaign:")) return;
    }
    selectNode(id);
  };

  /** Selects a node (graph click or a link in a panel) and shows it in the details panel. */
  const selectNode = (id: string | null) => {
    setSelected(id);
    if (!id) return;
    const n = idx.nodeById.get(id);
    if (n?.type === "item") reveal([id]);
    if (panel !== "details") setPanel("details");
  };

  const setPair = (a: string | null, b: string | null) => {
    setPairChoice({ a, b });
    setPanel("compare");
    reveal([a, b].filter((x): x is string => !!x).map((k) => `item:${k}`));
  };

  /** Shift+click: the last two clicked ads become A and B. */
  const addToCompare = (nodeId: string) => {
    const n = idx.nodeById.get(nodeId);
    if (n?.type !== "item") {
      selectNode(nodeId);
      return;
    }
    const { a, b } = pair;
    if (n.key === a || n.key === b) setPanel("compare");
    else if (!a) setPair(n.key, b);
    else if (!b) setPair(a, n.key);
    else setPair(b, n.key);
  };

  const compareFrom = (a: string, b?: string) => setPair(a, b ?? (pair.b !== a ? pair.b : null));

  const selectPersona = (id: string | null) => {
    setPersonaChoice(id);
    if (id && campaignId && !campaigns.campaigns.some((c) => c.id === campaignId && campaignHasPersona(c, id))) setCampaignId(null);
  };

  const selectedNode = selected ? (idx.nodeById.get(selected) ?? null) : null;
  const multi = campaigns.campaigns.filter((c) => c.size > 1).length;
  const typesShown = ENTITY_TYPES.filter((t) => graph.stats.byType[t]);

  const markedIds = panel === "compare" ? [pair.a, pair.b].filter((x): x is string => !!x).map((k) => `item:${k}`) : [];
  const personaName = personaId ? personas.find((p) => p.id === personaId)?.name : null;

  return (
    <div className="flex min-h-screen flex-col md:h-screen">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <div>
          <h1 className="text-base font-semibold text-slate-900">Graf kampanii</h1>
          <p className="text-xs text-slate-500">
            {graph.stats.items} reklam · {multi} kampanii · {graph.stats.nodes - graph.stats.items} encji · tryb {graph.mode === "offline" ? "offline (fixtures)" : "live"} · podobieństwo tekstu: {graph.textMethod === "embedding" ? "embeddingi" : graph.textMethod === "tfidf" ? "TF-IDF" : "wyłączone"}
          </p>
          <div className="max-w-xl"><ReadHow id="graph" /></div>
        </div>
        {evaluation && (
          <div className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs text-emerald-900" title="Porównanie z kolumną etykiet (label) w danych">
            Ewaluacja na etykietach: F1 par <b>{evaluation.pairwise.f1.toFixed(3)}</b> · B³ F1 <b>{evaluation.bcubed.f1.toFixed(3)}</b> · ARI <b>{evaluation.ari.toFixed(3)}</b>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 md:ml-auto">
          <div className="flex overflow-hidden rounded-md border border-slate-300 text-xs" role="group" aria-label="Kolorowanie">
            <button type="button" onClick={() => setColorBy("campaign")} className={`px-2 py-1 ${colorBy === "campaign" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}>
              wg kampanii
            </button>
            <button type="button" onClick={() => setColorBy("type")} className={`px-2 py-1 ${colorBy === "type" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}>
              wg typu encji
            </button>
          </div>
          <div className="flex overflow-hidden rounded-md border border-slate-300 text-xs" role="group" aria-label="Widok grafu">
            <button type="button" aria-pressed={reduced} onClick={() => setReduced(true)} className={`px-2 py-1 ${reduced ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}>
              zredukowany
            </button>
            <button type="button" aria-pressed={!reduced} onClick={() => setReduced(false)} className={`px-2 py-1 ${!reduced ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}>
              pełny
            </button>
          </div>
          {reduced ? (
            <>
              {selected?.startsWith("item:") && seed !== idx.nodeById.get(selected)?.key && (
                <button type="button" className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs" onClick={() => { setSeed(idx.nodeById.get(selected)?.key ?? null); setExpanded(new Set()); }}>
                  rozwijaj graf od materiału {idx.nodeById.get(selected)?.key}
                </button>
              )}
              {(seed || expanded.size > 0) && (
                <button type="button" className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs" onClick={() => { setSeed(null); setExpanded(new Set()); }}>
                  pokaż wszystkie kampanie
                </button>
              )}
            </>
          ) : (
            <>
              <Toggle checked={sharedOnly} onChange={setSharedOnly} label="tylko współdzielone encje" />
              <Toggle checked={hideSingletons} onChange={setHideSingletons} label="ukryj niepowiązane reklamy" />
            </>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="max-h-80 w-full overflow-y-auto border-b border-slate-200 bg-slate-50 p-3 md:max-h-none md:w-80 md:shrink-0 md:border-b-0 md:border-r">
          <CampaignList
            campaigns={campaigns.campaigns}
            families={campaigns.families ?? []}
            selected={campaignId}
            onSelect={selectCampaign}
            summaries={summaries}
            personaId={personaId}
            onPersonaChange={selectPersona}
          />
        </aside>

        <main className="relative h-[65vh] min-w-0 bg-white md:h-auto md:flex-1">
          <GraphCanvas elements={elements} selectedId={selected} onSelect={onGraphClick} onShiftSelect={addToCompare} markedIds={markedIds} />
          <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[85%] flex-wrap gap-x-3 gap-y-1 rounded-md bg-white/90 px-2 py-1 text-[10px] text-slate-600 shadow-sm md:max-w-[70%]">
            {typesShown.map((t) => (
              <span key={t} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ background: TYPE_COLORS[t] }} />
                {ENTITY_LABELS_PL[t]}
              </span>
            ))}
            <span className="flex items-center gap-1"><span className="inline-block w-4 border-t-2 border-dashed border-teal-600" /> podobny obraz</span>
            <span className="flex items-center gap-1"><span className="inline-block w-4 border-t-2 border-dashed border-indigo-500" /> podobny tekst</span>
            {similarityShown.has("similar_dom") && (
              <span className="flex items-center gap-1"><span className="inline-block w-4 border-t-2 border-dashed border-amber-600" /> ten sam szablon strony</span>
            )}
            {similarityShown.has("similar_audio") && (
              <span className="flex items-center gap-1"><span className="inline-block w-4 border-t-2 border-dotted border-fuchsia-600" /> ten sam podkład audio</span>
            )}
            {similarityShown.has("similar_voice") && (
              <span className="flex items-center gap-1"><span className="inline-block w-4 border-t-2 border-dotted border-teal-600" /> ten sam głos mówcy</span>
            )}
            {markedIds.length > 0 && (
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm border-2 border-violet-600" /> porównywane reklamy</span>
            )}
          </div>
          <div className="absolute right-2 top-2 rounded bg-white/90 px-2 py-0.5 text-[11px] text-slate-500 shadow-sm">
            {reducedView
              ? `Widok zredukowany${seed ? ` od materiału ${seed}` : ""} · ${reducedView.nodes.length} węzłów · kliknij kampanię albo ślad, żeby rozwinąć`
              : `${campaignId ? `Kampania ${campaignId}` : personaName ? `Kampanie z personą ${personaName}` : "Wszystkie kampanie"} · ${visible.size} węzłów`}
          </div>
        </main>

        <aside className="w-full overflow-y-auto border-t border-slate-200 bg-white md:w-96 md:shrink-0 md:border-l md:border-t-0">
          <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-white text-xs" role="tablist" aria-label="Panel boczny">
            {PANELS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={panel === p.id}
                onClick={() => setPanel(p.id)}
                className={`flex-1 px-2 py-2 ${panel === p.id ? "border-b-2 border-slate-900 font-semibold text-slate-900" : "text-slate-500 hover:text-slate-800"}`}
              >
                {p.label}
                {p.id === "ct" && ctFeed.records.length > 0 && (
                  <span className="ml-1 rounded-full bg-rose-600 px-1.5 text-[10px] font-semibold text-white" aria-label={`${ctFeed.records.length} kandydatów`}>
                    {ctFeed.records.length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="p-4">
            {panel === "ct" ? (
              <CtFeedPanel state={ctFeed} campaignIds={campaignIds} onSelectCampaign={(id) => selectCampaign(id)} />
            ) : panel === "thresholds" ? (
              <ThresholdPreview />
            ) : panel === "analyze" ? (
              <AnalyzeForm onSelectCampaign={(id) => selectCampaign(id)} />
            ) : panel === "compare" ? (
              <ComparePanel graph={graph} idx={idx} minLinkScore={campaigns.method.minLinkScore} a={pair.a} b={pair.b} onChange={setPair} onSelect={selectNode} />
            ) : (
              <DetailsPanel node={selectedNode} idx={idx} onSelect={selectNode} onCompare={compareFrom} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
