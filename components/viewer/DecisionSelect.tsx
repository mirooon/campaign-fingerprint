"use client";

import { useState } from "react";
import { DECISION_LABEL, DECISIONS, type Decision } from "@/lib/viewer/decisions";

/**
 * Analyst's decision for a campaign (B-282): "do zgłoszenia", "zgłoszone", "odrzucone", "do weryfikacji", or none.
 * The tool only proposes; the choice is saved next to the base (`/api/decisions`) and gates the evidence pack.
 */
export default function DecisionSelect({ campaignId, value, onSaved }: { campaignId: string; value: Decision | null; onSaved: (campaign: string, status: Decision | null) => void }) {
  const [error, setError] = useState<string | null>(null);
  async function change(next: string) {
    setError(null);
    const status = next === "" ? null : (next as Decision);
    try {
      const res = await fetch("/api/decisions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaign: campaignId, status }) });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Nie udało się zapisać decyzji (kod ${res.status})`);
      onSaved(campaignId, status);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs" data-no-print>
      <label className="flex items-center gap-1.5">
        Decyzja analityka
        <select value={value ?? ""} onChange={(e) => void change(e.target.value)} className="rounded-md border border-slate-300 bg-white px-1.5 py-1">
          <option value="">brak decyzji</option>
          {DECISIONS.map((d) => <option key={d} value={d}>{DECISION_LABEL[d]}</option>)}
        </select>
      </label>
      {error && <span role="alert" className="text-red-800">{error}</span>}
    </span>
  );
}
