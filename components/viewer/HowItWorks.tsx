"use client";

import { GLOSSARY, type TermId } from "@/lib/viewer/plain";
import { STRENGTH_INFO, STRENGTH_ORDER } from "@/lib/viewer/strength";
import { StrengthBadge } from "./ui";

const STAGES: Array<{ name: string; text: string }> = [
  { name: "Wejście", text: "wczytujemy pliki materiału (zrzuty, stronę, HAR, wideo) albo link." },
  { name: "Cechy", text: "wyciągamy tekst, osoby, wygląd, budowę strony i dane o domenach." },
  { name: "Porównanie", text: "szukamy wspólnych śladów z bazą porównawczą i oceniamy ich siłę." },
  { name: "Grupowanie", text: "łączymy materiały w kampanie, a kampanie w grupy podobnych, według jawnych reguł." },
  { name: "Wynik", text: "pokazujemy, gdzie trafił materiał i dlaczego." },
];

const RULES = [
  "Silna przesłanka, np. to samo konto na platformie stron, łączy od razu.",
  "Słabsze przesłanki muszą razem przekroczyć próg łączenia, a sam szablon strony albo sama persona wymaga drugiego rodzaju śladu.",
  "Kampania z samej treści (podobny tekst lub obraz, bez wspólnej infrastruktury) jest słabszą podstawą i tak jest oznaczana.",
  "Różne konta tej samej platformy nie trafiają do jednej kampanii bez silnej przesłanki.",
  "Pozostałe powiązania między kampaniami tworzą grupy podobnych kampanii.",
  "Pominięte ślady się nie liczą.",
];

/** "Jak to działa": five stages, the rules in plain words, the strength scale and the glossary. */
export default function HowItWorks({ rules }: { rules: string[] }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <h2 className="text-xl font-semibold text-slate-900">Jak narzędzie dochodzi do wyniku?</h2>
      <ol className="space-y-2">
        {STAGES.map((s, i) => (
          <li key={s.name} className="flex gap-3 rounded-lg border border-slate-300 bg-white p-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm text-white">{i + 1}</span>
            <span><b>{s.name}</b>: {s.text}</span>
          </li>
        ))}
      </ol>
      <section>
        <h3 className="mb-1.5 font-semibold">Reguły zwykłymi słowami</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800">{RULES.map((r) => <li key={r}>{r}</li>)}</ul>
        {rules.length > 0 && (
          <details className="mt-2 text-xs text-slate-600">
            <summary className="cursor-pointer">Zapis techniczny reguł z bazy</summary>
            <ul className="mt-1 list-disc pl-5">{rules.map((r) => <li key={r}>{r}</li>)}</ul>
          </details>
        )}
      </section>
      <section>
        <h3 className="mb-1.5 font-semibold">Siła przesłanki</h3>
        <ul className="space-y-1.5 text-sm">
          {STRENGTH_ORDER.map((s) => <li key={s} className="flex items-center gap-2"><StrengthBadge strength={s} /><span className="text-slate-700">{STRENGTH_INFO[s].caption}</span></li>)}
        </ul>
      </section>
      <section id="slowniczek">
        <h3 className="mb-1.5 font-semibold">Słowniczek</h3>
        <dl className="space-y-2 text-sm">
          {(Object.entries(GLOSSARY) as Array<[TermId, (typeof GLOSSARY)[TermId]]>).map(([id, t]) => (
            <div key={id} className="rounded border border-slate-200 bg-white p-2.5">
              <dt className="font-medium">{t.term}</dt>
              <dd className="text-slate-700">{t.text}{t.example && <span className="block text-xs text-slate-500">Przykład: {t.example}</span>}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
