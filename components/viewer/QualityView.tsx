"use client";

import { useEffect, useState } from "react";
import type { BaseQuality, QualityCell } from "@/lib/viewer/baseQuality";
import { QUALITY_LABEL } from "@/lib/viewer/baseQuality";
import { Empty } from "./ui";

type State = { status: "loading" } | { status: "ready"; quality: BaseQuality } | { status: "error"; message: string };

const MARK: Record<QualityCell["status"], { icon: string; word: string; cls: string }> = {
  ok: { icon: "✓", word: "jest", cls: "text-slate-700" },
  warn: { icon: "⚠", word: "ostrzeżenie", cls: "text-amber-800" },
  missing: { icon: "✗", word: "brak", cls: "text-red-800" },
  unknown: { icon: "?", word: "nieznane", cls: "text-slate-500" },
};

/**
 * "Jakość danych" (B-032): the whole base at a glance. Counts per check ("ile spraw bez HAR") and a table with one row
 * per material and five icons (zrzut, strona, HAR, adres, wideo); each icon has a word, and its tooltip gives the
 * reason and the effect of a gap. Materials with a gap come first.
 */
export default function QualityView() {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/base-quality", { signal: ctl.signal })
      .then(async (r) => {
        const b = (await r.json()) as BaseQuality & { error?: string };
        setState(r.ok ? { status: "ready", quality: b } : { status: "error", message: b.error ?? `Nie udało się ocenić bazy (kod ${r.status})` });
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ status: "error", message: `Nie udało się ocenić bazy: ${e.message}` });
      });
    return () => ctl.abort();
  }, []);
  return (
    <div className="mx-auto max-w-4xl space-y-3 p-4">
      <h2 className="text-xl font-semibold">Czy dane w bazie są kompletne?</h2>
      {state.status === "loading" && <p className="text-sm text-slate-600">Wczytywanie…</p>}
      {state.status === "error" && <p className="text-sm text-slate-600">{state.message}</p>}
      {state.status === "ready" && (
        <>
          {state.quality.note && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">{state.quality.note}</p>}
          {state.quality.total === 0 ? (
            <Empty>Baza nie ma materiałów.</Empty>
          ) : (
            <>
              <ul className="flex flex-wrap gap-2 text-sm">
                {state.quality.counts.map((c) => (
                  <li key={c.check} className="rounded-md border border-slate-300 bg-white px-2.5 py-1">
                    <span className="block text-lg font-semibold leading-tight">{c.missing}{c.warn ? ` + ${c.warn} ⚠` : ""}</span>
                    <span className="text-xs text-slate-700">bez: {QUALITY_LABEL[c.check].toLowerCase()} (z {state.quality.total})</span>
                  </li>
                ))}
              </ul>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Kompletność danych każdego materiału: pięć sprawdzeń ze stanem</caption>
                  <thead>
                    <tr className="border-b border-slate-300 text-left text-xs text-slate-600">
                      <th scope="col" className="p-1.5 font-medium">Materiał</th>
                      <th scope="col" className="p-1.5 font-medium">Kampania</th>
                      {state.quality.counts.map((c) => <th key={c.check} scope="col" className="p-1.5 text-center font-medium">{QUALITY_LABEL[c.check]}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {state.quality.rows.map((r) => (
                      <tr key={r.id} className="border-b border-slate-100">
                        <th scope="row" className="p-1.5 text-left font-mono font-normal">{r.id}</th>
                        <td className="p-1.5 text-xs">{r.campaign ?? "—"}</td>
                        {r.cells.map((c) => {
                          const m = MARK[c.status];
                          return (
                            <td key={c.check} className={`p-1.5 text-center ${m.cls}`} title={c.text || undefined}>
                              <span aria-hidden>{m.icon}</span>
                              <span className="sr-only">{QUALITY_LABEL[c.check]}: {m.word}{c.optional ? " (opcjonalne)" : ""}. {c.text}</span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
