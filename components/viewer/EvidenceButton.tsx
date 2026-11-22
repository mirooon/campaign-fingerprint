"use client";

import { Download, Loader2 } from "lucide-react";
import { useState } from "react";

/** Reads the message of an error answer of the API (JSON { error }), or a generic one. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // the answer is not JSON: fall through to the generic message
  }
  return `Nie udało się pobrać paczki (kod ${res.status})`;
}

/**
 * "Pobierz paczkę dowodów": downloads the ZIP of one campaign from `POST /api/evidence`
 * (evidence.json, list for the CERT warning list, DSA Art. 16 notice, SHA-256 manifest).
 * `jobId` is given for campaigns of new materials (N1...). `blockedReason` (the analyst rejected the campaign) turns the button off and shows why. A failure shows its message next to the button.
 */
export default function EvidenceButton({ campaignId, jobId, blockedReason }: { campaignId: string; jobId?: string; blockedReason?: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/evidence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ campaign: campaignId, ...(jobId ? { jobId } : {}) }) });
      if (!res.ok) throw new Error(await errorMessage(res));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `paczka-dowodow-${campaignId}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={download} disabled={busy || !!blockedReason} className="inline-flex items-center gap-1.5 rounded-md border border-slate-400 bg-white px-2.5 py-1 text-xs font-medium text-slate-900 hover:bg-slate-100 disabled:opacity-60" title="ZIP z evidence.json, listą domen dla CERT, zgłoszeniem DSA i sumami SHA-256. Narzędzie niczego nie wysyła.">
        {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Download size={13} aria-hidden />}
        Pobierz paczkę
      </button>
      {blockedReason && <span className="text-xs text-slate-700">{blockedReason}</span>}
      {error && <span role="alert" className="text-xs text-red-800">{error}</span>}
    </span>
  );
}
