"use client";

import { Ban, CircleDashed, Copy as CopyIcon, FileQuestion, Sparkles, Waypoints } from "lucide-react";
import Image from "next/image";
import { useState, type ReactNode } from "react";
import type { Campaign } from "@/lib/graph/model";
import type { MaterialEvidence, MaterialItemResult, MaterialLink } from "@/lib/pipeline/analyzeMaterial";
import { bestCampaignLink } from "@/lib/pipeline/materialCsv";
import { completeness, type CaseProvenance } from "@/lib/viewer/completeness";
import { contribution } from "@/lib/viewer/contribution";
import { FAMILY_HINT, FAMILY_LABEL, FAMILY_ORDER, featureFamily, familyOf, type FeatureFamily } from "@/lib/viewer/families";
import { fmtNum } from "@/lib/viewer/format";
import { resultConfidence, variantNote } from "@/lib/viewer/materialView";
import { cleanEvidence, featureInfo, premiseFamily, premiseSentence, ROLE_LABEL, TECHNIQUE_INFO, TECHNIQUE_LABEL, typeInfo } from "@/lib/viewer/plain";
import { CONFIDENCE_INFO, evidenceStrength, ruleText, sortByStrength } from "@/lib/viewer/strength";
import { Defanged, Help, StrengthBadge, StrengthLegend } from "./ui";

export interface ResultContext {
  minLinkScore: number;
  kitOnly: Set<string>;
  campaigns: Map<string, Campaign>;
  jobId: string;
  provenance: Map<string, CaseProvenance>;
  skipped: Array<{ id: string; reason: string }>;
  failedLookups: string[];
  lookups: boolean;
}

/** Case record of the import for a material (by case id, then by material id). */
export function provenanceOf(ctx: ResultContext, item: MaterialItemResult): CaseProvenance | null {
  return ctx.provenance.get(item.caseId ?? "") ?? ctx.provenance.get(item.id) ?? null;
}

/** Completeness checklist of one material (§8.9), built from the import record, errors, skipped entries and lookups. */
export function itemCompleteness(ctx: ResultContext, item: MaterialItemResult) {
  const domains = (item.pivots ?? []).filter((p) => p.type === "domain").map((p) => p.label);
  return completeness({
    provenance: provenanceOf(ctx, item),
    features: item.features,
    errors: item.errors,
    skipped: ctx.skipped.filter((s) => s.id === item.id || s.id === item.caseId || s.id.startsWith(`${item.caseId}/`)),
    failedLookups: ctx.failedLookups,
    missing: item.missing,
    lookups: ctx.lookups,
    domains,
  });
}

const FAMILY_ICON: Record<FeatureFamily, string> = { content: "Aa", look: "◧", page: "</>", infra: "⌁" };

/** Icon of a feature family (Treść, Wygląd, Strona, Infrastruktura) with its name for screen readers. */
function FamilyIcon({ family }: { family: FeatureFamily | null }) {
  return (
    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded bg-slate-100 px-1 font-mono text-[11px] text-slate-700" title={family ? FAMILY_LABEL[family] : "rodzaj nieznany"} aria-label={family ? FAMILY_LABEL[family] : "rodzaj nieznany"}>
      {family ? FAMILY_ICON[family] : "?"}
    </span>
  );
}

/** One premise: family icon, strength badge, plain sentence, "Co to znaczy?" and "Skąd to wiemy". */
export function Premise({ ev, ctx, other }: { ev: MaterialEvidence; ctx: ResultContext; other?: string }) {
  const info = typeInfo(ev.pivotType ?? ev.edgeType ?? null);
  const family = premiseFamily(ev);
  return (
    <li className="rounded-md border border-slate-200 bg-white p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <FamilyIcon family={family} />
        <StrengthBadge strength={evidenceStrength(ev, ctx.kitOnly)} />
        <span className="text-sm text-slate-900">{premiseSentence(ev)}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 text-xs text-slate-600">
        <details>
          <summary className="cursor-pointer">Co to znaczy?</summary>
          <p className="mt-1 max-w-prose">{info ? `${info.what} ${info.why}` : "Wspólny ślad użyty do uzasadnienia połączenia."}</p>
        </details>
        <details>
          <summary className="cursor-pointer">Skąd to wiemy</summary>
          <p className="mt-1 max-w-prose">
            {other ? `Ten materiał → ` : ""}
            {ev.pivot ? `wspólny ślad ${ev.pivot.replace(/^[a-z_]+:/, "")}` : cleanEvidence(ev.evidence)}
            {other ? ` → materiał ${other}` : ""}
            <span className="block text-slate-500">{cleanEvidence(ev.evidence)} · waga {fmtNum(ev.weight)}</span>
          </p>
        </details>
      </div>
    </li>
  );
}

