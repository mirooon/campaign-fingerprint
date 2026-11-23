"use client";

import { useEffect, useState } from "react";
import { fmtNum } from "@/lib/viewer/format";
import type { ThresholdRow } from "@/lib/viewer/thresholdPreview";
import { Help } from "./ui";
import { ReadHow } from "./Guide";

type State = { status: "loading" } | { status: "ready"; current: number; rows: ThresholdRow[] } | { status: "error"; message: string };

/**
 * Slider of the link threshold with a preview (B-026): for the chosen value, how many campaigns the saved links give
 * (computed by the backend's clustering), how many materials stay alone and how big the largest campaign is. Only a
 * preview: it changes nothing in the base.
 */
export default function ThresholdPreview() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [index, setIndex] = useState<number | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/threshold-preview", { signal: ctl.signal })
      .then(async (r) => {
        const b = (await r.json()) as { current?: number; rows?: ThresholdRow[]; error?: string };
        setState(r.ok && b.rows && b.current !== undefined ? { status: "ready", current: b.current, rows: b.rows } : { status: "error", message: b.error ?? "Could not compute the preview." });
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ status: "error", message: `Could not compute the preview: ${e.message}` });
      });
    return () => ctl.abort();
  }, []);
  if (state.status === "loading") return <p className="text-sm text-slate-600">Computing the preview…</p>;
  if (state.status === "error") return <p className="text-sm text-slate-600">{state.message}</p>;
  const currentIndex = state.rows.findIndex((r) => r.value === state.current);
  const i = index ?? Math.max(0, currentIndex);
  const row = state.rows[i];
  return (
    <div className="space-y-3 text-sm">
      <h3 className="font-semibold">Linking threshold<Help term="prog_laczenia" /></h3>
      <p className="text-xs text-slate-600">Move the slider to see how many campaigns the saved links would give at a different threshold. This is an approximate preview: the graph keeps the strongest links of each ad, not all pairs. The base does not change.</p>
      <label className="block">
        <span className="text-xs text-slate-700">Threshold {fmtNum(row.value)}{row.value === state.current ? " (used in the base)" : ""}</span>
        <input type="range" min={0} max={state.rows.length - 1} step={1} value={i} onChange={(e) => setIndex(Number(e.target.value))} className="mt-1 w-full" aria-valuetext={`threshold ${fmtNum(row.value)}`} />
      </label>
      <p className="rounded border border-slate-200 bg-white p-2">
        At threshold <b>{fmtNum(row.value)}</b>: <b>{row.campaigns}</b> {row.campaigns === 1 ? "campaign" : "campaigns"}, {row.singletons} {row.singletons === 1 ? "sample" : "samples"} alone, the largest campaign has {row.largest} {row.largest === 1 ? "sample" : "samples"}.
      </p>
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">Number of campaigns at successive thresholds</caption>
        <thead>
          <tr className="border-b border-slate-300 text-left text-slate-600"><th scope="col" className="p-1">Threshold</th><th scope="col" className="p-1">Campaigns</th><th scope="col" className="p-1">Alone</th><th scope="col" className="p-1">Largest</th></tr>
        </thead>
        <tbody>
          {state.rows.map((r, k) => (
            <tr key={r.value} className={`border-b border-slate-100 ${k === i ? "bg-slate-100 font-semibold" : ""}`}>
              <th scope="row" className="p-1 text-left font-normal">{fmtNum(r.value)}{r.value === state.current ? " ●" : ""}</th>
              <td className="p-1">{r.campaigns}</td><td className="p-1">{r.singletons}</td><td className="p-1">{r.largest}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ReadHow id="threshold" />
    </div>
  );
}
