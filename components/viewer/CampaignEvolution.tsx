"use client";

import { useMemo } from "react";
import type { Campaign, EvidenceGraph } from "@/lib/graph/model";
import { defangText } from "@/lib/viewer/defang";
import { campaignTimeline, evolutionRows, evolutionSentence, traitMatrix } from "@/lib/viewer/evolution";
import { fmtDate } from "@/lib/viewer/format";
import { typeInfo } from "@/lib/viewer/plain";
import { evidenceStrength, STRENGTH_INFO } from "@/lib/viewer/strength";
import { Help } from "./ui";

const KIND_LABEL = { ad: "reklama", registered: "rejestracja domeny", cert: "certyfikat" } as const;

/**
 * "Dlaczego to jedna kampania" of the campaign card (B-036): the matrix of shared traces (materials × traces,
 * strongest first) as the main evidence, the timeline of registrations, certificates and ads, and the
 * evolution: for each material what changed against the earlier ones and what stayed. Draws what
 * `lib/viewer/evolution.ts` computes from the graph.
 */
export default function CampaignEvolution({ campaign, graph }: { campaign: Campaign; graph: Pick<EvidenceGraph, "nodes" | "edges"> }) {
  const view = useMemo(
    () => ({ matrix: traitMatrix(campaign, graph), timeline: campaignTimeline(campaign, graph), rows: evolutionRows(campaign, graph) }),
    [campaign, graph],
  );
  if (campaign.size < 2) return null;
  const { matrix, timeline, rows } = view;
  return (
    <div className="space-y-3">
      <section aria-label="Macierz wspólnych śladów">
        <h4 className="text-sm font-semibold">Wspólne ślady materiałów<Help term="wspolny_slad" /></h4>
        {matrix.columns.length === 0 ? (
          <p className="mt-1 text-xs text-slate-600">Materiały nie mają wspólnych śladów, łączy je tylko podobieństwo treści.</p>
        ) : (
          <div className="mt-1 overflow-x-auto">
            <table className="border-collapse text-xs">
              <caption className="sr-only">Które materiały kampanii mają który wspólny ślad; kolumny od najsilniejszego śladu</caption>
              <thead>
                <tr>
                  <th scope="col" className="p-1 text-left font-medium text-slate-600">Materiał</th>
                  {matrix.columns.map((col) => (
                    <th key={col.id} scope="col" className="max-w-28 p-1 text-left align-bottom font-normal" title={`${STRENGTH_INFO[evidenceStrength({ strong: col.strong, discounted: col.skipped, weight: col.weight ?? 0, pivotType: col.type })].label}: ${col.label}`}>
                      <span className="block text-[10px] uppercase tracking-wide text-slate-500">{typeInfo(col.type)?.name ?? col.type}</span>
                      <span className="block truncate">{defangText(col.label)}</span>
                      <span className="block text-[10px] text-slate-600">{STRENGTH_INFO[evidenceStrength({ strong: col.strong, discounted: col.skipped, weight: col.weight ?? 0, pivotType: col.type })].label} · {col.count}/{campaign.size}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <th scope="row" className="p-1 text-left font-mono font-normal">{row.id}</th>
                    {row.has.map((has, i) => (
                      <td key={matrix.columns[i].id} className={`p-1 text-center ${has ? "bg-slate-800 text-white" : "text-slate-300"}`}>
                        <span aria-hidden>{has ? "●" : "·"}</span>
                        <span className="sr-only">{has ? "ma" : "nie ma"}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {matrix.hidden > 0 && <p className="mt-1 text-xs text-slate-600">Pominięto jeszcze {matrix.hidden} słabszych wspólnych śladów.</p>}
      </section>

      <section aria-label="Co się zmieniało w kampanii">
        <h4 className="text-sm font-semibold">Ewolucja kampanii</h4>
        <p className="text-xs text-slate-600">Przy każdym materiale: co zmieniło się względem wcześniejszych, a co zostało.</p>
        <ol className="mt-1 space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="rounded border border-slate-200 bg-white px-2 py-1">
              <span className="font-mono text-xs">{r.id}</span> <span className="text-xs text-slate-600">{fmtDate(r.date)}</span>: {evolutionSentence(r)}
              {r.changed.length > 0 && (
                <ul className="ml-4 list-disc text-xs text-slate-700">
                  {r.changed.map((c) => <li key={c.kind}>{c.kind}: {c.added.map(defangText).join(", ")}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </section>

      {timeline.length > 0 && (
        <section aria-label="Oś czasu">
          <h4 className="text-sm font-semibold">Oś czasu</h4>
          <ol className="mt-1 space-y-0.5 border-l-2 border-slate-300 pl-3 text-xs">
            {timeline.map((e, i) => (
              <li key={i}>
                <span className="text-slate-600">{fmtDate(e.date, { time: false })}</span> <b>{KIND_LABEL[e.kind]}</b>: {defangText(e.text)}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