/** Bar of the contribution of premises to the link strength; the threshold is marked (§6.3). */
function ContributionBar({ link, ctx }: { link: MaterialLink; ctx: ResultContext }) {
  const c = contribution(link.evidence, (e) => e.weight, link.score);
  const shades = ["bg-slate-900", "bg-slate-600", "bg-slate-400", "bg-slate-300"];
  return (
    <div>
      <div className="relative h-3 w-full overflow-hidden rounded bg-slate-100" role="img" aria-label={`Siła powiązania ${fmtNum(c.total)}, próg łączenia ${fmtNum(ctx.minLinkScore)}`}>
        {c.segments.map((s, i) => (
          <span key={i} className={`absolute top-0 h-full border-r border-white ${shades[Math.min(i, shades.length - 1)]}`} style={{ left: `${s.from * 100}%`, width: `${s.length * 100}%` }} title={s.item ? cleanEvidence(s.item.evidence) : "pozostałe przesłanki"} />
        ))}
        <span className="absolute top-0 h-full w-0.5 bg-rose-700" style={{ left: `${ctx.minLinkScore * 100}%` }} aria-hidden />
      </div>
      <p className="mt-1 text-xs text-slate-600">
        Siła powiązania <b>{fmtNum(c.total)}</b><Help term="sila_powiazania" /> · próg łączenia {fmtNum(ctx.minLinkScore)}<Help term="prog_laczenia" /> (czerwona kreska)
      </p>
    </div>
  );
}

interface VerdictLook {
  title: string;
  cls: string;
  icon: ReactNode;
}

/** Title, frame style and icon of a verdict. Neutral colours for "nowa kampania" and "za mało danych": they do not mean the material is fine. */
function verdictLook(item: MaterialItemResult, ctx: ResultContext): VerdictLook {
  switch (item.verdict) {
    case "known_campaign":
      return { title: `Znana kampania ${item.campaign}`, cls: "border-blue-700 bg-blue-50", icon: <Waypoints size={20} aria-hidden /> };
    case "similar_campaigns":
      return { title: `Nowa kampania, podobna do ${item.similarCampaigns.join(" i ")}`, cls: "border-violet-600 bg-violet-50", icon: <Sparkles size={20} aria-hidden /> };
    case "duplicate":
      return { title: `Duplikat materiału ${item.duplicateOf?.id ?? ""}`, cls: "border-sky-600 bg-sky-50", icon: <CopyIcon size={20} aria-hidden /> };
    case "insufficient":
      return { title: "Za mało danych, żeby ocenić", cls: "border-slate-500 border-dashed bg-slate-50", icon: <FileQuestion size={20} aria-hidden /> };
    default:
      return { title: ctx.minLinkScore ? "Nowa kampania: żadne powiązanie nie przekracza progu" : "Nowa kampania", cls: "border-slate-500 bg-slate-50", icon: <CircleDashed size={20} aria-hidden /> };
  }
}

