"use client";

import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Campaign, CampaignFamily, CampaignsFile, EvidenceGraph } from "@/lib/graph/model";
import { DECISION_LABEL, exportBlockReason, type Decision, type DecisionsFile } from "@/lib/viewer/decisions";
import { basisNote, campaignMatchesFilter, campaignTitle, cohesionLabel, groupCampaigns, narrativeOptions, platformOptions, type CampaignFilter } from "@/lib/viewer/campaignView";
import { defangText } from "@/lib/viewer/defang";
import { bridgeNote, narrativeSummaryLine, narrativeSwitchLines, weakestLinkNote } from "@/lib/viewer/fields";
import type { CtFeedRecord } from "@/lib/ct/feed";
import { campaignCtRecords, ctLeadSentence } from "@/lib/viewer/ctLead";
import { nearestCampaignOf } from "@/lib/viewer/scale";
import { fmtRange, count, fmtNum, MATERIAL } from "@/lib/viewer/format";
import { typeInfo } from "@/lib/viewer/plain";
import { campaignAttributes, campaignHasPersona, personaOptions } from "./compare";
import CampaignEvolution from "./CampaignEvolution";
import DecisionSelect from "./DecisionSelect";
import ClickRoute from "./ClickRoute";
import EvidenceButton from "./EvidenceButton";
import PrintButton from "./PrintButton";
import { Empty, Help, StrengthLegend } from "./ui";
import { HowComputedLink, NextSteps } from "./Guide";
import { campaignNextSteps } from "@/lib/viewer/copy";

