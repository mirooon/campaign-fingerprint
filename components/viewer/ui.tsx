"use client";

import { AlertTriangle, Ban, Check, Copy, FlaskConical, Layers, ShieldCheck, Tag, Link2Off, HelpCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { defangUrl } from "@/lib/viewer/defang";
import { GLOSSARY, type TermId } from "@/lib/viewer/plain";
import { STRENGTH_INFO, STRENGTH_ORDER, type Strength } from "@/lib/viewer/strength";

/** "?" next to a technical term: what it is, why it matters for linking, an example (texts: lib/viewer/plain.ts). */
export function Help({ term }: { term: TermId }) {
  const [open, setOpen] = useState(false);
  const t = GLOSSARY[term];
  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        aria-label={`What it means: ${t.term}`}
        aria-expanded={open}
        onClick={(e) => {
          // the "?" can sit inside a clickable card header: open the tip without toggling the card
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        onBlur={() => setOpen(false)}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-500 hover:text-slate-900 focus:outline-2 focus:outline-slate-900"
      >
        <HelpCircle size={14} aria-hidden />
      </button>
      {open && (
        <span role="tooltip" className="absolute left-0 top-5 z-30 w-64 rounded-md border border-slate-300 bg-white p-2.5 text-left text-xs font-normal normal-case leading-snug text-slate-800 shadow-lg">
          <b className="block text-slate-900">{t.term}</b>
          {t.text}
          {t.why && <span className="mt-1 block text-slate-600">Why it matters: {t.why}</span>}
          {t.example && <span className="mt-1 block text-slate-600">Example: {t.example}</span>}
        </span>
      )}
    </span>
  );
}

const STRENGTH_STYLE: Record<Strength, { cls: string; icon: ReactNode }> = {
  high: { cls: "bg-slate-900 text-white", icon: <ShieldCheck size={13} aria-hidden /> },
  medium: { cls: "bg-slate-200 text-slate-900", icon: <Layers size={13} aria-hidden /> },
  confirm: { cls: "border border-dashed border-slate-500 bg-white text-slate-800", icon: <AlertTriangle size={13} aria-hidden /> },
  skipped: { cls: "bg-slate-100 text-slate-500 line-through", icon: <Ban size={13} aria-hidden /> },
  descriptive: { cls: "bg-white text-slate-600 ring-1 ring-slate-300", icon: <Tag size={13} aria-hidden /> },
};

/** Strength of a premise: word + icon + style, never colour alone (§5.3). */
export function StrengthBadge({ strength }: { strength: Strength }) {
  const s = STRENGTH_STYLE[strength];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${s.cls}`} title={STRENGTH_INFO[strength].caption}>
      {s.icon}
      {STRENGTH_INFO[strength].label}
    </span>
  );
}

/** Legend of the strength scale; reachable from every screen with premises. */
export function StrengthLegend() {
  return (
    <details className="rounded-md border border-slate-200 bg-white text-xs">
      <summary className="cursor-pointer px-2.5 py-1.5 font-medium text-slate-700">Legend: evidence strength<Help term="sila_przeslanki" /></summary>
      <ul className="space-y-1 border-t border-slate-200 p-2.5">
        {STRENGTH_ORDER.map((s) => (
          <li key={s} className="flex items-center gap-2">
            <StrengthBadge strength={s} />
            <span className="text-slate-600">{STRENGTH_INFO[s].caption}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Label shown on every result screen while the base or the result is synthetic (sample data, "Load example"). */
export function SyntheticBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900" title="This is example data, made up for the demo. It does not come from real frauds.">
      <FlaskConical size={13} aria-hidden />
      synthetic data
    </span>
  );
}

/** A link from a material, shown defanged (hxxps://domain[.]live) with a copy button; it is never a clickable link. */
export function Defanged({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  const shown = defangUrl(value);
  return (
    <span className="inline-flex max-w-full items-center gap-1 align-middle">
      <code className="truncate rounded bg-slate-100 px-1 py-0.5 text-xs">{shown}</code>
      <button
        type="button"
        aria-label="Copy defanged URL"
        className="rounded p-0.5 text-slate-500 hover:text-slate-900"
        onClick={() => {
          navigator.clipboard.writeText(shown).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }, () => setDone(false));
        }}
      >
        {done ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      </button>
    </span>
  );
}

/** Empty state: what to do next. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-600">
      <Link2Off size={16} aria-hidden />
      {children}
    </p>
  );
}
