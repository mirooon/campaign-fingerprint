"use client";

import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { useMemo, useState } from "react";
import type { Campaign, CampaignFamily, CampaignsFile } from "@/lib/graph/model";
import { basisNote, campaignTitle, cohesionLabel, groupCampaigns } from "@/lib/viewer/campaignView";
import { fmtRange, count, MATERIAL } from "@/lib/viewer/format";
import { typeInfo } from "@/lib/viewer/plain";
import { campaignAttributes, campaignHasPersona, personaOptions } from "./compare";
import EvidenceButton from "./EvidenceButton";
import PrintButton from "./PrintButton";
import { Empty, Help, StrengthLegend } from "./ui";

export interface CampaignsViewProps {
  campaigns: CampaignsFile;
  openId: string | null;
  onOpen: (id: string | null) => void;
  /** Open the comparison of two materials of the base. */
  onCompare: (a: string, b: string | null) => void;
}

/** "szablon strony, artykuł": names of the strongest shared traits of a family. */
function familyCommon(f: CampaignFamily): string {
  const names = f.topEvidence.map((e) => typeInfo(e.type)?.name ?? e.label);
  return [...new Set(names)].slice(0, 3).join(", ") || "brak wspólnych śladów na poziomie kampanii";
}

/** Card of one campaign: name, size, dates, strength of links, basis note, variants; expands to the premises and members. */
function Card({ c, open, onToggle, onCompare }: { c: Campaign; open: boolean; onToggle: () => void; onCompare: (a: string, b: string | null) => void }) {
  const attrs = campaignAttributes(c);
  const basis = basisNote(c);
  return (
    <article className="rounded-lg border border-slate-300 bg-white">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2 p-3 text-left">
        {open ? <ChevronDown size={16} aria-hidden className="mt-0.5 shrink-0" /> : <ChevronRight size={16} aria-hidden className="mt-0.5 shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">{campaignTitle(c)}</span>
          <span className="block text-xs text-slate-600">
            {count(c.size, MATERIAL)} · {fmtRange(c.firstSeen, c.lastSeen)}
            {c.size > 1 && <> · siła powiązań: {cohesionLabel(c.cohesion)}<Help term="sila_w_kampanii" /></>}
          </span>
          {c.topEvidence[0] && <span className="mt-0.5 block text-xs text-slate-700">Co łączy: {typeInfo(c.topEvidence[0].type)?.name ?? c.topEvidence[0].label}, {c.topEvidence[0].label}</span>}
          <span className="mt-1 flex flex-wrap gap-1 text-[11px]">
            {basis && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-900 ring-1 ring-amber-300">{basis}</span>}
            {(c.variants?.length ?? 0) > 0 && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-800" title="Materiały przypisane po samej kreacji, bez własnej infrastruktury">{c.variants!.length} {c.variants!.length === 1 ? "wariant po kreacji" : "warianty po kreacji"}<Help term="wariant" /></span>}
            {attrs.personas.slice(0, 3).map((p) => <span key={p.id} className="rounded bg-fuchsia-50 px-1.5 py-0.5 text-fuchsia-900">{p.name}</span>)}
            {attrs.cloakingSuspected > 0 && <span className="rounded bg-slate-100 px-1.5 py-0.5">cloaking ×{attrs.cloakingSuspected}<Help term="cloaking" /></span>}
          </span>
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-200 p-3 text-sm">
          <div>
            <b>Dlaczego to jedna kampania</b>
            <ul className="mt-1 flex flex-wrap gap-1">
              {c.topEvidence.map((e) => <li key={e.key} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{typeInfo(e.type)?.name ?? e.type}: {e.label} ×{e.count}</li>)}
              {!c.topEvidence.length && <li className="text-xs text-slate-600">Materiał bez powiązań.</li>}
            </ul>
          </div>
          <div>
            <b>Materiały</b>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {c.members.map((m) => {
                const v = c.variants?.find((x) => x.id === m);
                return (
                  <li key={m} className="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-xs">
                    {m}{v && <span className="font-sans text-slate-600"> (wariant po kreacji, podobny do {v.like})</span>}
                    {c.members[0] !== m && <button type="button" data-no-print className="ml-1 font-sans underline" onClick={() => onCompare(c.members[0], m)}>porównaj z {c.members[0]}</button>}
                  </li>
                );
              })}
            </ul>
          </div>
          {c.domains.length > 0 && <p className="text-xs text-slate-700">Domeny: {c.domains.join(", ")}</p>}
          <span data-no-print className="flex flex-wrap items-center gap-2">
            <EvidenceButton campaignId={c.id} />
            <PrintButton />
          </span>
        </div>
      )}
    </article>
  );
}

/** "Kampanie": groups of similar campaigns in frames (Wspólne / Różne), single campaigns, folded materials without links. */
export default function CampaignsView({ campaigns, openId, onOpen, onCompare }: CampaignsViewProps) {
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showSingles, setShowSingles] = useState(false);
  const options = useMemo(() => personaOptions(campaigns.campaigns), [campaigns]);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => campaigns.campaigns.filter((c) => campaignHasPersona(c, personaId) && (!q || campaignTitle(c).toLowerCase().includes(q) || c.domains.some((d) => d.toLowerCase().includes(q)) || c.advertisers.some((a) => a.toLowerCase().includes(q)))),
    [campaigns, personaId, q],
  );
  const grouped = useMemo(() => groupCampaigns(filtered, campaigns.families ?? []), [filtered, campaigns.families]);
  const card = (c: Campaign) => <Card key={c.id} c={c} open={openId === c.id} onToggle={() => onOpen(openId === c.id ? null : c.id)} onCompare={onCompare} />;
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Jakie kampanie są w bazie porównawczej?</h2>
        <p className="mt-1 text-sm text-slate-700">Kampania<Help term="kampania" /> to materiały jednego operatora. Kampanie różnych operatorów o tym samym szablonie stoją razem w ramce grupy podobnych<Help term="grupa_podobnych" />.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Szukaj: osoba, domena, K03" aria-label="Szukaj kampanii" className="min-w-56 rounded-md border border-slate-300 px-2 py-1.5" />
        {options.length > 0 && (
          <label className="flex items-center gap-1.5">
            Persona<Help term="persona" />
            <select value={personaId ?? ""} onChange={(e) => setPersonaId(e.target.value || null)} className="rounded-md border border-slate-300 bg-white px-2 py-1.5">
              <option value="">wszystkie osoby</option>
              {options.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.campaigns})</option>)}
            </select>
          </label>
        )}
        <div className="ml-auto"><StrengthLegend /></div>
      </div>

      {filtered.length === 0 && <Empty>Nic nie pasuje do filtra. Zmień wyszukiwanie albo wybierz „wszystkie osoby”.</Empty>}

      {grouped.families.map(({ family, campaigns: list }) => (
        <section key={family.id} className="rounded-xl border-2 border-violet-500 bg-violet-50/40 p-3" aria-label={`Grupa podobnych kampanii ${family.id}`}>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-violet-950"><Layers size={16} aria-hidden />Grupa podobnych kampanii {family.id}: {family.campaigns.join(", ")}</h3>
          <p className="mb-2 text-xs text-slate-800">
            <b>Wspólne:</b> {familyCommon(family)}. <b>Różne:</b> {family.apart.length ? family.apart.join("; ") : "brak dowodu na poziomie kampanii"}, dlatego to osobne kampanie.
          </p>
          <div className="space-y-2">{list.map(card)}</div>
        </section>
      ))}
      {grouped.alone.length > 0 && <div className="space-y-2">{grouped.alone.map(card)}</div>}
      {grouped.singletons.length > 0 && (
        <div>
          <button type="button" className="text-sm underline" onClick={() => setShowSingles((v) => !v)} aria-expanded={showSingles}>
            {count(grouped.singletons.length, MATERIAL)} bez powiązań ({showSingles ? "ukryj" : "pokaż"})
          </button>
          {showSingles && <div className="mt-2 space-y-2">{grouped.singletons.map(card)}</div>}
        </div>
      )}
    </div>
  );
}