export interface CampaignsViewProps {
  campaigns: CampaignsFile;
  graph: EvidenceGraph;
  /** Candidates of the CT feed (new domains that match known campaigns). */
  ctRecords: CtFeedRecord[];
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
function Card({ c, open, minLinkScore, graph, assignments, ctRecords, decision, onDecide, onToggle, onCompare }: { c: Campaign; open: boolean; minLinkScore: number; graph: EvidenceGraph; assignments: Record<string, string>; ctRecords: CtFeedRecord[]; decision: Decision | null; onDecide: (campaign: string, status: Decision | null) => void; onToggle: () => void; onCompare: (a: string, b: string | null) => void }) {
  const attrs = campaignAttributes(c);
  const basis = basisNote(c);
  const nearest = useMemo(() => (c.size <= 1 ? nearestCampaignOf(c.members[0], graph.links, assignments) : null), [c, graph.links, assignments]);
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
          {c.size <= 1 && <span className="mt-0.5 block text-xs text-slate-700">{nearest ? `Najbliżej kampanii ${nearest.campaign} (materiał ${nearest.material}), wynik ${fmtNum(nearest.score)}, próg łączenia ${fmtNum(minLinkScore)}.` : "Bez powiązań z innymi materiałami."}</span>}
          {c.topEvidence[0] && <span className="mt-0.5 block text-xs text-slate-700">Co łączy: {typeInfo(c.topEvidence[0].type)?.name ?? c.topEvidence[0].label}, {c.topEvidence[0].label}</span>}
          <span className="mt-1 flex flex-wrap gap-1 text-[11px]">
            {decision && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-900 ring-1 ring-violet-300">decyzja: {DECISION_LABEL[decision]}</span>}
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
            <HowComputedLink className="mt-1" />
          </div>
          <NextSteps
            steps={campaignNextSteps(c, decision, minLinkScore)}
            on={{
              compare: c.size > 1 ? () => onCompare(c.members[0], c.members[1]) : undefined,
              weakest: c.weakestMember ? () => onCompare(c.weakestMember!.id, c.members.find((m) => m !== c.weakestMember!.id) ?? null) : undefined,
            }}
          />
          {(c.analystNotes?.length ?? 0) > 0 && (
            <ul className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs text-blue-900">
              {c.analystNotes!.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
          {bridgeNote(c) && <p className="rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-900">{bridgeNote(c)}</p>}
          {weakestLinkNote(c, minLinkScore) && <p className="text-xs text-slate-700">{weakestLinkNote(c, minLinkScore)}</p>}
          {narrativeSummaryLine(c.attributes.narrative) && <p className="text-xs text-slate-700">{narrativeSummaryLine(c.attributes.narrative)}</p>}
          {narrativeSwitchLines(c.attributes.narrative).map((l) => <p key={l} className="text-xs text-slate-700">{l}</p>)}
          {(c.attributes.brands?.length ?? 0) > 0 && <p className="text-xs text-slate-700">Podrabiane marki na kreacjach: {c.attributes.brands!.map((b) => `${b.name} (${b.count})`).join(", ")}.</p>}
          <CampaignEvolution campaign={c} graph={graph} />
          {ctRecords.length > 0 && (
            <section aria-label="Nowe domeny tej kampanii">
              <h4 className="text-sm font-semibold">Nowe domeny tej kampanii ({ctRecords.length}, w tym potwierdzonych: {ctRecords.filter((r) => r.status === "confirmed").length})</h4>
              <ul className="mt-1 space-y-1 text-xs">
                {ctRecords.map((r) => (
                  <li key={`${r.domain}-${r.observed_utc}`} className="rounded border border-slate-200 bg-white px-2 py-1">
                    <span className="font-mono">{defangText(r.domain)}</span> · {r.status === "confirmed" ? "potwierdzona" : "kandydat do sprawdzenia"}
                    {ctLeadSentence(r.cert.not_before, c.firstSeen) && <span className="block text-slate-700">{ctLeadSentence(r.cert.not_before, c.firstSeen)}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
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
          <details data-no-print className="rounded border border-slate-200 p-2">
            <summary className="cursor-pointer text-sm font-medium">Trasa kliknięcia pierwszego materiału ({c.members[0]})</summary>
            <div className="mt-2"><ClickRoute itemId={c.members[0]} /></div>
          </details>
          {c.domains.length > 0 && <p className="text-xs text-slate-700">Domeny: {c.domains.join(", ")}</p>}
          <span data-no-print className="flex flex-wrap items-center gap-2">
            <DecisionSelect campaignId={c.id} value={decision} onSaved={onDecide} />
            <EvidenceButton campaignId={c.id} blockedReason={decision ? exportBlockReason({ version: 1, decisions: { [c.id]: { status: decision, decidedAt: "" } } }, c.id) : null} />
            <PrintButton />
          </span>
        </div>
      )}
    </article>
  );
}

/** "Kampanie": groups of similar campaigns in frames (Wspólne / Różne), single campaigns, folded materials without links. */
export default function CampaignsView({ campaigns, graph, ctRecords, openId, onOpen, onCompare }: CampaignsViewProps) {
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CampaignFilter>({});
  const [decisions, setDecisions] = useState<DecisionsFile["decisions"]>({});
  const [decisionsError, setDecisionsError] = useState<string | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/decisions", { signal: ctl.signal })
      .then(async (r) => {
        const b = (await r.json()) as { decisions?: DecisionsFile["decisions"]; error?: string };
        if (r.ok && b.decisions) setDecisions(b.decisions);
        else setDecisionsError(b.error ?? `Nie udało się wczytać decyzji analityka (kod ${r.status})`);
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setDecisionsError(`Nie udało się wczytać decyzji analityka: ${e.message}`);
      });
    return () => ctl.abort();
  }, []);
  const decide = (campaign: string, status: Decision | null) =>
    setDecisions((d) => {
      const next = { ...d };
      if (status) next[campaign] = { status, decidedAt: new Date().toISOString() };
      else delete next[campaign];
      return next;
    });
  const topics = useMemo(() => narrativeOptions(campaigns.campaigns), [campaigns]);
  const platforms = useMemo(() => platformOptions(campaigns.campaigns), [campaigns]);
  const [showSingles, setShowSingles] = useState(false);
  const options = useMemo(() => personaOptions(campaigns.campaigns), [campaigns]);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => campaigns.campaigns.filter((c) => campaignHasPersona(c, personaId) && campaignMatchesFilter(c, filter) && (!q || campaignTitle(c).toLowerCase().includes(q) || c.domains.some((d) => d.toLowerCase().includes(q)) || c.advertisers.some((a) => a.toLowerCase().includes(q)))),
    [campaigns, personaId, q, filter],
  );
  const grouped = useMemo(() => groupCampaigns(filtered, campaigns.families ?? []), [filtered, campaigns.families]);
  const card = (c: Campaign) => <Card key={c.id} c={c} minLinkScore={campaigns.method.minLinkScore} graph={graph} assignments={campaigns.assignments} ctRecords={campaignCtRecords(ctRecords, c.id)} decision={decisions[c.id]?.status ?? null} onDecide={decide} open={openId === c.id} onToggle={() => onOpen(openId === c.id ? null : c.id)} onCompare={onCompare} />;
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
        {topics.length > 0 && (
          <label className="flex items-center gap-1.5">
            Narracja
            <select value={filter.topic ?? ""} onChange={(e) => setFilter((f) => ({ ...f, topic: e.target.value || undefined }))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5">
              <option value="">wszystkie</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.label} ({t.campaigns})</option>)}
            </select>
          </label>
        )}
        {platforms.length > 0 && (
          <label className="flex items-center gap-1.5">
            Platforma stron
            <select value={filter.platform ?? ""} onChange={(e) => setFilter((f) => ({ ...f, platform: e.target.value || undefined }))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5">
              <option value="">wszystkie</option>
              {platforms.map((p) => <option key={p.id} value={p.id}>{p.id} ({p.campaigns})</option>)}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1.5">
          Aktywna od
          <input type="date" value={filter.from ?? ""} onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value || undefined }))} className="rounded-md border border-slate-300 px-2 py-1" />
        </label>
        <label className="flex items-center gap-1.5">
          do
          <input type="date" value={filter.to ?? ""} onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value || undefined }))} className="rounded-md border border-slate-300 px-2 py-1" />
        </label>
        <div className="ml-auto"><StrengthLegend /></div>
      </div>

      {decisionsError && <p role="alert" className="text-xs text-amber-900">{decisionsError}</p>}
      {filtered.length === 0 && <Empty>Nic nie pasuje do filtra. Zmień wyszukiwanie albo wybierz „wszystkie osoby”.</Empty>}

      {grouped.families.map(({ family, campaigns: list }) => (
        <section key={family.id} className="rounded-xl border-2 border-violet-500 bg-violet-50/40 p-3" aria-label={`Grupa podobnych kampanii ${family.id}`}>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-violet-950"><Layers size={16} aria-hidden />Grupa podobnych kampanii {family.id}: {family.campaigns.join(", ")}</h3>
          <p className="mb-2 text-xs text-slate-800">
            <b>Wspólne:</b> {familyCommon(family)}. <b>Różne:</b> {family.apart.length ? family.apart.join("; ") : "brak dowodu na poziomie kampanii"}, dlatego to osobne kampanie.
          </p>
          {(narrativeSummaryLine(family.narrative) || (family.personaCategories?.length ?? 0) > 0) && (
            <p className="mb-2 text-xs text-slate-800">
              Cechy grupy: {[narrativeSummaryLine(family.narrative)?.replace(/\.$/, ""), family.personaCategories?.length ? `osoby: ${family.personaCategories.map((p) => `${p.category} (${p.count})`).join(", ")}` : null].filter(Boolean).join("; ")}. To opis, nie dowód połączenia kampanii.
            </p>
          )}
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
