"use client";

import { GLOSSARY, type TermId } from "@/lib/viewer/plain";
import { STRENGTH_INFO, STRENGTH_ORDER } from "@/lib/viewer/strength";
import { StrengthBadge } from "./ui";
import { useEffect } from "react";
import { METHOD_ANCHOR } from "@/lib/viewer/copy";
import type { CampaignsFile } from "@/lib/graph/model";

const STAGES: Array<{ name: string; text: string }> = [
  { name: "Input", text: "we load the sample files (screenshots, page, HAR, video) or a link." },
  { name: "Features", text: "we extract text, people, appearance, page structure and domain data." },
  { name: "Comparison", text: "we look for traces shared with the reference base and rate their strength." },
  { name: "Grouping", text: "we link samples into campaigns, and campaigns into similar-campaign groups, by explicit rules." },
  { name: "Result", text: "we show where the sample landed and why." },
];

const RULES = [
  "Strong evidence, e.g. the same page-builder account, links at once.",
  "Weaker evidence must pass the linking threshold together, and a page template alone or a persona alone needs a second kind of trace.",
  "A campaign built on content alone (similar text or image, no shared infrastructure) rests on a weaker basis and is marked as such.",
  "Different accounts on the same platform do not go into one campaign without strong evidence.",
  "The remaining links between campaigns form groups of similar campaigns.",
  "Discounted traces do not count.",
];

/**
 * "How it works": five stages, the rules in plain words with the base's thresholds (the "How did we compute this?" anchor),
 * the strength scale and the glossary. Opened with `#how-we-computed`, it scrolls to the methodology section.
 */
export default function HowItWorks({ rules, method }: { rules: string[]; method?: CampaignsFile["method"] }) {
  useEffect(() => {
    const id = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <h2 className="text-xl font-semibold text-slate-900">How does the tool reach a result?</h2>
      <ol className="space-y-2">
        {STAGES.map((s, i) => (
          <li key={s.name} className="flex gap-3 rounded-lg border border-slate-300 bg-white p-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm text-white">{i + 1}</span>
            <span><b>{s.name}</b>: {s.text}</span>
          </li>
        ))}
      </ol>
      <section id={METHOD_ANCHOR} className="scroll-mt-4">
        <h3 className="mb-1.5 font-semibold">How did we compute this? The rules in plain words</h3>
        {method && (
          <p className="mb-1.5 rounded border border-slate-200 bg-white p-2 text-sm text-slate-800">
            Thresholds of this base: a pair of samples can go into one campaign with a score of at least <b>{method.minLinkScore}</b> (from 0 to 1); strong evidence links at once ({method.unionFind}). Split into campaigns: Louvain, resolution {method.louvain.resolution}, seed {method.louvain.seed}{method.louvain.modularity !== null ? `, modularity ${method.louvain.modularity}` : ""}.
          </p>
        )}
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">{RULES.map((r) => <li key={r}>{r}</li>)}</ul>
        {rules.length > 0 && (
          <details className="mt-2 text-xs text-slate-600">
            <summary className="cursor-pointer">Technical record of the rules from the base</summary>
            <ul className="mt-1 list-disc pl-5">{rules.map((r) => <li key={r}>{r}</li>)}</ul>
          </details>
        )}
      </section>
      <section>
        <h3 className="mb-1.5 font-semibold">Evidence strength</h3>
        <ul className="space-y-1.5 text-sm">
          {STRENGTH_ORDER.map((s) => <li key={s} className="flex items-center gap-2"><StrengthBadge strength={s} /><span className="text-slate-700">{STRENGTH_INFO[s].caption}</span></li>)}
        </ul>
      </section>
      <section id="glossary">
        <h3 className="mb-1.5 font-semibold">Glossary</h3>
        <dl className="space-y-2 text-sm">
          {(Object.entries(GLOSSARY) as Array<[TermId, (typeof GLOSSARY)[TermId]]>).map(([id, t]) => (
            <div key={id} className="rounded border border-slate-200 bg-white p-2.5">
              <dt className="font-medium">{t.term}</dt>
              <dd className="text-slate-700">{t.text}{t.example && <span className="block text-xs text-slate-500">Example: {t.example}</span>}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
