"use client";

import type { Campaign, CampaignFamily } from "@/lib/graph/model";
import { ENTITY_LABELS_PL, isSimilarityEdge, type SimilarityEdgeType } from "@/lib/graph/model";
import type { CampaignSummary } from "@/lib/pipeline/summary";
import { campaignAttributes, campaignHasPersona, personaOptions, plural } from "./compare";
import { campaignColor } from "./palette";
import { familyApartLines } from "@/lib/viewer/nearMissView";

function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "?";
}

const SIMILARITY_SHORT: Record<SimilarityEdgeType, string> = {
  similar_image: "Obrazy",
  similar_image_semantic: "Szablon kreacji",
  similar_text: "Treść",
  similar_dom: "Szablon strony",
  similar_audio: "Audio",
  similar_voice: "Głos",
};

function evidenceTypeLabel(type: Campaign["topEvidence"][number]["type"]): string {
  return isSimilarityEdge(type) ? SIMILARITY_SHORT[type] : ENTITY_LABELS_PL[type];
}

const KAMPANIA: [string, string, string] = ["kampania", "kampanie", "kampanii"];

function CampaignAttributesRow({ campaign }: { campaign: Campaign }) {
  const a = campaignAttributes(campaign);
  if (a.personas.length === 0 && a.cyrillic === 0 && a.cloakingSuspected === 0 && a.deepfakeScoreMax === null) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
      {a.personas.slice(0, 3).map((p) => (
        <span key={p.id} className="rounded bg-fuchsia-50 px-1.5 py-0.5 text-fuchsia-900" title={`Persona (wizerunek) w ${p.count} reklamach: słaby sygnał, do filtrowania`}>
          {p.name} <span className="text-fuchsia-500">×{p.count}</span>
        </span>
      ))}
      {a.personas.length > 3 && <span className="text-slate-400">+{a.personas.length - 3}</span>}
      {a.cyrillic > 0 && (
        <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-900" title="Reklamy z cyrylicą w komentarzach strony lub parametrach kampanii">
          cyrylica ×{a.cyrillic}
        </span>
      )}
      {a.cloakingSuspected > 0 && (
        <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-800" title="Reklamy, których strona wyglądała inaczej dla crawlera platformy i dla przeglądarki mobilnej">
          cloaking ×{a.cloakingSuspected}
        </span>
      )}
      {a.deepfakeScoreMax !== null && (
        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-900" title="Najwyższy wynik deepfake z danych wejściowych (np. DROZD): wynik modelu, wskazówka">
          deepfake max {a.deepfakeScoreMax.toFixed(2)}
        </span>
      )}
    </div>
  );
}

export interface CampaignListProps {
  campaigns: Campaign[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  summaries: Record<string, CampaignSummary>;
  /** Groups of similar campaigns (second level). */
  families?: CampaignFamily[];
  /** Persona filter (persona id) and its setter; the filter is hidden when there are no personas. */
  personaId?: string | null;
  onPersonaChange?: (id: string | null) => void;
}

export default function CampaignList({ campaigns, selected, onSelect, summaries, families = [], personaId = null, onPersonaChange }: CampaignListProps) {
  const familyById = new Map(families.map((f) => [f.id, f]));
  const options = personaOptions(campaigns);
  const persona = personaId ? (options.find((p) => p.id === personaId) ?? null) : null;
  const filtered = campaigns.filter((c) => campaignHasPersona(c, persona?.id ?? null));
  const multi = filtered.filter((c) => c.size > 1);
  const singles = filtered.length - multi.length;
  return (
    <nav aria-label="Kampanie" className="flex flex-col gap-2">
      {options.length > 0 && onPersonaChange && (
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          <span className="font-medium">Persona (wizerunek)</span>
          <select
            value={persona?.id ?? ""}
            onChange={(e) => onPersonaChange(e.target.value || null)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
          >
            <option value="">wszystkie osoby</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.campaigns} {plural(p.campaigns, KAMPANIA)}, {p.ads} rekl.)
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
          selected === null ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:border-slate-400"
        }`}
      >
        <span className="font-semibold">{persona ? `Kampanie z personą: ${persona.name}` : "Wszystkie kampanie"}</span>
        <span className={`block text-xs ${selected === null ? "text-slate-300" : "text-slate-500"}`}>
          {multi.length} {plural(multi.length, KAMPANIA)} · {singles} {plural(singles, ["niepowiązana reklama", "niepowiązane reklamy", "niepowiązanych reklam"])}
        </span>
      </button>
      {campaigns.map((c, i) => {
        if (!campaignHasPersona(c, persona?.id ?? null)) return null;
        const active = selected === c.id;
        const summary = summaries[c.id];
        return (
          <button
            type="button"
            key={c.id}
            onClick={() => onSelect(active ? null : c.id)}
            className={`rounded-lg border bg-white px-3 py-2 text-left transition ${
              active ? "border-slate-900 ring-2 ring-slate-900/10" : "border-slate-200 hover:border-slate-400"
            } ${c.size < 2 ? "opacity-70" : ""}`}
          >
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: campaignColor(i, c.size) }} aria-hidden />
              <span className="font-mono text-sm font-semibold">{c.id}</span>
              <span className="text-xs text-slate-500">
                {c.size} {c.size === 1 ? "reklama" : c.size < 5 ? "reklamy" : "reklam"}
              </span>
              {c.size > 1 && (
                <span className="ml-auto text-[11px] text-slate-400" title="Średnia siła powiązań wewnątrz kampanii">
                  spójność {c.cohesion.toFixed(2)}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {fmtDate(c.firstSeen)} – {fmtDate(c.lastSeen)}
              {c.domains.length > 0 && <> · {c.domains.slice(0, 2).join(", ")}{c.domains.length > 2 ? ` +${c.domains.length - 2}` : ""}</>}
            </div>
            <CampaignAttributesRow campaign={c} />
            {c.familyId && familyById.get(c.familyId) && (
              <div
                className="mt-1 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-900"
                title={`Grupa podobnych kampanii ${c.familyId}: ${familyById.get(c.familyId)!.topEvidence.map((e) => e.label).slice(0, 3).join("; ")}. Osobno, bo: ${familyApartLines(familyById.get(c.familyId)!, null).join("; ") || "brak dowodu na poziomie kampanii"}.`}
              >
                podobne kampanie {c.familyId}: {familyById.get(c.familyId)!.campaigns.filter((x) => x !== c.id).join(", ")}
                <span className="text-violet-600"> · {evidenceTypeLabel(familyById.get(c.familyId)!.topEvidence[0]?.type ?? "similar_dom")}</span>
              </div>
            )}
            {summary && <div className="mt-1 text-xs text-slate-700">{summary.persona} — {summary.narrative}</div>}
            {c.topEvidence.length > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-1">
                {c.topEvidence.slice(0, 3).map((e) => (
                  <li key={e.key} className="max-w-full truncate rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700" title={`${e.label} (${e.count})`}>
                    <span className="font-medium">{evidenceTypeLabel(e.type)}:</span> {e.label} <span className="text-slate-400">×{e.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </button>
        );
      })}
    </nav>
  );
}
