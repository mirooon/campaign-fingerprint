"use client";

import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Campaign, CampaignFamily, CampaignsFile, EvidenceGraph, NearMissesFile } from "@/lib/graph/model";
import { DECISION_LABEL, exportBlockReason, type Decision, type DecisionsFile } from "@/lib/viewer/decisions";
import { basisNote, campaignAnchorId, campaignIdInQuery, campaignMatchesFilter, campaignTitle, cohesionLabel, groupCampaigns, narrativeOptions, platformOptions, singlesInFamilyFrames, singleToReveal, type CampaignFilter } from "@/lib/viewer/campaignView";
import { defangText } from "@/lib/viewer/defang";
import { bridgeNote, narrativeSummaryLine, narrativeSwitchLines, weakestLinkNote } from "@/lib/viewer/fields";
import type { CtFeedRecord } from "@/lib/ct/feed";
import { campaignCtRecords, ctLeadSentence } from "@/lib/viewer/ctLead";
import { nearestCampaignOf } from "@/lib/viewer/scale";
import { fmtRange, count, MATERIAL, SINGLE_MATERIAL } from "@/lib/viewer/format";
import { familyApartLines, singleMaterialNote, singleMaterialRule, type SingleRule } from "@/lib/viewer/nearMissView";
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
  /** Pairs kept apart on purpose (`near-misses.json`): the rule shown on the card of a material left alone; null for an older run. */
  nearMisses: NearMissesFile | null;
  /** Rules computed on the server for materials left alone whose pair the near-miss list cut (key: the material). */
  singleRules?: Record<string, SingleRule>;
  /** Candidates of the CT feed (new domains that match known campaigns). */
  ctRecords: CtFeedRecord[];
  openId: string | null;
  onOpen: (id: string | null) => void;
  /** Open the comparison of two materials of the base. */
  onCompare: (a: string, b: string | null) => void;
}

/** "page template, article": names of the strongest shared traits of a family. */
function familyCommon(f: CampaignFamily): string {
  const names = f.topEvidence.map((e) => typeInfo(e.type)?.name ?? e.label);
  return [...new Set(names)].slice(0, 3).join(", ") || "no shared traces at campaign level";
}

/**
 * Card of one campaign: name, size, dates, strength of links, basis note, variants; expands to the premises and members.
 * A material left alone also says how close the nearest campaign is and, at or above the link threshold, which rule kept it out.
 */