/** Section 1: verdict, confidence, one plain sentence, strength bar and buttons. */
function Verdict({ item, ctx, onShowCampaign, onCompare }: { item: MaterialItemResult; ctx: ResultContext; onShowCampaign: (id: string) => void; onCompare: (a: string, b: string) => void }) {
  const look = verdictLook(item, ctx);
  const conf = resultConfidence(item);
  const best = bestCampaignLink(item);
  const camp = item.campaign ? ctx.campaigns.get(item.campaign) : null;
  const note = variantNote(item);
  const sentence =
    item.verdict === "duplicate" && item.duplicateOf
      ? `To kopia materiału ${item.duplicateOf.id}: ${item.duplicateOf.reason}.${item.campaign ? ` Oryginał jest w kampanii ${item.campaign}.` : ""}`
      : item.verdict === "insufficient"
        ? "Materiał nie ma cech, po których da się go porównać. Zamiast zgadywać, mówimy to wprost."
        : best
          ? `${premiseSentence(sortByStrength(best.evidence, ctx.kitOnly)[0] ?? { evidence: "" })}.`
          : item.verdictText;
  return (
    <section className={`rounded-lg border-2 p-3 ${look.cls}`} aria-label="Werdykt">
      <div className="flex flex-wrap items-center gap-2">
        {look.icon}
        <h3 className="text-base font-semibold text-slate-900">{look.title}</h3>
        {conf && (
          <span className="rounded bg-white px-1.5 py-0.5 text-xs font-medium text-slate-800 ring-1 ring-slate-300" title={CONFIDENCE_INFO[conf].help}>
            {CONFIDENCE_INFO[conf].label}<Help term="pewnosc" />
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-800">{sentence}</p>
      {note && <p className="mt-1 rounded bg-white/70 px-2 py-1 text-xs text-slate-800">{note}</p>}
      {item.archive?.copy && (
        <p className="mt-1 rounded bg-white/70 px-2 py-1 text-xs text-slate-800">
          {item.archive.copy.used ? "Strona nie odpowiadała; cechy strony pochodzą z kopii" : "Znaleziono kopię strony, ale jej nie użyto"}: {item.archive.copy.source}, {item.archive.copy.capturedAt.slice(0, 10)}
          {item.archive.copy.rejected ? ` (${item.archive.copy.rejected.reason})` : ""}.{" "}
          <a className="underline" href={item.archive.copy.sourceUrl} target="_blank" rel="noopener noreferrer">Źródło kopii</a>
        </p>
      )}
      {camp?.attributes.basis === "content" && <p className="mt-1 rounded bg-white/70 px-2 py-1 text-xs text-slate-800">Kampania z treści, bez infrastruktury: słabsza podstawa niż wspólne konto czy serwer.</p>}
      {item.verdict === "similar_campaigns" && item.apart.length > 0 && <p className="mt-1 text-xs text-slate-800">Osobno, bo: {item.apart.join("; ")}.</p>}
      {item.verdict === "insufficient" && (item.missing?.length ?? 0) > 0 && (
        <div className="mt-2 text-sm">
          <b>Co dorzucić:</b>
          <ul className="list-disc pl-5">
            {item.missing!.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </div>
      )}
      {best && item.verdict !== "insufficient" && <div className="mt-2"><ContributionBar link={best} ctx={ctx} /></div>}
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        {item.campaign && <button type="button" className="rounded-md bg-slate-900 px-2.5 py-1 text-white" onClick={() => onShowCampaign(item.campaign!)}>Pokaż kampanię</button>}
        {best && <button type="button" className="rounded-md border border-slate-400 bg-white px-2.5 py-1" onClick={() => onCompare(item.id, best.other)}>Porównaj z najbliższym materiałem</button>}
      </div>
    </section>
  );
}

/** Section 3: closest rejected candidates with the rule's reason, and skipped traces. */
function WhyNot({ item, ctx }: { item: MaterialItemResult; ctx: ResultContext }) {
  const own = item.campaign ?? null;
  const rows = new Map<string, MaterialLink>();
  for (const l of item.links) {
    if (!l.otherCampaign || l.otherCampaign === own) continue;
    const cur = rows.get(l.otherCampaign);
    if (!cur || l.score > cur.score) rows.set(l.otherCampaign, l);
  }
  const list = [...rows.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 4);
  if (!list.length && !item.apart.length) return <p className="text-sm text-slate-600">Nie było innych kandydatów z powiązaniem.</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {list.map(([k, l]) => {
        const skipped = l.evidence.filter((e) => e.discounted);
        const only = skipped.length > 0 && skipped.length === l.evidence.length;
        return (
          <li key={k} className="rounded border border-slate-200 bg-white px-2.5 py-1.5">
            <b>{k}</b>: {only ? `wspólne są tylko ślady pominięte (${skipped.map((e) => cleanEvidence(e.evidence)).slice(0, 2).join("; ")})` : ruleText(l.rule, ctx.minLinkScore)} <span className="text-slate-500">(siła {fmtNum(l.score)})</span>
          </li>
        );
      })}
      {item.apart.map((a) => <li key={a} className="rounded border border-slate-200 bg-white px-2.5 py-1.5">{a}</li>)}
    </ul>
  );
}

/** Section 5: the four families with counts, one row per feature (name, value, source, role), techniques and raw data. */
function Features({ item }: { item: MaterialItemResult }) {
  const [raw, setRaw] = useState(false);
  const entries = Object.entries(item.features).filter(([k, v]) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== "" && (typeof v !== "object" || !!featureInfo(k).format)));
  const byFamily = new Map<FeatureFamily, Array<[string, unknown]>>();
  for (const [k, v] of entries) {
    const f = featureFamily(k);
    byFamily.set(f, [...(byFamily.get(f) ?? []), [k, v]]);
  }
  const shared = new Map<FeatureFamily, number>();
  for (const p of item.pivots ?? []) {
    const f = familyOf(p.type);
    if (f && p.df > 0) shared.set(f, (shared.get(f) ?? 0) + 1);
  }
  const techniques = item.techniques ?? [];
  const warning = item.features.platformAccountWarning;
  return (
    <div className="space-y-2">
      {typeof warning === "string" && warning && (
        <p className="rounded border border-amber-400 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          Uwaga: najemca strony różni się od konta platformy ({warning}). Ślad może pochodzić ze wspólnej biblioteki, nie od jednego operatora.
        </p>
      )}
      {FAMILY_ORDER.map((f) => {
        const rows = byFamily.get(f) ?? [];
        return (
          <details key={f} className="rounded-md border border-slate-200 bg-white" open={f === "infra" && rows.length > 0}>
            <summary className="cursor-pointer px-2.5 py-1.5 text-sm">
              <b>{FAMILY_LABEL[f]}</b>: {rows.length + (f === "page" ? techniques.length : 0)} cech{shared.get(f) ? `, ${shared.get(f)} wspólne z bazą` : ""}
              <span className="ml-2 text-xs text-slate-500">{FAMILY_HINT[f]}</span>
            </summary>
            <ul className="divide-y divide-slate-100 border-t border-slate-200 text-sm">
              {rows.map(([k, v]) => {
                const fi = featureInfo(k);
                const val = fi.format ? fi.format(v) : Array.isArray(v) ? v.map(String) : [String(v)];
                return (
                  <li key={k} className="px-2.5 py-1.5">
                    <span className="font-medium">{fi.name}</span>
                    {fi.term && <Help term={fi.term} />}: {val.slice(0, 3).map((x, i) => (fi.url ? <Defanged key={i} value={x} /> : <span key={i} className="mr-1">{x.length > 160 ? `${x.slice(0, 160)}…` : x}</span>))}
                    <span className="block text-xs text-slate-500">{fi.source} · {ROLE_LABEL[fi.role]}</span>
                  </li>
                );
              })}
              {f === "page" && techniques.map((t) => (
                <li key={t} className="px-2.5 py-1.5">
                  <span className="font-medium">{TECHNIQUE_LABEL[t] ?? t}</span>
                  <span className="block text-xs text-slate-500">{TECHNIQUE_INFO[t]?.why ?? "sposób działania: łączy podobne kampanie"}</span>
                </li>
              ))}
              {!rows.length && !(f === "page" && techniques.length) && <li className="px-2.5 py-1.5 text-slate-500">Nic nie odczytano.</li>}
            </ul>
          </details>
        );
      })}
      <button type="button" className="text-xs text-slate-700 underline" onClick={() => setRaw((v) => !v)}>{raw ? "Ukryj surowe dane" : "Pokaż surowe dane"}</button>
      {raw && <pre className="max-h-64 overflow-auto rounded bg-slate-900 p-2 text-xs text-slate-100">{JSON.stringify(item.features, null, 2)}</pre>}
    </div>
  );
}

/** Section 6: completeness checklist with the effect of every gap. */
export function CompletenessList({ item, ctx }: { item: MaterialItemResult; ctx: ResultContext }) {
  const c = itemCompleteness(ctx, item);
  return (
    <ul className="space-y-1 text-sm">
      {c.items.map((i) => (
        <li key={i.id} className="flex gap-2">
          <span aria-hidden className="w-4 shrink-0 text-center">{i.status === "ok" ? "✓" : i.status === "warn" ? "⚠" : "✗"}</span>
          <span>
            <span className="sr-only">{i.status === "ok" ? "jest: " : i.status === "warn" ? "ostrzeżenie: " : "brak: "}</span>
            {i.label}{i.optional && i.status === "missing" ? " (opcjonalne)" : ""}
            {i.effect && i.status !== "ok" && <span className="block text-xs text-slate-600">{i.effect}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Expanded card of one material: verdict, why, why not another, features, completeness. */
export default function ResultCard({ item, ctx, onShowCampaign, onCompare }: { item: MaterialItemResult; ctx: ResultContext; onShowCampaign: (id: string) => void; onCompare: (a: string, b: string) => void }) {
  const [all, setAll] = useState(false);
  const best = bestCampaignLink(item);
  const premises = best ? sortByStrength(best.evidence, ctx.kitOnly) : [];
  const shown = all ? premises : premises.slice(0, 3);
  const shot = provenanceOf(ctx, item)?.screenshot;
  return (
    <div className="space-y-4 p-3">
      {shot && (
        <Image src={`/api/material/${ctx.jobId}/image?path=${encodeURIComponent(shot)}`} alt={`Zrzut materiału ${item.id}`} width={160} height={120} unoptimized className="float-right ml-3 h-auto max-h-40 w-auto rounded border border-slate-200" />
      )}
      <Verdict item={item} ctx={ctx} onShowCampaign={onShowCampaign} onCompare={onCompare} />
      {item.verdict !== "insufficient" && (
        <section aria-label="Dlaczego">
          <h4 className="mb-1.5 text-sm font-semibold">Dlaczego?<Help term="przeslanka" /></h4>
          {shown.length ? (
            <>
              <ul className="space-y-1.5">{shown.map((e, i) => <Premise key={i} ev={e} ctx={ctx} other={best?.other} />)}</ul>
              {premises.length > 3 && <button type="button" className="mt-1.5 text-sm text-slate-700 underline" onClick={() => setAll((v) => !v)}>{all ? "Pokaż tylko najmocniejsze" : `Pokaż wszystkie (${premises.length})`}</button>}
            </>
          ) : (
            <p className="flex items-center gap-1.5 text-sm text-slate-600"><Ban size={14} aria-hidden />Brak wspólnych śladów z kampaniami z bazy.</p>
          )}
          <div className="mt-2"><StrengthLegend /></div>
        </section>
      )}
      {item.verdict !== "insufficient" && item.verdict !== "duplicate" && (
        <section aria-label="Dlaczego nie inna kampania">
          <h4 className="mb-1.5 text-sm font-semibold">Dlaczego nie inna kampania?</h4>
          <WhyNot item={item} ctx={ctx} />
        </section>
      )}
      <section aria-label="Cechy materiału">
        <h4 className="mb-1.5 text-sm font-semibold">Cechy materiału<Help term="cecha" /></h4>
        <Features item={item} />
      </section>
      <section aria-label="Kompletność danych">
        <h4 className="mb-1.5 text-sm font-semibold">Kompletność danych<Help term="kompletnosc" /></h4>
        <CompletenessList item={item} ctx={ctx} />
      </section>
    </div>
  );
}
