"use client";

import { ArrowRight, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import type { RouteLink } from "@/lib/viewer/clickRoute";
import { Defanged, Help } from "./ui";

type State = { status: "loading" } | { status: "ready"; route: RouteLink[] } | { status: "error"; message: string };

/** Frame of a link by its status: neutral for a working one, amber for one that does not answer or is blocked. */
function linkStyle(l: RouteLink): string {
  if (l.status === "no_response" || l.status === "blocked" || l.status === "error") return "border-amber-500 bg-amber-50";
  return l.role === "ad" ? "border-slate-400 bg-slate-50" : "border-slate-300 bg-white";
}

/**
 * "Trasa kliknięcia" (B-021): the chain ad → tracking link → redirects → lure page → form or shop as a row of links,
 * each with its role in words, the defanged address, the status ("przekierował", "nie odpowiada", "zablokowany")
 * and the age of the domain against the ad ("zarejestrowana 2 dni przed emisją"). Loads the route of one material
 * from `/api/click-route` (of the base, or of the job when `jobId` is given).
 */
export default function ClickRoute({ itemId, jobId }: { itemId: string; jobId?: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    const ctl = new AbortController();
    const q = new URLSearchParams({ id: itemId, ...(jobId ? { job: jobId } : {}) });
    fetch(`/api/click-route?${q}`, { signal: ctl.signal })
      .then(async (r) => {
        const body = (await r.json()) as { route?: RouteLink[]; error?: string };
        setState(r.ok && body.route ? { status: "ready", route: body.route } : { status: "error", message: body.error ?? "Nie udało się wczytać trasy." });
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ status: "error", message: `Nie udało się wczytać trasy: ${e.message}` });
      });
    return () => ctl.abort();
  }, [itemId, jobId]);
  return (
    <section aria-label="Trasa kliknięcia">
      <h4 className="mb-1.5 text-sm font-semibold">Trasa kliknięcia<Help term="trasa_klikniecia" /></h4>
      <p className="mb-1.5 text-xs text-slate-600">Którędy idzie osoba, która kliknie w reklamę: od reklamy, przez linki pośrednie, do strony, na której oszust zbiera dane albo pieniądze. Adresy są rozbrojone<Help term="rozbrojony_adres" />.</p>
      {state.status === "loading" && <p className="text-sm text-slate-600">Wczytywanie trasy…</p>}
      {state.status === "error" && <p className="text-sm text-slate-600">{state.message}</p>}
      {state.status === "ready" && (
        <ol className="flex flex-wrap items-stretch gap-1.5">
          {state.route.map((l, i) => (
            <li key={l.step} className="flex items-center gap-1.5">
              {i > 0 && <ArrowRight size={16} aria-label="następnie" className="shrink-0 text-slate-500" />}
              <div className={`w-52 rounded-md border p-2 text-xs ${linkStyle(l)}`}>
                <div className="font-semibold text-slate-900">{l.step + 1}. {l.roleLabel}{l.role === "lure" && <Help term="strona_przyneta" />}</div>
                {l.url && <div className="mt-0.5"><Defanged value={l.url} /></div>}
                <div className="mt-0.5 text-slate-800">{l.statusLabel}</div>
                {l.domainNote && <div className={l.fresh ? "mt-0.5 font-medium text-amber-900" : "mt-0.5 text-slate-700"}>{l.domainNote}</div>}
                {l.warning && <div className="mt-1 flex gap-1 text-amber-900"><TriangleAlert size={14} aria-hidden className="mt-0.5 shrink-0" /><span>{l.warning}</span></div>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
