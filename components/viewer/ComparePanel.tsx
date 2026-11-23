"use client";

import { useMemo, useState } from "react";
import { DEFAULT_LINK_CONFIG } from "@/lib/graph/config";
import { explain } from "@/lib/graph/explain";
import { familyShares, markShared } from "@/lib/viewer/compareView";
import { nodeTypeLabel } from "@/lib/viewer/fields";
import { FAMILY_LABEL } from "@/lib/viewer/families";
import { ENTITY_LABELS_PL, type EvidenceGraph, type GraphNode, type PairEvidence } from "@/lib/graph/model";
import { itemOptions, pairLink, sharedEntities, similarityLabel, weightFormula, weightPartsOf, type ItemOption } from "./compare";
import { pathLabel, type GraphIndex } from "./graphView";
import { HowComputedLink, ReadHow } from "./Guide";

export interface ComparePanelProps {
  graph: EvidenceGraph;
  idx: GraphIndex;
  /** Minimum link score used by the clustering run (campaigns.json method). */
  minLinkScore: number;
  a: string | null;
  b: string | null;
  onChange: (a: string | null, b: string | null) => void;
  /** Show a node in the details panel. */
  onSelect: (nodeId: string) => void;
}

function ItemPicker({ label, value, options, onChange }: { label: string; value: string | null; options: ItemOption[]; onChange: (key: string | null) => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.campaignId ?? "").toLowerCase() === q) : options;
  // Keep the current choice selectable even when the search hides it.
  const shown = value && !filtered.some((o) => o.key === value) ? [...options.filter((o) => o.key === value), ...filtered] : filtered;
  const groups = new Map<string, ItemOption[]>();
  for (const o of shown) {
    const g = o.campaignId ?? "—";
    const list = groups.get(g) ?? [];
    list.push(o);
    groups.set(g, list);
  }
  return (
    <div className="min-w-0 flex-1 space-y-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="search: id, advertiser, K01"
        aria-label={`Search ${label}`}
        className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
      />
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label={label}
        className="w-full rounded-md border border-slate-300 bg-white px-1.5 py-1 font-mono text-xs"
      >
        <option value="">— choose —</option>
        {[...groups.entries()].map(([g, list]) => (
          <optgroup key={g} label={`Campaign ${g}`}>
            {list.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {q && filtered.length === 0 && <p className="text-[11px] text-slate-500">No ads match “{query}”.</p>}
    </div>
  );
}

function Discounts({ node }: { node: GraphNode | undefined }) {
  if (!node || node.discounts.length === 0) return null;
  return (
    <ul className="mt-0.5 list-disc pl-4 text-[10px] text-amber-700">
      {node.discounts.map((d) => (
        <li key={d.rule}>
          discounted: {d.reason} (×{d.factor})
        </li>
      ))}
    </ul>
  );
}

function EvidenceRow({ ev, idx, onSelect }: { ev: PairEvidence; idx: GraphIndex; onSelect: (id: string) => void }) {
  const pivot = ev.pivot ? idx.nodeById.get(ev.pivot) : undefined;
  const parts = pivot ? weightPartsOf(pivot) : null;
  const kind = ev.kind === "similarity" ? similarityLabel(ev.edgeType) : ev.pivotType ? ENTITY_LABELS_PL[ev.pivotType] : "evidence";
  return (
    <li className="rounded-md border border-slate-200 p-2 text-xs leading-snug">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{kind}</span>
        <span className="ml-auto text-[10px] tabular-nums text-slate-500">
          weight {ev.weight.toFixed(3)}
          {ev.strong ? <span className="ml-1 rounded bg-slate-900 px-1 text-white">strong</span> : null}
          {ev.discounted ? <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">discounted</span> : null}
        </span>
      </div>
      <p className={ev.strong ? "font-semibold text-slate-900" : ev.discounted ? "text-slate-500" : "text-slate-800"}>{ev.evidence}</p>
      {pivot && (
        <button type="button" onClick={() => onSelect(pivot.id)} className="mt-0.5 max-w-full truncate text-left font-mono text-[10px] text-blue-700 hover:underline" title="Show entity">
          {pivot.label} · {pivot.df} {pivot.df === 1 ? "ad" : "ads"}
        </button>
      )}
      {parts && <div className="text-[10px] text-slate-500">entity weight {pivot?.weight?.toFixed(3)} = {weightFormula(parts)}</div>}
      <Discounts node={pivot} />
      {ev.kind === "pivot" && ev.pathA.length > 0 && (
        <div className="mt-0.5 font-mono text-[10px] text-slate-400" title="Evidence path in the graph">
          {pathLabel(idx, ev.pathA)} ⟷ {pathLabel(idx, ev.pathB.slice(0, -1).reverse())}
        </div>
      )}
    </li>
  );
}

export default function ComparePanel({ graph, idx, minLinkScore, a, b, onChange, onSelect }: ComparePanelProps) {
  const options = useMemo(() => itemOptions(idx), [idx]);
  const ready = a !== null && b !== null && a !== b;
  const result = useMemo(() => {
    if (!a || !b || a === b) return null;
    const ex = explain(graph, a, b, { ...DEFAULT_LINK_CONFIG, minLinkScore });
    const link = pairLink(idx, a, b);
    return { ex, link, shared: sharedEntities(idx, a, b, ex.direct) };
  }, [graph, idx, a, b, minLinkScore]);
  const [copied, setCopied] = useState(false);
  const campaignOf = (key: string) => idx.nodeById.get(`item:${key}`)?.campaignId ?? null;

  const copyLink = async () => {
    if (!a || !b) return;
    const url = `${window.location.origin}${window.location.pathname}?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Link to this comparison:", url);
    }
  };

  const itemButton = (key: string) => (
    <button type="button" onClick={() => onSelect(`item:${key}`)} className="font-mono font-semibold text-blue-700 hover:underline">
      {key}
    </button>
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Compare two ads</h2>
        <p className="mt-0.5 text-xs text-slate-500">Why two ads are (or are not) in the same campaign. Choose the ads below or Shift-click ads in the graph.</p>
        <ReadHow id="compare" />
        <HowComputedLink />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <ItemPicker label="Ad A" value={a} options={options} onChange={(k) => onChange(k, b)} />
        <ItemPicker label="Ad B" value={b} options={options} onChange={(k) => onChange(a, k)} />
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <button type="button" onClick={() => onChange(b, a)} disabled={!a && !b} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:border-slate-500 disabled:opacity-40">
          ⇄ Swap
        </button>
        <button type="button" onClick={() => onChange(null, null)} disabled={!a && !b} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:border-slate-500 disabled:opacity-40">
          Clear
        </button>
        <button type="button" onClick={() => void copyLink()} disabled={!ready} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:border-slate-500 disabled:opacity-40">
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>

      {a && b && a === b && <p className="text-xs text-amber-700">Choose two different ads.</p>}
      {!ready && !(a && b) && <p className="text-xs text-slate-500">Choose both ads to see the evidence.</p>}

      {result && a && b && (
        <>
          <div className={`rounded-md p-2.5 text-sm ${result.ex.sameCampaign ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
            <div className="font-semibold">
              {result.ex.sameCampaign ? `Same campaign ${campaignOf(a) ?? ""}` : `Different campaigns: ${campaignOf(a) ?? "—"} and ${campaignOf(b) ?? "—"}`}
            </div>
            <p className="mt-0.5 text-xs">{result.ex.summary}</p>
          </div>

          {result.link && familyShares(result.link.evidence).length > 0 && (
            <section aria-label="What the score is made of">
              <h3 className="text-sm font-semibold text-slate-900">What the score is made of</h3>
              <div className="mt-1 flex h-4 w-full overflow-hidden rounded bg-slate-100" role="img" aria-label={familyShares(result.link.evidence).map((f) => `${FAMILY_LABEL[f.family]} ${f.percent}%`).join(", ")}>
                {familyShares(result.link.evidence).map((f, i) => (
                  <span key={f.family} className={["bg-slate-900", "bg-slate-600", "bg-slate-400", "bg-slate-300"][Math.min(i, 3)]} style={{ width: `${f.percent}%` }} title={`${FAMILY_LABEL[f.family]}: ${f.percent}%`} />
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-700">{familyShares(result.link.evidence).map((f) => `${FAMILY_LABEL[f.family]} ${f.percent}%`).join(" · ")}</p>
            </section>
          )}

          {(() => {
            const ta = idx.nodeById.get(`item:${a}`)?.data.text;
            const tb = idx.nodeById.get(`item:${b}`)?.data.text;
            if (typeof ta !== "string" || typeof tb !== "string") return null;
            const marked = markShared(ta, tb);
            if (![...marked.a, ...marked.b].some((seg) => seg.shared)) return null;
            return (
              <section aria-label="Shared text">
                <h3 className="text-sm font-semibold text-slate-900">Shared text</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">Highlighted: runs of at least four words that both ads contain.</p>
                <div className="mt-1 grid gap-2 sm:grid-cols-2">
                  {[{ key: a, segs: marked.a }, { key: b, segs: marked.b }].map(({ key, segs }) => (
                    <p key={key} className="rounded border border-slate-200 bg-white p-2 text-xs leading-relaxed">
                      <span className="mb-0.5 block font-mono text-[10px] text-slate-500">{key}</span>
                      {segs.map((seg, i) => (seg.shared ? <mark key={i} className="rounded bg-amber-200 px-0.5 text-slate-900">{seg.text}</mark> : <span key={i}>{seg.text}</span>))}
                    </p>
                  ))}
                </div>
              </section>
            );
          })()}

          <section>
            <h3 className="text-sm font-semibold text-slate-900">
              Direct link {itemButton(a)} ⟷ {itemButton(b)}
            </h3>
            {result.link ? (
              <>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-600">
                  <span className="h-1.5 w-24 overflow-hidden rounded bg-slate-200" title={`score ${result.link.score.toFixed(2)}`}>
                    <span className="block h-full bg-slate-800" style={{ width: `${Math.round(result.link.score * 100)}%` }} />
                  </span>
                  <span className="tabular-nums">score {result.link.score.toFixed(2)}</span>
                  {result.link.strong ? (
                    <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-white">strong link</span>
                  ) : result.link.score < minLinkScore ? (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">below threshold {minLinkScore}</span>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">The score combines evidence as a “noisy-OR”: 1 − Π(1 − weight). Each piece of evidence: entity weight × relation (e.g. ×0.4 for an outgoing link).</p>
                <ul className="mt-2 space-y-2">
                  {result.link.evidence.map((ev, i) => (
                    <EvidenceRow key={`${ev.pivot ?? ev.edgeType}-${i}`} ev={ev} idx={idx} onSelect={onSelect} />
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                No direct link is stored. graph.json keeps up to 12 strongest links of each ad, and links with a score below 0.05 (without strong evidence) are dropped.
              </p>
            )}
          </section>

          {result.ex.path.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-slate-900">Strongest path through other ads</h3>
              <p className="mt-0.5 text-[11px] text-slate-500">Chain of links with the highest product of scores (only strong links or ≥ {minLinkScore}).</p>
              <ol className="mt-2 space-y-2">
                {result.ex.path.map((step) => (
                  <li key={`${step.from}-${step.to}`} className="rounded-md border border-slate-200 p-2 text-xs">
                    <div className="flex items-center gap-2">
                      {itemButton(step.from)} → {itemButton(step.to)}
                      <span className="ml-auto tabular-nums text-slate-500">score {step.score.toFixed(2)}</span>
                    </div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-700">
                      {step.evidence.map((ev, i) => (
                        <li key={i}>{ev.evidence}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section>
            <h3 className="text-sm font-semibold text-slate-900">Shared entities ({result.shared.length})</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Everything both ads lead to, discounted entities included. Those explain why the ads were not linked (e.g. a public form service, a CDN, a popular library).
            </p>
            {result.shared.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">The ads share no entities.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {result.shared.slice(0, 15).map(({ node, inDirect }) => (
                  <li key={node.id} className="rounded border border-slate-100 px-2 py-1 text-xs">
                    <div className="flex items-baseline gap-2">
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-500">{nodeTypeLabel(node)}</span>
                      <button type="button" onClick={() => onSelect(node.id)} className={`min-w-0 truncate text-left hover:underline ${node.discounts.length ? "text-slate-500" : "text-slate-900"}`} title={node.key}>
                        {node.label}
                      </button>
                      <span className="ml-auto shrink-0 text-[10px] tabular-nums text-slate-500">
                        {node.weight !== null ? `weight ${node.weight.toFixed(3)}` : "—"} · {node.df} {node.df === 1 ? "ad" : "ads"}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {node.strong && <span className="rounded bg-slate-900 px-1 text-[10px] text-white">strong</span>}
                      {inDirect && <span className="rounded bg-blue-50 px-1 text-[10px] text-blue-800">in evidence</span>}
                    </div>
                    <Discounts node={node} />
                  </li>
                ))}
              </ul>
            )}
            {result.shared.length > 15 && <p className="mt-1 text-[11px] text-slate-500">…and {result.shared.length - 15} more (sorted strongest first).</p>}
          </section>
        </>
      )}
    </div>
  );
}