function Card({ c, open, minLinkScore, graph, assignments, nearMisses, singleRule, ctRecords, decision, onDecide, onToggle, onCompare }: { c: Campaign; open: boolean; minLinkScore: number; graph: EvidenceGraph; assignments: Record<string, string>; nearMisses: NearMissesFile | null; singleRule: SingleRule | undefined; ctRecords: CtFeedRecord[]; decision: Decision | null; onDecide: (campaign: string, status: Decision | null) => void; onToggle: () => void; onCompare: (a: string, b: string | null) => void }) {
  const attrs = campaignAttributes(c);
  const basis = basisNote(c);
  const singleNote = useMemo(() => {
    if (c.size > 1) return null;
    const nearest = nearestCampaignOf(c.members[0], graph.links, assignments);
    return singleMaterialNote(nearest, minLinkScore, nearest ? singleMaterialRule(c.members[0], nearest.material, nearMisses, singleRule) : null);
  }, [c, graph.links, assignments, minLinkScore, nearMisses, singleRule]);
  return (
    <article id={campaignAnchorId(c.id)} className="scroll-mt-4 rounded-lg border border-slate-300 bg-white">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-start gap-2 p-3 text-left"
      >
        {open ? <ChevronDown size={16} aria-hidden className="mt-0.5 shrink-0" /> : <ChevronRight size={16} aria-hidden className="mt-0.5 shrink-0" />}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">{campaignTitle(c)}</span>
          <span className="block text-xs text-slate-600">
            {count(c.size, MATERIAL)} · {fmtRange(c.firstSeen, c.lastSeen)}
            {c.size > 1 && <> · campaign link strength: {cohesionLabel(c.cohesion)}<Help term="sila_w_kampanii" /></>}
          </span>
          {singleNote && <span className="mt-0.5 block text-xs text-slate-700">{singleNote}</span>}
          {c.topEvidence[0] && <span className="mt-0.5 block text-xs text-slate-700">What links them: {typeInfo(c.topEvidence[0].type)?.name ?? c.topEvidence[0].label}, {c.topEvidence[0].label}</span>}
          <span className="mt-1 flex flex-wrap gap-1 text-[11px]">
            {decision && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-900 ring-1 ring-violet-300">decision: {DECISION_LABEL[decision]}</span>}
            {basis && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-900 ring-1 ring-amber-300">{basis}</span>}
            {(c.variants?.length ?? 0) > 0 && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-800" title="Samples assigned by the creative alone, without infrastructure of their own">{c.variants!.length} {c.variants!.length === 1 ? "creative variant" : "creative variants"}<Help term="wariant" /></span>}
            {attrs.personas.slice(0, 3).map((p) => <span key={p.id} className="rounded bg-fuchsia-50 px-1.5 py-0.5 text-fuchsia-900">{p.name}</span>)}
            {attrs.cloakingSuspected > 0 && <span className="rounded bg-slate-100 px-1.5 py-0.5">cloaking ×{attrs.cloakingSuspected}<Help term="cloaking" /></span>}
          </span>
        </span>
      </div>
      {open && (
        <div className="space-y-2 border-t border-slate-200 p-3 text-sm">
          <div>
            <b>Why this is one campaign</b>
            <ul className="mt-1 flex flex-wrap gap-1">
              {c.topEvidence.map((e) => <li key={e.key} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{typeInfo(e.type)?.name ?? e.type}: {e.label} ×{e.count}</li>)}
              {!c.topEvidence.length && <li className="text-xs text-slate-600">Sample with no links.</li>}
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
          {(c.attributes.brands?.length ?? 0) > 0 && <p className="text-xs text-slate-700">Brands faked in the creatives: {c.attributes.brands!.map((b) => `${b.name} (${b.count})`).join(", ")}.</p>}
          <CampaignEvolution campaign={c} graph={graph} />
          {ctRecords.length > 0 && (
            <section aria-label="New domains of this campaign">
              <h4 className="text-sm font-semibold">New domains of this campaign ({ctRecords.length}, confirmed: {ctRecords.filter((r) => r.status === "confirmed").length})</h4>
              <ul className="mt-1 space-y-1 text-xs">
                {ctRecords.map((r) => (
                  <li key={`${r.domain}-${r.observed_utc}`} className="rounded border border-slate-200 bg-white px-2 py-1">
                    <span className="font-mono">{defangText(r.domain)}</span> · {r.status === "confirmed" ? "confirmed" : "candidate to check"}
                    {ctLeadSentence(r.cert.not_before, c.firstSeen) && <span className="block text-slate-700">{ctLeadSentence(r.cert.not_before, c.firstSeen)}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div>
            <b>Samples</b>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {c.members.map((m) => {
                const v = c.variants?.find((x) => x.id === m);
                return (
                  <li key={m} className="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-xs">
                    {m}{v && <span className="font-sans text-slate-600"> (creative variant, similar to {v.like})</span>}
                    {c.members[0] !== m && <button type="button" data-no-print className="ml-1 font-sans underline" onClick={() => onCompare(c.members[0], m)}>compare with {c.members[0]}</button>}
                  </li>
                );
              })}
            </ul>
          </div>
          <details data-no-print className="rounded border border-slate-200 p-2">
            <summary className="cursor-pointer text-sm font-medium">Click route of the first sample ({c.members[0]})</summary>
            <div className="mt-2"><ClickRoute itemId={c.members[0]} /></div>
          </details>
          {c.domains.length > 0 && <p className="text-xs text-slate-700">Domains: {c.domains.join(", ")}</p>}
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

/** "Campaigns": groups of similar campaigns in frames (Shared / Different), single campaigns, folded materials left alone (unfolded when one is opened from outside). */
export default function CampaignsView({ campaigns, graph, nearMisses, singleRules, ctRecords, openId, onOpen, onCompare }: CampaignsViewProps) {
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
        else setDecisionsError(b.error ?? `Could not load analyst decisions (code ${r.status})`);
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setDecisionsError(`Could not load analyst decisions: ${e.message}`);
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
  const options = useMemo(() => personaOptions(campaigns.campaigns), [campaigns]);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => campaigns.campaigns.filter((c) => campaignHasPersona(c, personaId) && campaignMatchesFilter(c, filter) && (!q || campaignTitle(c).toLowerCase().includes(q) || c.domains.some((d) => d.toLowerCase().includes(q)) || c.advertisers.some((a) => a.toLowerCase().includes(q)))),
    [campaigns, personaId, q, filter],
  );
  const grouped = useMemo(() => groupCampaigns(filtered, campaigns.families ?? []), [filtered, campaigns.families]);
  // A material left alone opened from outside (?k= from "Show campaign", or its number typed in the search) sits in
  // the folded section: unfold it once per such material (adjusting state on a prop change, no effect); the user may fold it again.
  const reveal = singleToReveal(grouped.singletons, openId);
  const [showSingles, setShowSingles] = useState(reveal !== null);
  const [revealed, setRevealed] = useState(reveal);
  if (reveal !== revealed) {
    setRevealed(reveal);
    if (reveal) setShowSingles(true);
  }
  // Bring the open card into view when it opens: from another tab it may stand far down the list or in the section
  // just unfolded. "nearest" scrolls only as far as needed, so a card opened by a click in the list barely moves.
  useEffect(() => {
    if (openId) document.getElementById(campaignAnchorId(openId))?.scrollIntoView({ block: "nearest" });
  }, [openId]);
  /** Search box: filters the list; the exact number of a campaign ("K50") also opens its card. */
  const search = (value: string) => {
    setQuery(value);
    const hit = campaignIdInQuery(campaigns.campaigns, value);
    if (hit && hit !== openId) onOpen(hit);
  };
  const inFrames = singlesInFamilyFrames(grouped);
  const card = (c: Campaign) => <Card key={c.id} c={c} minLinkScore={campaigns.method.minLinkScore} graph={graph} assignments={campaigns.assignments} nearMisses={nearMisses} singleRule={singleRules?.[c.members[0]]} ctRecords={campaignCtRecords(ctRecords, c.id)} decision={decisions[c.id]?.status ?? null} onDecide={decide} open={openId === c.id} onToggle={() => onOpen(openId === c.id ? null : c.id)} onCompare={onCompare} />;
  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Which campaigns are in the reference base?</h2>
        <p className="mt-1 text-sm text-slate-700">A campaign<Help term="kampania" /> is the samples of one operator. Campaigns of different operators that use the same template stand together in the frame of a similar-campaign group<Help term="grupa_podobnych" />.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input type="search" value={query} onChange={(e) => search(e.target.value)} placeholder="Search: person, domain, K03" aria-label="Search campaigns" className="min-w-56 rounded-md border border-slate-300 px-2 py-1.5" />
        {options.length > 0 && (
          <label className="flex items-center gap-1.5">
            Persona<Help term="persona" />
            <select value={personaId ?? ""} onChange={(e) => setPersonaId(e.target.value || null)} className="rounded-md border border-slate-300 bg-white px-2 py-1.5">
              <option value="">all people</option>
              {options.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.campaigns})</option>)}
            </select>
          </label>
        )}
        {topics.length > 0 && (
          <label className="flex items-center gap-1.5">
            Narrative
            <select value={filter.topic ?? ""} onChange={(e) => setFilter((f) => ({ ...f, topic: e.target.value || undefined }))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5">
              <option value="">all</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.label} ({t.campaigns})</option>)}
            </select>
          </label>
        )}
        {platforms.length > 0 && (
          <label className="flex items-center gap-1.5">
            Page-builder platform
            <select value={filter.platform ?? ""} onChange={(e) => setFilter((f) => ({ ...f, platform: e.target.value || undefined }))} className="rounded-md border border-slate-300 bg-white px-2 py-1.5">
              <option value="">all</option>
              {platforms.map((p) => <option key={p.id} value={p.id}>{p.id} ({p.campaigns})</option>)}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1.5">
          Active from
          <input type="date" value={filter.from ?? ""} onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value || undefined }))} className="rounded-md border border-slate-300 px-2 py-1" />
        </label>
        <label className="flex items-center gap-1.5">
          to
          <input type="date" value={filter.to ?? ""} onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value || undefined }))} className="rounded-md border border-slate-300 px-2 py-1" />
        </label>
        <div className="ml-auto"><StrengthLegend /></div>
      </div>

      {decisionsError && <p role="alert" className="text-xs text-amber-900">{decisionsError}</p>}
      {filtered.length === 0 && <Empty>Nothing matches the filter. Change the search or choose “all people”.</Empty>}

      {grouped.families.map(({ family, campaigns: list }) => (
        <section key={family.id} className="rounded-xl border-2 border-violet-500 bg-violet-50/40 p-3" aria-label={`Group of similar campaigns ${family.id}`}>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-violet-950"><Layers size={16} aria-hidden />Group of similar campaigns {family.id}: {family.campaigns.join(", ")}</h3>
          <p className="mb-2 text-xs text-slate-800">
            <b>Shared:</b> {familyCommon(family)}. <b>Different:</b> {family.apart.length ? familyApartLines(family, nearMisses).join("; ") : "no evidence at campaign level"}, so these are separate campaigns.
          </p>
          {(narrativeSummaryLine(family.narrative) || (family.personaCategories?.length ?? 0) > 0) && (
            <p className="mb-2 text-xs text-slate-800">
              Group features: {[narrativeSummaryLine(family.narrative)?.replace(/\.$/, ""), family.personaCategories?.length ? `people: ${family.personaCategories.map((p) => `${p.category} (${p.count})`).join(", ")}` : null].filter(Boolean).join("; ")}. This is a description, not evidence that links the campaigns.
            </p>
          )}
          <div className="space-y-2">{list.map(card)}</div>
        </section>
      ))}
      {grouped.alone.length > 0 && <div className="space-y-2">{grouped.alone.map(card)}</div>}
      {grouped.singletons.length > 0 && (
        <div>
          <button type="button" className="text-sm underline" onClick={() => setShowSingles((v) => !v)} aria-expanded={showSingles}>
            {count(grouped.singletons.length, SINGLE_MATERIAL)} outside similar-campaign groups ({showSingles ? "hide" : "show"})
          </button>
          {inFrames > 0 && <span className="ml-2 text-xs text-slate-600">In the similar-campaign group frames above: {count(inFrames, SINGLE_MATERIAL)}.</span>}
          {showSingles && <div className="mt-2 space-y-2">{grouped.singletons.map(card)}</div>}
        </div>
      )}
    </div>
  );
}
