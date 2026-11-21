"use client";

import { useMemo, useState } from "react";
import { DEFAULT_LINK_CONFIG } from "@/lib/graph/config";
import { explain } from "@/lib/graph/explain";
import { ENTITY_LABELS_PL, type EvidenceGraph, type GraphNode, type PairEvidence } from "@/lib/graph/model";
import { itemOptions, pairLink, sharedEntities, similarityLabel, weightFormula, weightPartsOf, type ItemOption } from "./compare";
import { pathLabel, type GraphIndex } from "./graphView";

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
        placeholder="szukaj: id, reklamodawca, K01"
        aria-label={`Szukaj reklamy ${label}`}
        className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
      />
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label={`Reklama ${label}`}
        className="w-full rounded-md border border-slate-300 bg-white px-1.5 py-1 font-mono text-xs"
      >
        <option value="">— wybierz —</option>
        {[...groups.entries()].map(([g, list]) => (
          <optgroup key={g} label={`Kampania ${g}`}>
            {list.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {q && filtered.length === 0 && <p className="text-[11px] text-slate-500">Brak reklam pasujących do „{query}”.</p>}
    </div>
  );
}

function Discounts({ node }: { node: GraphNode | undefined }) {
  if (!node || node.discounts.length === 0) return null;
  return (
    <ul className="mt-0.5 list-disc pl-4 text-[10px] text-amber-700">
      {node.discounts.map((d) => (
        <li key={d.rule}>
          zdyskontowane: {d.reason} (×{d.factor})
        </li>
      ))}
    </ul>
  );
}

function EvidenceRow({ ev, idx, onSelect }: { ev: PairEvidence; idx: GraphIndex; onSelect: (id: string) => void }) {
  const pivot = ev.pivot ? idx.nodeById.get(ev.pivot) : undefined;
  const parts = pivot ? weightPartsOf(pivot) : null;
  const kind = ev.kind === "similarity" ? similarityLabel(ev.edgeType) : ev.pivotType ? ENTITY_LABELS_PL[ev.pivotType] : "dowód";
  return (
    <li className="rounded-md border border-slate-200 p-2 text-xs leading-snug">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{kind}</span>
        <span className="ml-auto text-[10px] tabular-nums text-slate-500">
          waga {ev.weight.toFixed(3)}
          {ev.strong ? <span className="ml-1 rounded bg-slate-900 px-1 text-white">silny</span> : null}
          {ev.discounted ? <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">zdyskontowany</span> : null}
        </span>
      </div>
      <p className={ev.strong ? "font-semibold text-slate-900" : ev.discounted ? "text-slate-500" : "text-slate-800"}>{ev.evidence}</p>
      {pivot && (
        <button type="button" onClick={() => onSelect(pivot.id)} className="mt-0.5 max-w-full truncate text-left font-mono text-[10px] text-blue-700 hover:underline" title="Pokaż encję">
          {pivot.label} · {pivot.df} reklam
        </button>
      )}
      {parts && <div className="text-[10px] text-slate-500">waga encji {pivot?.weight?.toFixed(3)} = {weightFormula(parts)}</div>}
      <Discounts node={pivot} />
      {ev.kind === "pivot" && ev.pathA.length > 0 && (
        <div className="mt-0.5 font-mono text-[10px] text-slate-400" title="Ścieżka dowodu w grafie">
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
      window.prompt("Link do porównania:", url);
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
        <h2 className="text-base font-semibold text-slate-900">Porównaj dwie reklamy</h2>
        <p className="mt-0.5 text-xs text-slate-500">Dlaczego dwie reklamy są (albo nie są) w tej samej kampanii. Wybierz reklamy poniżej albo klikaj reklamy w grafie z wciśniętym Shift.</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <ItemPicker label="Reklama A" value={a} options={options} onChange={(k) => onChange(k, b)} />
        <ItemPicker label="Reklama B" value={b} options={options} onChange={(k) => onChange(a, k)} />
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <button type="button" onClick={() => onChange(b, a)} disabled={!a && !b} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:border-slate-500 disabled:opacity-40">
          ⇄ Zamień
        </button>
        <button type="button" onClick={() => onChange(null, null)} disabled={!a && !b} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:border-slate-500 disabled:opacity-40">
          Wyczyść
        </button>
        <button type="button" onClick={() => void copyLink()} disabled={!ready} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:border-slate-500 disabled:opacity-40">
          {copied ? "Skopiowano" : "Kopiuj link"}
        </button>
      </div>

      {a && b && a === b && <p className="text-xs text-amber-700">Wybierz dwie różne reklamy.</p>}
      {!ready && !(a && b) && <p className="text-xs text-slate-500">Wybierz obie reklamy, aby zobaczyć dowody.</p>}

      {result && a && b && (
        <>
          <div className={`rounded-md p-2.5 text-sm ${result.ex.sameCampaign ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
            <div className="font-semibold">
              {result.ex.sameCampaign ? `Ta sama kampania ${campaignOf(a) ?? ""}` : `Różne kampanie: ${campaignOf(a) ?? "—"} i ${campaignOf(b) ?? "—"}`}
            </div>
            <p className="mt-0.5 text-xs">{result.ex.summary}</p>
          </div>

          <section>
            <h3 className="text-sm font-semibold text-slate-900">
              Bezpośrednie powiązanie {itemButton(a)} ⟷ {itemButton(b)}
            </h3>
            {result.link ? (
              <>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-600">
                  <span className="h-1.5 w-24 overflow-hidden rounded bg-slate-200" title={`wynik ${result.link.score.toFixed(2)}`}>
                    <span className="block h-full bg-slate-800" style={{ width: `${Math.round(result.link.score * 100)}%` }} />
                  </span>
                  <span className="tabular-nums">wynik {result.link.score.toFixed(2)}</span>
                  {result.link.strong ? (
                    <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-white">silne powiązanie</span>
                  ) : result.link.score < minLinkScore ? (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">poniżej progu {minLinkScore}</span>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">Wynik łączy dowody jak „noisy-OR”: 1 − Π(1 − waga). Każdy dowód: waga encji × relacja (np. ×0,4 dla linku wychodzącego).</p>
                <ul className="mt-2 space-y-2">
                  {result.link.evidence.map((ev, i) => (
                    <EvidenceRow key={`${ev.pivot ?? ev.edgeType}-${i}`} ev={ev} idx={idx} onSelect={onSelect} />
                  ))}
                </ul>
              </>
            ) : (
              <p className="mt-1 text-xs text-slate-500">
                Brak zapisanego bezpośredniego powiązania. graph.json przechowuje do 12 najsilniejszych powiązań każdej reklamy, a powiązania z wynikiem poniżej 0,05 (bez silnego dowodu) są pomijane.
              </p>
            )}
          </section>

          {result.ex.path.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-slate-900">Najsilniejsza ścieżka przez inne reklamy</h3>
              <p className="mt-0.5 text-[11px] text-slate-500">Łańcuch powiązań o największym iloczynie wyników (tylko powiązania silne lub ≥ {minLinkScore}).</p>
              <ol className="mt-2 space-y-2">
                {result.ex.path.map((step) => (
                  <li key={`${step.from}-${step.to}`} className="rounded-md border border-slate-200 p-2 text-xs">
                    <div className="flex items-center gap-2">
                      {itemButton(step.from)} → {itemButton(step.to)}
                      <span className="ml-auto tabular-nums text-slate-500">wynik {step.score.toFixed(2)}</span>
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
            <h3 className="text-sm font-semibold text-slate-900">Wspólne encje ({result.shared.length})</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Wszystko, do czego prowadzą obie reklamy, także zdyskontowane encje. Te ostatnie wyjaśniają, dlaczego reklamy nie zostały połączone (np. publiczny serwis formularzy, CDN, popularna biblioteka).
            </p>
            {result.shared.length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">Reklamy nie mają wspólnych encji.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {result.shared.slice(0, 15).map(({ node, inDirect }) => (
                  <li key={node.id} className="rounded border border-slate-100 px-2 py-1 text-xs">
                    <div className="flex items-baseline gap-2">
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-500">{ENTITY_LABELS_PL[node.type]}</span>
                      <button type="button" onClick={() => onSelect(node.id)} className={`min-w-0 truncate text-left hover:underline ${node.discounts.length ? "text-slate-500" : "text-slate-900"}`} title={node.key}>
                        {node.label}
                      </button>
                      <span className="ml-auto shrink-0 text-[10px] tabular-nums text-slate-500">
                        {node.weight !== null ? `waga ${node.weight.toFixed(3)}` : "—"} · {node.df} rekl.
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {node.strong && <span className="rounded bg-slate-900 px-1 text-[10px] text-white">silny</span>}
                      {inDirect && <span className="rounded bg-blue-50 px-1 text-[10px] text-blue-800">w dowodach</span>}
                    </div>
                    <Discounts node={node} />
                  </li>
                ))}
              </ul>
            )}
            {result.shared.length > 15 && <p className="mt-1 text-[11px] text-slate-500">…i {result.shared.length - 15} kolejnych (posortowane od najsilniejszych).</p>}
          </section>
        </>
      )}
    </div>
  );
}
