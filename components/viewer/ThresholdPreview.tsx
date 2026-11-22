"use client";

import { useEffect, useState } from "react";
import { fmtNum } from "@/lib/viewer/format";
import type { ThresholdRow } from "@/lib/viewer/thresholdPreview";
import { Help } from "./ui";

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
        setState(r.ok && b.rows && b.current !== undefined ? { status: "ready", current: b.current, rows: b.rows } : { status: "error", message: b.error ?? "Nie udało się policzyć podglądu." });
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ status: "error", message: `Nie udało się policzyć podglądu: ${e.message}` });
      });
    return () => ctl.abort();
  }, []);
  if (state.status === "loading") return <p className="text-sm text-slate-600">Liczenie podglądu…</p>;
  if (state.status === "error") return <p className="text-sm text-slate-600">{state.message}</p>;
  const currentIndex = state.rows.findIndex((r) => r.value === state.current);
  const i = index ?? Math.max(0, currentIndex);
  const row = state.rows[i];
  return (
    <div className="space-y-3 text-sm">
      <h3 className="font-semibold">Próg łączenia<Help term="prog_laczenia" /></h3>
      <p className="text-xs text-slate-600">Przesuń suwak, żeby zobaczyć, ile kampanii dałyby zapisane powiązania przy innym progu. To podgląd przybliżony: graf przechowuje najsilniejsze powiązania każdej reklamy, nie wszystkie pary. Baza się nie zmienia.</p>
      <label className="block">
        <span className="text-xs text-slate-700">Próg {fmtNum(row.value)}{row.value === state.current ? " (używany w bazie)" : ""}</span>
        <input type="range" min={0} max={state.rows.length - 1} step={1} value={i} onChange={(e) => setIndex(Number(e.target.value))} className="mt-1 w-full" aria-valuetext={`próg ${fmtNum(row.value)}`} />
      </label>
      <p className="rounded border border-slate-200 bg-white p-2">
        Przy progu <b>{fmtNum(row.value)}</b>: <b>{row.campaigns}</b> {row.campaigns === 1 ? "kampania" : "kampanii"}, {row.singletons} materiałów osobno, największa kampania ma {row.largest} materiałów.
      </p>
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">Liczba kampanii przy kolejnych progach</caption>
        <thead>
          <tr className="border-b border-slate-300 text-left text-slate-600"><th scope="col" className="p-1">Próg</th><th scope="col" className="p-1">Kampanie</th><th scope="col" className="p-1">Osobno</th><th scope="col" className="p-1">Największa</th></tr>
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
    </div>
  );
}
