"use client";

import { DatabaseZap, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type State = { status: "idle" } | { status: "busy" } | { status: "done"; messages: string[] } | { status: "error"; message: string };

/**
 * "Add to base" (B-284): puts the samples of an analysis job into the base of known campaigns, so the next
 * analysis finds them. Afterwards it says what was added and what was not and why, and refreshes the view of the
 * base. `disabledReason` (the bundled sample base is read-only) turns the button off and shows why.
 */
export default function AddToBaseButton({ jobId, ids, label = "Add to base", disabledReason }: { jobId: string; ids: string[]; label?: string; disabledReason: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "idle" });
  async function add() {
    setState({ status: "busy" });
    try {
      const res = await fetch("/api/add-to-base", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId, ids }) });
      const body = (await res.json()) as { messages?: string[]; error?: string };
      if (!res.ok || !body.messages) throw new Error(body.error ?? "Could not add to the base");
      setState({ status: "done", messages: body.messages });
      router.refresh();
    } catch (e) {
      setState({ status: "error", message: (e as Error).message });
    }
  }
  return (
    <span className="inline-flex flex-col items-start gap-1" data-no-print>
      <button
        type="button"
        onClick={add}
        disabled={!!disabledReason || ids.length === 0 || state.status === "busy" || state.status === "done"}
        title={disabledReason ?? "Adds the sample to the base of known campaigns; the next analysis will see it"}
        className="inline-flex items-center gap-1.5 rounded-md border border-slate-400 bg-white px-2.5 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state.status === "busy" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <DatabaseZap size={14} aria-hidden />}
        {state.status === "done" ? "Added to base" : label}
      </button>
      {disabledReason && <span className="max-w-md text-xs text-slate-600">{disabledReason}</span>}
      {state.status === "done" && <span className="max-w-md space-y-0.5 text-xs text-slate-800" role="status">{state.messages.map((m) => <span key={m} className="block">{m}</span>)}</span>}
      {state.status === "error" && <span className="max-w-md text-xs text-red-800" role="alert">{state.message}</span>}
    </span>
  );
}
