"use client";

import { useState } from "react";

/** Body of one correction sent to `/api/corrections` (B-281). */
type CorrectionBody = { action: "must" | "cannot"; a: string; b: string } | { action: "disable-pivot"; pivot: string };

const SAVED = "Zapisano w corrections.json. Zastosujemy przy następnym przebiegu (build-graph) jako „decyzja analityka”.";

/** Sends one correction; resolves to an error message or null on success. */
async function sendCorrection(body: CorrectionBody): Promise<string | null> {
  try {
    const res = await fetch("/api/corrections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const out = (await res.json()) as { error?: string };
    return res.ok ? null : (out.error ?? `Nie udało się zapisać korekty (kod ${res.status})`);
  } catch (e) {
    return (e as Error).message;
  }
}

/** Status line under a correction button: saved, or the reason it failed. */
function Status({ state }: { state: { ok: boolean; text: string } | null }) {
  if (!state) return null;
  return <p role={state.ok ? "status" : "alert"} className={`mt-1 text-[11px] ${state.ok ? "text-emerald-800" : "text-red-800"}`}>{state.text}</p>;
}

/** Hook: sends a correction and keeps its status for the line under the button. */
function useCorrection() {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  /** Sends `body` and shows the outcome. */
  async function run(body: CorrectionBody) {
    setState(null);
    const err = await sendCorrection(body);
    setState(err ? { ok: false, text: err } : { ok: true, text: SAVED });
  }
  return { state, run };
}

/** „To połączenie jest błędne” on one link of the „Dlaczego połączone” list: records a cannot-link pair. */
export function WrongLinkButton({ a, b }: { a: string; b: string }) {
  const { state, run } = useCorrection();
  return (
    <div data-no-print>
      <button type="button" onClick={() => void run({ action: "cannot", a, b })} className="mt-1 rounded border border-red-200 px-1 text-[10px] text-red-800 hover:border-red-400" title={`Rozdziel ${a} i ${b} przy następnym przebiegu`}>
        to połączenie jest błędne
      </button>
      <Status state={state} />
    </div>
  );
}

/** „Połącz” / „Rozdziel” for an ad and another ad typed by the analyst: records a must-link or cannot-link pair. */
export function PairCorrection({ item }: { item: string }) {
  const [other, setOther] = useState("");
  const { state, run } = useCorrection();
  const target = other.trim();
  const disabled = !target || target === item;
  return (
    <div className="rounded-md border border-slate-200 p-2 text-xs" data-no-print>
      <div className="font-medium text-slate-900">Korekta analityka</div>
      <p className="mt-0.5 text-[11px] text-slate-500">Wpisz identyfikator innej reklamy. „Połącz” wymusza wspólną kampanię, „rozdziel” zabrania jej (rozdzielenie wygrywa).</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="id reklamy" aria-label="Identyfikator drugiej reklamy" className="w-32 rounded-md border border-slate-300 px-1.5 py-0.5 font-mono" />
        <button type="button" disabled={disabled} onClick={() => void run({ action: "must", a: item, b: target })} className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-slate-700 hover:border-slate-500 disabled:opacity-40">
          połącz
        </button>
        <button type="button" disabled={disabled} onClick={() => void run({ action: "cannot", a: item, b: target })} className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-slate-700 hover:border-slate-500 disabled:opacity-40">
          rozdziel
        </button>
      </div>
      <Status state={state} />
    </div>
  );
}

/** „Wyłącz ten ślad” on a shared entity: the trace stops counting as evidence on the next run. */
export function DisablePivotButton({ pivot }: { pivot: string }) {
  const { state, run } = useCorrection();
  return (
    <div data-no-print>
      <button type="button" onClick={() => void run({ action: "disable-pivot", pivot })} className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:border-slate-500" title="Ten ślad przestanie łączyć reklamy przy następnym przebiegu">
        wyłącz ten ślad (błędny dowód)
      </button>
      <Status state={state} />
    </div>
  );
}
